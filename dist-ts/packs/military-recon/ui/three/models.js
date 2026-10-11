import * as THREE from "three";
import { barkTexture, bladeTexture, crackedMudTexture, leafTexture, muddyWaterTexture, puffTexture, rippleNormalTexture, rng, rockTexture, valueNoise, wetMudTexture } from "./textures.js";
// 3D models for the recon views, built from primitives so they ship with the code. Local axes: x forward along
// the route, z to the right, y up; units are metres. The dirt track is TRACK_HALF either side of x.
//
// Obstacles that block the track are sized to cover it fully and stop short of the way round (route.ts:
// SWERVE_OFFSET is 6.6 m to the side), so there is visibly clear ground to drive round them.
export const TRACK_HALF = 1.8;
const mats = new Map();
export function mat(key, make) {
    let m = mats.get(key);
    if (!m)
        mats.set(key, (m = make()));
    return m;
}
const std = (color, rough = 0.92, extra = {}) => mat(`std-${color}-${rough}-${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }));
function mesh(geom, material, shadow = true) {
    const m = new THREE.Mesh(geom, material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
}
/** Tags the meshes of an obstacle for the C4 height map: "solid" parts, and "water" surfaces it can see through. */
function tag(obj, role) {
    obj.userData.role = role;
    return obj;
}
function rocks(r, n, place, size, color) {
    const g = new THREE.Group();
    const geom = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < n; i++) {
        const [x, z] = place();
        const s = size[0] + r() * (size[1] - size[0]);
        const m = mesh(geom, std(color, 0.95, { flatShading: true }), s > 0.12);
        m.scale.set(s * (0.8 + r() * 0.5), s * (0.5 + r() * 0.4), s * (0.8 + r() * 0.5));
        m.rotation.set(r() * 3, r() * 3, r() * 3);
        m.position.set(x, s * 0.35, z);
        g.add(m);
    }
    return g;
}
function sticks(r, n, place, color = "#5a4029") {
    const g = new THREE.Group();
    const geom = new THREE.CylinderGeometry(0.03, 0.04, 1, 5);
    for (let i = 0; i < n; i++) {
        const [x, z] = place();
        const m = mesh(geom, std(color), false);
        const len = 0.4 + r() * 0.9;
        m.scale.set(1, len, 1);
        m.rotation.set(Math.PI / 2, 0, r() * Math.PI);
        m.position.set(x, 0.04, z);
        g.add(m);
    }
    return g;
}
function foliage(r, cx, cy, cz, spread, n, colors) {
    const g = new THREE.Group();
    const geom = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < n; i++) {
        const m = mesh(geom, std(colors[i % colors.length], 0.95, { flatShading: true }));
        const s = 0.55 + r() * 0.6;
        m.scale.set(s, s * 0.8, s);
        m.position.set(cx + (r() - 0.5) * spread[0], cy + (r() - 0.5) * spread[1], cz + (r() - 0.5) * spread[2]);
        g.add(m);
    }
    return g;
}
let softEdgeTex = null;
/** Radial alpha: opaque in the middle, fading out over the outer fifth (water edges soak into the ground). */
const SHEEN = false;
let crispEdgeTex = null;
/** Like softEdge, but a short fade: a water line, not a stain. */
function crispEdge() {
    if (crispEdgeTex)
        return crispEdgeTex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.74, "#fff");
    grad.addColorStop(0.8, "#000");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    crispEdgeTex = new THREE.CanvasTexture(c);
    return crispEdgeTex;
}
function softEdge() {
    if (softEdgeTex)
        return softEdgeTex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.72, "#fff");
    grad.addColorStop(1, "#000");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    softEdgeTex = new THREE.CanvasTexture(c);
    return softEdgeTex;
}
/** An irregular, puddle-like outline (unit radius), the same for a given seed. */
function blobGeometry(seed, wobble = 0.22) {
    const r = rng(seed);
    const n = 48;
    const k1 = r() * 6, k2 = r() * 6;
    const shape = new THREE.Shape();
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rad = 1 + wobble * (0.6 * Math.sin(a * 3 + k1) + 0.4 * Math.sin(a * 5 + k2));
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
        if (i === 0)
            shape.moveTo(x, y);
        else
            shape.lineTo(x, y);
    }
    const geom = new THREE.ShapeGeometry(shape, 1);
    geom.rotateX(-Math.PI / 2);
    // UVs from position, so textures and the soft edge map onto the blob.
    const p = geom.attributes.position;
    const uv = [];
    for (let i = 0; i < p.count; i++)
        uv.push(p.getX(i) / 2.6 + 0.5, p.getZ(i) / 2.6 + 0.5);
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return geom;
}
/**
 * Standing water (Oct 10, 2026 rework): an irregular soft-edged pool with fine wind ripples that mirrors the sky
 * (scene environment, stronger at a low angle, as real water does), over a ring of wet, darker ground.
 */
function water(w, d, look, seed, y = 0.06) {
    const g = new THREE.Group();
    const normal = rippleNormalTexture().clone();
    normal.needsUpdate = true;
    normal.repeat.set(d / 3, w / 3);
    const geom = blobGeometry(seed);
    // Wet ground around it: darker and a little larger, fading out.
    if (look.muddy) {
        // Muddy water (Oct 11, 2026 rework): a rim of dried, cracked mud, then churned wet mud with ruts and puddled
        // hollows, then the opaque water itself.
        const dry = new THREE.Mesh(blobGeometry(seed + 7, 0.3), new THREE.MeshStandardMaterial({ color: "#ffffff", map: crackedMudTexture(), roughness: 0.95, transparent: true, opacity: 0.7, depthWrite: false, alphaMap: softEdge() }));
        dry.scale.set((d / 2) * 1.3, 1, (w / 2) * 1.26);
        dry.position.y = y - 0.035;
        dry.receiveShadow = true;
        g.add(tag(dry, "surface"));
    }
    const wet = new THREE.Mesh(blobGeometry(seed, 0.26), new THREE.MeshStandardMaterial({
        color: look.muddy ? "#ffffff" : look.edge, map: look.muddy ? wetMudTexture() : null, roughness: look.muddy ? 0.38 : 0.8, transparent: true, opacity: look.muddy ? 1 : 0.6, depthWrite: false, alphaMap: softEdge()
    }));
    wet.scale.set((d / 2) * (look.muddy ? 1.22 : 1.22), 1, (w / 2) * (look.muddy ? 1.2 : 1.18));
    wet.position.y = y - 0.02;
    wet.receiveShadow = true;
    g.add(tag(wet, "surface"));
    // Muddy water (Oct 11, 2026): matte, so at a grazing angle from 30-60 m it stays dark brown instead of mirroring the
    // pale sky like the clear water does; that difference is what lets it be told apart from afar.
    const surface = new THREE.Mesh(geom, look.muddy ? new THREE.MeshLambertMaterial({ map: muddyWaterTexture(), transparent: true, depthWrite: false, alphaMap: crispEdge() }) : new THREE.MeshStandardMaterial({
        color: look.muddy ? "#ffffff" : look.color, map: look.muddy ? muddyWaterTexture() : null, roughness: look.muddy ? 0.22 : 0.03, metalness: 0, transparent: true, opacity: look.opacity, depthWrite: false,
        alphaMap: look.muddy ? crispEdge() : softEdge(), normalMap: normal, normalScale: new THREE.Vector2(look.muddy ? 0.12 : 0.3, look.muddy ? 0.12 : 0.3), envMapIntensity: look.muddy ? 0.45 : 2.6
    }));
    surface.scale.set(d / 2, 1, w / 2);
    surface.position.y = y;
    surface.receiveShadow = true;
    g.add(tag(surface, "water"));
    if (look.muddy && SHEEN) {
        // Muddy water is opaque, so the sky sheen is what tells it is water and not wet earth: a pale, rippled
        // reflection layer over the brown, stronger towards the far side as on real water.
        const sheen = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: "#cfe1ef", transparent: true, opacity: 0.42, depthWrite: false, alphaMap: sheenTexture() }));
        sheen.scale.set(d / 2, 1, w / 2);
        sheen.position.y = y + 0.01;
        g.add(tag(sheen, "water"));
    }
    return g;
}
let sheenTex = null;
/** Alpha for the muddy-water sheen: soft edge, brighter far side, broken into ripple streaks. */
function sheenTexture() {
    if (sheenTex)
        return sheenTex;
    const n = 128;
    const data = new Uint8Array(n * n * 4);
    const noise = valueNoise(9);
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
            const u = i / (n - 1) - 0.5;
            const v = j / (n - 1) - 0.5;
            const r = Math.min(1, Math.hypot(u, v) * 2);
            const edge = Math.max(0, Math.min(1, (1 - r) / 0.25));
            const far = 0.15 + 0.85 * (u + 0.5) ** 1.5; // +x (along the route, away from the camera) brighter
            const streak = Math.max(0, noise(u * 3, v * 40) - 0.35) * 1.6;
            const a = Math.round(255 * edge * far * streak);
            data.set([255, 255, 255, a], (j * n + i) * 4);
            data[(j * n + i) * 4] = a;
            data[(j * n + i) * 4 + 1] = a;
            data[(j * n + i) * 4 + 2] = a;
        }
    sheenTex = new THREE.DataTexture(data, n, n);
    sheenTex.needsUpdate = true;
    return sheenTex;
}
/** A fallen trunk lying across the track: crown at one end (left), torn-up root plate at the other. */
function fallenTree(r, grey = false) {
    const g = new THREE.Group();
    const bark = barkTexture(grey).clone();
    bark.needsUpdate = true;
    bark.repeat.set(2, 3);
    const trunk = mesh(new THREE.CylinderGeometry(0.34, 0.44, 6.2, 16), new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, color: grey ? "#b3ada0" : "#c9a882" }));
    trunk.rotation.x = Math.PI / 2;
    trunk.position.set(0, 0.42, 0);
    g.add(tag(trunk, "solid"));
    // Cut face at the root end, lighter wood.
    const face = mesh(new THREE.CircleGeometry(0.43, 16), std(grey ? "#cfc6b0" : "#c9a174"), false);
    face.position.set(0, 0.42, 3.11);
    g.add(tag(face, "solid"));
    // Root plate: a disc of soil and roots stood on edge.
    const plate = mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.45, 18), std("#5b4630", 1, { flatShading: true }));
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0.1, 1.05, 3.35);
    g.add(tag(plate, "solid"));
    for (let i = 0; i < 9; i++) {
        const root = mesh(new THREE.CylinderGeometry(0.03, 0.07, 0.9 + r() * 0.6, 5), std("#4a3826"), false);
        const a = (i / 9) * Math.PI * 2;
        root.position.set(0.1 + Math.cos(a) * 1.3, 1.05 + Math.sin(a) * 1.3, 3.5);
        root.rotation.set(0, 0, a + Math.PI / 2);
        g.add(tag(root, "solid"));
    }
    // Broken branches standing up along the trunk.
    for (const z of [-2.0, -0.5, 1.0, 2.2]) {
        const b = mesh(new THREE.CylinderGeometry(0.04, 0.09, 1.3 + r() * 0.6, 6), new THREE.MeshStandardMaterial({ map: bark, color: grey ? "#a8a295" : "#b89670", roughness: 0.95 }), true);
        b.position.set((r() - 0.5) * 0.4, 1.0, z);
        b.rotation.set((r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.9);
        g.add(tag(b, "solid"));
    }
    // The crown: leaves still on the broken end (needles for the grey pine).
    const leaves = grey ? ["#2f4a2b", "#3b5a33", "#2a4026"] : ["#4d6a34", "#5d7d3e", "#6c8c48"];
    const crown = foliage(r, 0, 1.0, -3.5, [2.0, 1.5, 1.5], 11, leaves);
    crown.traverse((o) => tag(o, "solid"));
    g.add(crown);
    g.rotation.y = 0.12;
    return g;
}
function rubblePile(r) {
    const g = new THREE.Group();
    const rock = rockTexture();
    const base = mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: rock, color: "#a59c8a", roughness: 1, flatShading: true }));
    base.scale.set(2.1, 2.2, 3.1);
    g.add(tag(base, "solid"));
    const blocks = new THREE.Group();
    const geoms = [new THREE.DodecahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 0.8, 1)];
    for (let i = 0; i < 46; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r());
        const x = Math.cos(a) * d * 2.1;
        const z = Math.sin(a) * d * 3.1;
        const h = 2.2 * (1 - d * d) + 0.2;
        const s = 0.25 + r() * 0.55;
        const m = mesh(geoms[i % 2], new THREE.MeshStandardMaterial({ map: rock, color: ["#9a9283", "#857d70", "#b0a794", "#7b6f5f"][i % 4], roughness: 1, flatShading: true }));
        m.scale.setScalar(s);
        m.rotation.set(r() * 3, r() * 3, r() * 3);
        m.position.set(x, h * (0.6 + r() * 0.4), z);
        blocks.add(tag(m, "solid"));
    }
    g.add(blocks);
    const beam = mesh(new THREE.BoxGeometry(0.25, 0.25, 3.2), std("#8f6448"));
    beam.position.set(-0.4, 1.8, -0.6);
    beam.rotation.set(0.3, 0.4, 0.25);
    g.add(tag(beam, "solid"));
    g.add(rocks(r, 22, () => [(r() - 0.5) * 5.2, (r() - 0.5) * 7.4], [0.08, 0.25], "#8f8777"));
    return g;
}
/** A truck tyre with a steel rim and hub, axis along x (local), radius rr, width w. */
function tyre(rr, w, rimColor, tread = 0) {
    const g = new THREE.Group();
    const rubber = std("#262624", 0.95);
    const t = mesh(new THREE.CylinderGeometry(rr, rr, w, 28), rubber);
    t.rotation.z = Math.PI / 2;
    g.add(t);
    for (const side of [-1, 1]) {
        const rim = mesh(new THREE.CylinderGeometry(rr * 0.58, rr * 0.58, 0.02, 20), std(rimColor, 0.6, { metalness: 0.3 }), false);
        rim.rotation.z = Math.PI / 2;
        rim.position.x = (side * w) / 2 + side * 0.005;
        const hub = mesh(new THREE.CylinderGeometry(rr * 0.18, rr * 0.18, 0.06, 12), std("#3a3a36", 0.5, { metalness: 0.4 }), false);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = (side * w) / 2 + side * 0.03;
        g.add(rim, hub);
    }
    // Tread lugs round the outside (tractor tyres).
    for (let i = 0; i < tread; i++) {
        const a = (i / tread) * Math.PI * 2;
        const lug = mesh(new THREE.BoxGeometry(w * 0.9, rr * 0.12, rr * 0.16), rubber, false);
        lug.position.set(0, Math.cos(a) * rr, Math.sin(a) * rr);
        lug.rotation.x = a;
        lug.rotation.y = i % 2 ? 0.35 : -0.35;
        g.add(lug);
    }
    g.traverse((o) => o.isMesh && tag(o, "solid"));
    return g;
}
/** An abandoned military cargo truck across the track: canvas-covered load bed, cab with an open door, flat tyres. */
function truck(r) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: "#5f6a52", roughness: 0.75, map: rockTexture(), metalness: 0.15 });
    const dark = std("#262823", 0.8);
    const canvasMat = new THREE.MeshStandardMaterial({ color: "#7d7a5e", roughness: 1, map: rockTexture() });
    const glass = new THREE.MeshStandardMaterial({ color: "#2b3539", roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 });
    const add = (geom, m, x, y, z, solid = true) => {
        const o = mesh(geom, m, solid);
        o.position.set(x, y, z);
        g.add(solid ? tag(o, "solid") : o);
        return o;
    };
    // Chassis rails and fuel tank.
    add(new THREE.BoxGeometry(1.4, 0.3, 6.6), dark, 0, 0.85, 0);
    add(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 14), dark, -1.0, 0.85, 0.6).rotation.x = Math.PI / 2;
    // Load bed with low steel sides, and the canvas cover over its bows (half-cylinder).
    add(new THREE.BoxGeometry(2.4, 0.18, 4.0), paint, 0, 1.12, -1.2);
    for (const x of [-1.17, 1.17])
        add(new THREE.BoxGeometry(0.06, 0.6, 4.0), paint, x, 1.5, -1.2);
    add(new THREE.BoxGeometry(2.4, 0.6, 0.06), paint, 0, 1.5, -3.18);
    const cover = add(new THREE.CylinderGeometry(1.2, 1.2, 4.0, 24, 1, false, -Math.PI / 2, Math.PI), canvasMat, 0, 1.8, -1.2);
    cover.rotation.x = Math.PI / 2;
    cover.scale.set(1, 1, 0.85);
    add(new THREE.BoxGeometry(2.4, 0.7, 4.0), canvasMat, 0, 1.95, -1.2);
    // Cab: body, sloped windscreen frame, roof, bonnet with grille, bumper, lamps, mirrors.
    add(new THREE.BoxGeometry(2.2, 1.25, 1.6), paint, 0, 1.75, 1.75);
    add(new THREE.BoxGeometry(2.1, 0.1, 1.5), paint, 0, 2.42, 1.7);
    const ws = add(new THREE.PlaneGeometry(1.8, 0.75), glass, 0, 2.05, 2.58, false);
    ws.rotation.x = -0.12;
    for (const side of [-1, 1]) {
        const sw = add(new THREE.PlaneGeometry(0.9, 0.6), glass, side * 1.105, 2.05, 1.75, false);
        sw.rotation.y = side * Math.PI / 2;
        add(new THREE.BoxGeometry(0.05, 0.3, 0.18), dark, side * 1.3, 2.1, 2.45);
    }
    add(new THREE.BoxGeometry(2.0, 0.9, 1.0), paint, 0, 1.4, 3.05);
    add(new THREE.BoxGeometry(1.6, 0.55, 0.04), dark, 0, 1.45, 3.57); // grille
    add(new THREE.BoxGeometry(2.4, 0.22, 0.2), dark, 0, 0.9, 3.65); // bumper
    for (const x of [-0.75, 0.75])
        add(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 14), std("#c9c3a6", 0.3), x, 1.5, 3.59, false).rotation.x = Math.PI / 2;
    // Mudguards over the front wheels.
    for (const x of [-1.05, 1.05])
        add(new THREE.BoxGeometry(0.4, 0.08, 1.2), dark, x, 1.08, 2.7);
    // The driver's door, left hanging open.
    const door = add(new THREE.BoxGeometry(0.06, 1.0, 0.95), paint, -1.55, 1.85, 2.15);
    door.rotation.y = -1.0;
    // Wheels: front single, rear tandem; the front left flat.
    for (const [z, flat] of [[2.65, true], [-1.7, false], [-2.75, false]])
        for (const x of [-1.0, 1.0]) {
            const t = tyre(0.52, 0.4, "#4b5141");
            t.position.set(x, flat && x < 0 ? 0.43 : 0.52, z);
            if (flat && x < 0)
                t.scale.set(1, 0.82, 1);
            g.add(t);
        }
    // Dust and mud splashed along the lower body, and a tarp tear.
    add(new THREE.BoxGeometry(2.44, 0.35, 4.02), std("#8a7e62", 1, { transparent: true, opacity: 0.5 }), 0, 1.25, -1.2, false);
    g.rotation.y = 0.1 + (r() - 0.5) * 0.02;
    g.scale.setScalar(0.92);
    return g;
}
/** A stalled farm tractor: long bonnet, open cab on four posts, big lugged rear tyres with mudguards, exhaust stack. */
function tractor() {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: "#a33f2c", roughness: 0.55, metalness: 0.15, map: rockTexture() });
    const dark = std("#2a2826", 0.8);
    const steel = std("#5b5b55", 0.5, { metalness: 0.5 });
    const add = (geom, m, x, y, z) => {
        const o = mesh(geom, m);
        o.position.set(x, y, z);
        g.add(tag(o, "solid"));
        return o;
    };
    // Engine bonnet and grille (front along +z), engine block below.
    add(new THREE.BoxGeometry(0.85, 0.75, 2.1), red, 0, 1.35, 1.0);
    add(new THREE.BoxGeometry(0.8, 0.6, 0.06), dark, 0, 1.3, 2.07);
    add(new THREE.BoxGeometry(0.7, 0.5, 1.8), dark, 0, 0.85, 0.9);
    // Front weights and axle.
    add(new THREE.BoxGeometry(0.9, 0.3, 0.3), dark, 0, 0.75, 2.2);
    add(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8), steel, 0, 0.5, 1.6).rotation.z = Math.PI / 2;
    // Body under the cab, seat, steering wheel.
    add(new THREE.BoxGeometry(1.0, 0.6, 1.0), red, 0, 1.2, -0.55);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.45), dark, 0, 1.6, -0.7);
    const wheel = add(new THREE.TorusGeometry(0.18, 0.025, 8, 20), dark, 0, 1.95, -0.1);
    wheel.rotation.x = -0.9;
    // Cab: four posts and a roof, with a glass front.
    for (const [x, z] of [[-0.62, 0.05], [0.62, 0.05], [-0.62, -1.15], [0.62, -1.15]])
        add(new THREE.BoxGeometry(0.07, 1.5, 0.07), dark, x, 2.2, z);
    add(new THREE.BoxGeometry(1.45, 0.1, 1.45), red, 0, 2.98, -0.55);
    const glass = mesh(new THREE.PlaneGeometry(1.2, 1.0), new THREE.MeshStandardMaterial({ color: "#8fa3ab", roughness: 0.05, transparent: true, opacity: 0.35, envMapIntensity: 1.5 }), false);
    glass.position.set(0, 2.35, 0.06);
    g.add(tag(glass, "solid"));
    // Exhaust stack.
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 10), dark, 0.3, 2.2, 1.6);
    // Big rear tyres with mudguards; small front ones.
    for (const x of [-0.95, 0.95]) {
        const rear = tyre(0.85, 0.48, "#c8a23a", 22);
        rear.position.set(x, 0.85, -0.7);
        g.add(rear);
        const guard = add(new THREE.CylinderGeometry(0.98, 0.98, 0.55, 20, 1, true, 0, Math.PI), red, x, 0.85, -0.7);
        guard.rotation.z = Math.PI / 2;
        guard.material.side = THREE.DoubleSide;
        const front = tyre(0.42, 0.28, "#c8a23a", 14);
        front.position.set(x * 0.88, 0.42, 1.6);
        g.add(front);
    }
    g.rotation.y = 0.15;
    return g;
}
function pole() {
    const g = new THREE.Group();
    const wood = std("#7a6650");
    const p = mesh(new THREE.CylinderGeometry(0.14, 0.17, 8.2, 10), wood);
    p.rotation.x = Math.PI / 2;
    p.position.set(0, 0.17, 0);
    p.rotation.y = 0.06;
    const arm = mesh(new THREE.BoxGeometry(0.12, 0.12, 1.4), wood);
    arm.position.set(0, 0.35, 3.0);
    arm.rotation.x = Math.PI / 2;
    g.add(tag(p, "solid"), tag(arm, "solid"));
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.2, 0.4, -4), new THREE.Vector3(-1.5, 0.2, 0), new THREE.Vector3(-0.5, 0.35, 4)]), new THREE.LineBasicMaterial({ color: "#33302c" }));
    g.add(wire);
    return g;
}
function litter(r) {
    const g = new THREE.Group();
    const colors = ["#d8cdb4", "#e6e2d8", "#c9b48c", "#dfe7ea"];
    for (let i = 0; i < 9; i++) {
        const m = mesh(new THREE.BoxGeometry(0.5 + r() * 0.7, 0.02, 0.35 + r() * 0.5), std(colors[i % 4]), false);
        m.position.set((r() - 0.5) * 3.5, 0.02, (r() - 0.5) * 3);
        m.rotation.y = r() * Math.PI;
        g.add(tag(m, "bottom"));
    }
    return g;
}
function smoke(r) {
    // A thick bank of smoke drifting across the track (Oct 10, 2026: "could be thicker"): a dense grey core low
    // down, lighter billows above and to the sides, and a haze layer hugging the ground. Sprites face the camera.
    const g = new THREE.Group();
    const tex = puffTexture();
    const puff = (x, y, z, size, color, opacity) => {
        const sm = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, rotation: r() * Math.PI * 2 });
        const sp = new THREE.Sprite(sm);
        sp.scale.set(size, size * (0.75 + r() * 0.25), 1);
        sp.position.set(x, y, z);
        g.add(tag(sp, "solid"));
    };
    // Ground haze: wide, flat and fairly opaque.
    for (let i = 0; i < 40; i++)
        puff(-3 + r() * 12, 0.5 + r() * 0.8, (r() - 0.5) * 30, 5 + r() * 4, r() < 0.5 ? "#a9a8a2" : "#b8b7b1", 0.75);
    // Dense core across the track.
    for (let i = 0; i < 90; i++)
        puff(-1 + r() * 8, 1 + r() * 3.5, (r() - 0.5) * 24, 3.5 + r() * 4.5, ["#8a8984", "#9b9a95", "#a7a6a0"][i % 3], 0.85);
    // Billows rising above, lighter and thinner.
    for (let i = 0; i < 50; i++)
        puff(-2 + r() * 11, 4 + r() * 5, (r() - 0.5) * 28, 5 + r() * 6, ["#c4c3be", "#b4b3ad"][i % 2], 0.55 + r() * 0.2);
    return g;
}
/**
 * A thin young tree fallen across the track (held back from training, Oct 10, 2026): it should read as "a fallen
 * tree" at a glance, but its trunk is wrist-thick and lies flat on the ground, below the UGV's ground clearance.
 */
function sapling(r) {
    const g = new THREE.Group();
    const bark = barkTexture(false).clone();
    bark.needsUpdate = true;
    bark.repeat.set(1, 4);
    const barkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, color: "#b39572" });
    const trunk = mesh(new THREE.CylinderGeometry(0.06, 0.1, 6.6, 10), barkMat);
    trunk.rotation.x = Math.PI / 2;
    trunk.position.set(0, 0.1, 0.4);
    g.add(tag(trunk, "bottom"));
    // A small torn root end.
    for (let i = 0; i < 6; i++) {
        const root = mesh(new THREE.CylinderGeometry(0.008, 0.02, 0.35 + r() * 0.25, 4), std("#5a4430"), false);
        const a = (i / 6) * Math.PI * 2;
        root.position.set(Math.cos(a) * 0.14, 0.11 + Math.sin(a) * 0.07, 3.7);
        root.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.8, 0, a);
        g.add(tag(root, "bottom"));
    }
    // Thin side twigs lying along the ground, a few with leaves.
    for (let i = 0; i < 14; i++) {
        const len = 0.5 + r() * 0.9;
        const tw = mesh(new THREE.CylinderGeometry(0.008, 0.016, len, 4), barkMat, false);
        const z = -2.8 + r() * 5.4;
        const side = r() < 0.5 ? -1 : 1;
        tw.rotation.set(Math.PI / 2, 0, side * (0.6 + r() * 0.5));
        tw.position.set(side * len * 0.35, 0.06 + r() * 0.08, z);
        g.add(tag(tw, "bottom"));
    }
    // A sparse, low crown of leaves at the top end, flattened against the ground.
    const crown = foliage(r, 0, 0.3, -3.1, [1.6, 0.25, 2.2], 12, ["#4d6a34", "#5d7d3e", "#6c8c48"]);
    crown.traverse((o) => tag(o, "bottom"));
    crown.scale.set(0.8, 0.5, 0.8);
    g.add(crown);
    g.rotation.y = 0.18;
    return g;
}
/**
 * A dense bed of tall reeds filling the track (held back from training, Oct 10, 2026): it should read as "brush the
 * UGV pushes through", but the stems stand taller than the vehicle and hide the ground among them.
 */
function reeds(r) {
    const g = new THREE.Group();
    const stemGeo = new THREE.ConeGeometry(0.035, 1, 4);
    stemGeo.translate(0, 0.5, 0);
    const n = 1400;
    const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, color: "#ffffff" }), n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const palette = ["#a59d58", "#b8ae68", "#8d8a4a", "#7c8645", "#c2b77a"];
    for (let i = 0; i < n; i++) {
        const depth = 7;
        const x = (r() - 0.5) * depth;
        // Thickest across the track, thinning out at its near and far edges.
        if (Math.abs(x) > depth * 0.38 && r() < 0.5)
            continue;
        pos.set(x, 0, (r() - 0.5) * 15);
        e.set((r() - 0.5) * 0.35, r() * Math.PI, (r() - 0.5) * 0.35);
        q.setFromEuler(e);
        const h = 2.4 + r() * 1.3;
        sc.set(0.8 + r() * 0.6, h, 0.8 + r() * 0.6);
        m4.compose(pos, q, sc);
        stems.setMatrixAt(i, m4);
        stems.setColorAt(i, col.set(palette[i % palette.length]));
    }
    stems.castShadow = true;
    g.add(tag(stems, "solid"));
    // Brown seed heads on the tallest stems.
    const headGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.32, 5);
    const heads = new THREE.InstancedMesh(headGeo, std("#6a4a2c"), 220);
    for (let i = 0; i < 220; i++) {
        pos.set((r() - 0.5) * 6, 2.9 + r() * 0.8, (r() - 0.5) * 14);
        e.set((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
        q.setFromEuler(e);
        m4.compose(pos, q, sc.set(1, 1, 1));
        heads.setMatrixAt(i, m4);
    }
    g.add(tag(heads, "solid"));
    // A darker, dense base so no ground shows between the stems.
    const base = mesh(new THREE.BoxGeometry(5.0, 0.8, 14), std("#5d5a32"), false);
    base.position.y = 0.4;
    g.add(tag(base, "solid"));
    return g;
}
function berm() {
    // A low earth mound across the track (held back, Oct 10, 2026): an uneven heap of bare earth with stones and a
    // few tufts of grass, so it reads as a pile of earth; but only about 0.35 m high, gently sloped.
    const g = new THREE.Group();
    const r = rng(77);
    const dome = mesh(lumpy(1, 4, 0.16, 41), new THREE.MeshStandardMaterial({ map: rockTexture(), color: "#c9b48f", roughness: 1 }));
    dome.scale.set(1.9, 0.5, 6.2);
    g.add(tag(dome, "solid"));
    const blade = new THREE.ConeGeometry(0.05, 0.4, 4);
    for (let i = 0; i < 60; i++) {
        const z = (r() - 0.5) * 11;
        const x = (r() - 0.5) * 2.2;
        const top = 0.48 * Math.max(0, 1 - (x / 1.7) ** 2) * Math.max(0, 1 - (z / 6.2) ** 2) ** 0.5;
        const t = mesh(blade, std(["#6d8746", "#7f9a52", "#8a9a5a"][i % 3]), false);
        t.position.set(x, top + 0.15, z);
        t.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
        g.add(tag(t, "solid"));
    }
    const st = rocks(r, 22, () => [(r() - 0.5) * 2.4, (r() - 0.5) * 8], [0.05, 0.13], "#6f6656");
    st.traverse((o) => {
        if (o.isMesh)
            o.position.y += 0.44 * Math.max(0, 1 - (o.position.x / 1.9) ** 2);
        tag(o, "solid");
    });
    g.add(st);
    return g;
}
/**
 * A shallow dry ditch across the track (Oct 11, 2026 rework): a real dip. The ground is one flat mesh, so the ditch
 * is drawn through a stencil "portal": an invisible opening at ground level marks the pixels where the ground is cut
 * away, then the trough below it (floor and gently sloping banks, lit by the sun) is drawn only there, far bank
 * first so nearer parts cover it. Earth ridges, overhanging grass and stones sit on top as ordinary objects.
 * Used only for a judgment card (never on the mission route).
 */
function ditch(r) {
    const g = new THREE.Group();
    const half = 1.25; // half the width of the opening along the route (2.5 m across)
    const len = 13;
    const depth = 0.7;
    const n = valueNoise(57);
    // The opening: writes 1 into the stencil buffer where it is visible (in front of nothing nearer), draws no colour.
    // A wandering outline, a little inside the trough's rim, so the edges look dug rather than ruled.
    const outline = new THREE.Shape();
    const NS = 40;
    for (let k = 0; k <= NS; k++) {
        const z = -len / 2 + 0.6 + (k / NS) * (len - 1.2);
        const x = half * (0.86 + 0.12 * n(z * 0.9, 1));
        if (k === 0)
            outline.moveTo(x, z);
        else
            outline.lineTo(x, z);
    }
    for (let k = NS; k >= 0; k--) {
        const z = -len / 2 + 0.6 + (k / NS) * (len - 1.2);
        outline.lineTo(-half * (0.86 + 0.12 * n(z * 0.9, 7)), z);
    }
    const openGeom = new THREE.ShapeGeometry(outline);
    openGeom.rotateX(Math.PI / 2); // shape (x, z) in its x/y plane → ground plane, z along the ditch
    const opening = new THREE.Mesh(openGeom, new THREE.MeshBasicMaterial({
        colorWrite: false, transparent: true, side: THREE.DoubleSide, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp
    }));
    opening.position.y = 0.03;
    opening.userData = { role: "portal", renderOrder: 7.5, keepMaterial: true };
    g.add(opening);
    // The trough: profile across the ditch (x from far to near, so later triangles are nearer the camera), swept along
    // z; the depth eases out towards both ends so it meets the ground.
    const prof = [];
    for (let i = 0; i <= 16; i++) {
        const x = half - (i / 16) * half * 2; // +half (far) ... -half (near)
        const t = Math.abs(x) / half;
        prof.push([x, -depth * (1 - Math.pow(t, 2.4))]); // gentle banks, flat-ish floor
    }
    const NZ = 52;
    const pos = [];
    const col = [];
    const uv = [];
    for (let j = 0; j <= NZ; j++) {
        const z = -len / 2 + (j / NZ) * len;
        const ease = Math.min(1, (len / 2 - Math.abs(z)) / 1.4);
        for (const [x, y0] of prof) {
            const y = y0 * (ease * ease * (3 - 2 * ease)) + (n(x * 3 + 5, z * 2) - 0.5) * 0.05;
            pos.push(x, Math.min(0.0, y), z);
            // Darker towards the floor (less sky reaches it), and the near half of the floor in the near bank's shadow.
            const deep = Math.min(1, -y / depth);
            const shadow = x < 0.15 && deep > 0.5 ? 0.72 : 1;
            const shade = (0.42 + 0.58 * (1 - deep) ** 1.4) * shadow;
            col.push(shade, shade * 0.97, shade * 0.93);
            uv.push(x / 2 + 0.5, z / 3);
        }
    }
    const idx = [];
    const W = prof.length;
    for (let i = 0; i < W - 1; i++) // far → near
        for (let j = 0; j < NZ; j++) {
            const a = j * W + i, b = (j + 1) * W + i, c = j * W + i + 1, d = (j + 1) * W + i + 1;
            idx.push(a, c, b, c, d, b); // counter-clockwise seen from above
        }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geom.setIndex(idx);
    geom.computeVertexNormals();
    const earth = rockTexture().clone();
    earth.needsUpdate = true;
    earth.repeat.set(2, 2);
    const trough = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        map: earth, color: "#cdbb98", vertexColors: true, roughness: 1, transparent: true, depthTest: false, depthWrite: false,
        stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp
    }));
    trough.receiveShadow = true;
    trough.userData = { role: "bottom", renderOrder: 7.6, keepMaterial: true };
    g.add(trough);
    // Stones and clods on the floor, and a few dead leaves (drawn through the opening too).
    const floorBits = new THREE.Group();
    for (let i = 0; i < 34; i++) {
        const s = 0.03 + r() * 0.07;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({
            color: i % 4 ? "#7a6a54" : "#8a6a3c", roughness: 1, flatShading: true, transparent: true, depthTest: false, depthWrite: false,
            stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp
        }));
        m.scale.set(s * 1.2, s * 0.6, s);
        m.position.set(-0.35 + r() * 0.7, -depth + s * 0.3, (r() - 0.5) * (len - 4));
        m.userData = { role: "bottom", renderOrder: 7.7, keepMaterial: true };
        floorBits.add(m);
    }
    g.add(floorBits);
    // Dug-out earth along both lips (low), and grass hanging over them.
    for (const [x, colr] of [[-half - 0.15, "#8f8a62"], [half + 0.12, "#a69070"]]) {
        const ridge = mesh(lumpy(1, 3, 0.22, x > 0 ? 51 : 52), new THREE.MeshStandardMaterial({ map: rockTexture(), color: colr, roughness: 1 }));
        ridge.scale.set(0.3, x > 0 ? 0.12 : 0.08, len / 2 - 0.6);
        ridge.position.set(x, -0.02, 0);
        g.add(tag(ridge, "bottom"));
    }
    const blade = new THREE.ConeGeometry(0.035, 0.38, 4);
    for (let i = 0; i < 320; i++) {
        const side = i % 2 ? 1 : -1;
        const t = mesh(blade, std(["#6d8746", "#7f9a52", "#5f7a3e", "#8f9c5a"][i % 4]), false);
        t.position.set(side * (half + 0.05 + r() * 0.35), 0.1, (r() - 0.5) * (len - 1));
        t.rotation.set((r() - 0.5) * 0.4, 0, -side * (0.3 + r() * 0.5));
        g.add(tag(t, "bottom"));
    }
    return g;
}
/**
 * The obstacle for an event kind (event-definitions.ts ids), in local axes. Bridge excluded: the world builds it
 * with the ravine (world.ts). Returns null for kinds that are only a change in the ground (built by the caller).
 */
export function buildObstacle(kindId) {
    const r = rng([...kindId].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    const onTrack = (len, half = TRACK_HALF - 0.2) => () => [(r() - 0.5) * len, (r() - 0.5) * 2 * half];
    const g = new THREE.Group();
    switch (kindId) {
        case "small_debris":
            g.add(rocks(r, 70, onTrack(6), [0.05, 0.16], "#6e665a"));
            g.add(sticks(r, 16, onTrack(6)));
            break;
        case "small_debris_b": {
            g.add(rocks(r, 40, onTrack(6), [0.04, 0.1], "#8a7c66"));
            g.add(sticks(r, 26, onTrack(6), "#6b5033"));
            const cone = new THREE.ConeGeometry(0.05, 0.12, 6);
            for (let i = 0; i < 20; i++) {
                const [x, z] = onTrack(6)();
                const m = mesh(cone, std("#7a5532"), false);
                m.rotation.z = Math.PI / 2;
                m.position.set(x, 0.05, z);
                g.add(m);
            }
            break;
        }
        case "shallow_water": {
            // Clear, shallow rainwater: the ruts, pebbles and earth show through.
            g.add(rocks(r, 22, onTrack(5), [0.04, 0.09], "#7a7266"));
            g.add(water(5.6, 7, { color: "#86c4ea", opacity: 0.6, edge: "#5f5844" }, 11));
            break;
        }
        case "gravel_ford": {
            const bottom = rocks(r, 120, () => [(r() - 0.5) * 4, (r() - 0.5) * 16], [0.04, 0.1], "#8a8170");
            bottom.traverse((o) => tag(o, "bottom"));
            g.add(bottom);
            g.add(water(16, 4.4, { color: "#86c4ea", opacity: 0.6, edge: "#6a6250" }, 12));
            break;
        }
        case "light_brush": {
            const blade = new THREE.ConeGeometry(0.05, 0.6, 4);
            for (let i = 0; i < 240; i++) {
                const edge = r() < 0.8;
                const z = edge ? (r() < 0.5 ? -1 : 1) * (1.0 + r() * 1.6) : (r() - 0.5) * 0.8;
                const m = mesh(blade, std(["#5f7a3e", "#6d8746", "#7f9a52"][i % 3]), false);
                const h = 0.6 + r() * 0.8;
                m.scale.set(1, h, 1);
                m.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
                m.position.set((r() - 0.5) * 7, 0.3 * h, z);
                g.add(tag(m, "solid"));
            }
            break;
        }
        case "rubble_pile":
            g.add(rubblePile(r));
            break;
        case "fallen_tree":
            g.add(fallenTree(r));
            break;
        case "fallen_tree_b":
            g.add(fallenTree(r, true));
            break;
        case "abandoned_vehicle":
            g.add(truck(r));
            break;
        case "stalled_tractor":
            g.add(tractor());
            break;
        case "fallen_pole":
            g.add(pole());
            break;
        case "flat_litter":
            g.add(litter(r));
            break;
        case "smoke_drift":
            g.add(smoke(r));
            break;
        case "fallen_sapling":
            g.add(sapling(r));
            break;
        case "tall_reeds":
            g.add(reeds(r));
            break;
        case "flooded_dip":
            // Muddy brown water filling a dip: opaque, so nothing below the surface can be seen; churned mud round it.
            g.add(water(9, 7, { color: "#7c6646", opacity: 1, edge: "#86714f", muddy: true }, 14, 0.05));
            break;
        case "dry_ditch":
            g.add(ditch(r));
            break;
        case "low_berm":
            g.add(berm());
            break;
    }
    return g;
}
/** Section line: a row of marker stakes with red and white flags across the track. */
export function sectionStakes() {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
        const z = -4 + i;
        const stake = mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), std("#5b4a36"));
        stake.position.set(0, 0.7, z);
        const flag = mesh(new THREE.PlaneGeometry(0.5, 0.3), std(i % 2 ? "#e9e4d4" : "#c9483f", 0.8, { side: THREE.DoubleSide }), false);
        flag.position.set(0, 1.25, z + 0.25);
        flag.rotation.y = Math.PI / 2;
        g.add(stake, flag);
    }
    return g;
}
/** The objective: a small observation post with sandbag walls and a mast. */
export function outpost() {
    const g = new THREE.Group();
    const bag = std("#a9946c");
    for (let i = 0; i < 3; i++) {
        const wall = mesh(new THREE.BoxGeometry(0.8, 1.0, 7), bag);
        wall.position.set(8 + i * 0.1, 0.5 + 0, i === 1 ? -6 : 6 * (i - 1));
        g.add(wall);
    }
    const hut = mesh(new THREE.BoxGeometry(4, 2.6, 4), std("#7a6b55"));
    hut.position.set(12, 1.3, 7);
    const roof = mesh(new THREE.BoxGeometry(4.4, 0.25, 4.4), std("#5b4a36"));
    roof.position.set(12, 2.7, 7);
    const mast = mesh(new THREE.CylinderGeometry(0.06, 0.08, 8, 6), std("#3b3a36"));
    mast.position.set(13, 4, 9);
    const flag = mesh(new THREE.PlaneGeometry(1.4, 0.8), std("#3e6fa8", 0.8, { side: THREE.DoubleSide }), false);
    flag.position.set(13, 7.4, 9.75);
    flag.rotation.y = Math.PI / 2;
    g.add(hut, roof, mast, flag);
    return g;
}
/** A rounded crown: an icosphere with its surface pushed in and out by smooth noise. */
function lumpy(r, detail, amount, seed) {
    const geom = new THREE.IcosahedronGeometry(r, detail);
    const p = geom.attributes.position;
    const n = valueNoise(seed);
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + (n(x * 2.2 + 5, z * 2.2 + y * 1.7 + 5) - 0.5) * 2 * amount;
        p.setXYZ(i, x * k, y * k * (y < 0 ? 0.7 : 1), z * k);
    }
    geom.computeVertexNormals();
    return geom;
}
function lumpyCone() {
    const geom = new THREE.ConeGeometry(1, 1, 14, 4);
    const p = geom.attributes.position;
    const n = valueNoise(13);
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + (n(Math.atan2(z, x) * 3 + 9, y * 6 + 9) - 0.5) * 0.5;
        p.setXYZ(i, x * k, y, z * k);
    }
    geom.computeVertexNormals();
    return geom;
}
/** Two vertical quads crossed at right angles, base at y = 0, 1 high (grass clumps). */
function crossedQuads() {
    const a = new THREE.PlaneGeometry(1, 1);
    a.translate(0, 0.5, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const c = a.clone();
    c.rotateY(Math.PI / 4);
    const pos = [];
    const uv = [];
    const idx = [];
    let base = 0;
    for (const g of [a, b, c]) {
        const gi = g.index.array;
        for (let i = 0; i < g.attributes.position.count; i++) {
            pos.push(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i));
            uv.push(g.attributes.uv.getX(i), g.attributes.uv.getY(i));
        }
        for (const k of gi)
            idx.push(k + base);
        // And the back face (reversed), so both sides keep the upward normal and are lit like the ground.
        for (let t = 0; t < gi.length; t += 3)
            idx.push(gi[t] + base, gi[t + 2] + base, gi[t + 1] + base);
        base += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    // Normals pointing up, so the clumps are lit like the ground around them.
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3)
        nrm[i] = 1;
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    return out;
}
const vegCache = new Map();
function vegAssets(dry) {
    if (vegCache.has(dry))
        return vegCache.get(dry);
    const base = vegCache.get(!dry);
    const a = {
        trunk: base?.trunk ?? new THREE.CylinderGeometry(0.1, 0.22, 1, 7),
        bark: base?.bark ?? new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 1 }),
        foliage: base?.foliage ?? new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.92 }),
        canopy: base?.canopy ?? lumpy(1, 2, 0.22, 11),
        canopyFar: base?.canopyFar ?? lumpy(1, 1, 0.2, 11),
        cone: base?.cone ?? lumpyCone(),
        shrub: base?.shrub ?? lumpy(1, 1, 0.25, 12),
        tuft: base?.tuft ?? crossedQuads(),
        grass: new THREE.MeshStandardMaterial({ map: bladeTexture(dry), alphaTest: 0.45, roughness: 1 })
    };
    vegCache.set(dry, a);
    return a;
}
export function vegetation(plants, dry, far = false) {
    const g = new THREE.Group();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const make = (geom, material, count, shadow) => {
        const im = new THREE.InstancedMesh(geom, material, Math.max(1, count));
        im.castShadow = shadow;
        im.receiveShadow = true;
        im.count = 0;
        g.add(im);
        return im;
    };
    const trees = plants.filter((p) => p.kind === "tree");
    const conifers = plants.filter((p) => p.kind === "conifer");
    const shrubs = plants.filter((p) => p.kind === "shrub");
    const tufts = plants.filter((p) => p.kind === "tuft");
    const V = vegAssets(dry);
    const trunkM = make(V.trunk, V.bark, trees.length + conifers.length, !far);
    const canopyM = make(far ? V.canopyFar : V.canopy, V.foliage, trees.length * 4, !far);
    const coneM = make(V.cone, V.foliage, conifers.length * 3, true);
    const shrubM = make(V.shrub, V.foliage, shrubs.length * 2, true);
    const tuftM = make(V.tuft, V.grass, tufts.length, false);
    tuftM.name = "tufts";
    const put = (im, x, y, z, sx, sy, sz, rotY, color, k) => {
        e.set(0, rotY, 0);
        q.setFromEuler(e);
        m4.compose(v.set(x, y, z), q, sc.set(sx, sy, sz));
        const i = im.count++;
        im.setMatrixAt(i, m4);
        col.set(color).multiplyScalar(k);
        im.setColorAt(i, col);
    };
    const leaf = dry ? ["#6b7547", "#7b8452", "#5d6a40"] : ["#4a6633", "#56743d", "#638346", "#3f5a2e"];
    for (const p of trees) {
        const h = 6 * p.s;
        put(trunkM, p.x, h * 0.35, p.z, p.s, h * 0.7, p.s, 0, "#d9d0c2", 1);
        const k = 0.85 + p.tone * 0.3;
        put(canopyM, p.x, h * 0.78, p.z, 2.3 * p.s, 1.9 * p.s, 2.3 * p.s, p.tone * 6, leaf[0], k);
        if (far)
            continue; // a distant tree: one crown is enough
        put(canopyM, p.x + 0.9 * p.s, h * 0.68, p.z + 0.5 * p.s, 1.6 * p.s, 1.4 * p.s, 1.6 * p.s, p.tone * 3, leaf[1], k);
        put(canopyM, p.x - 0.8 * p.s, h * 0.72, p.z - 0.6 * p.s, 1.7 * p.s, 1.5 * p.s, 1.7 * p.s, p.tone * 2, leaf[2], k);
        put(canopyM, p.x - 0.2 * p.s, h * 0.95, p.z + 0.2 * p.s, 1.3 * p.s, 1.2 * p.s, 1.3 * p.s, p.tone, leaf[3 % leaf.length], k * 1.1);
    }
    for (const p of conifers) {
        const h = 9 * p.s;
        put(trunkM, p.x, h * 0.2, p.z, p.s * 0.8, h * 0.4, p.s * 0.8, 0, "#c9bfb0", 1);
        const k = 0.8 + p.tone * 0.3;
        put(coneM, p.x, h * 0.4, p.z, 2.0 * p.s, h * 0.45, 2.0 * p.s, p.tone * 5, "#2f4a2b", k);
        put(coneM, p.x, h * 0.6, p.z, 1.5 * p.s, h * 0.4, 1.5 * p.s, p.tone * 3, "#355431", k);
        put(coneM, p.x, h * 0.8, p.z, 0.95 * p.s, h * 0.32, 0.95 * p.s, p.tone, "#3c5e36", k * 1.05);
    }
    const bush = dry ? ["#6a6d46", "#7d8455", "#8d935f"] : ["#4d6636", "#62803f", "#56703a"];
    for (const p of shrubs) {
        const k = 0.85 + p.tone * 0.3;
        put(shrubM, p.x, 0.45 * p.s, p.z, 1.1 * p.s, 0.75 * p.s, 1.1 * p.s, p.tone * 4, bush[0], k);
        put(shrubM, p.x + 0.4 * p.s, 0.6 * p.s, p.z - 0.3 * p.s, 0.75 * p.s, 0.55 * p.s, 0.75 * p.s, p.tone * 2, bush[1], k * 1.08);
    }
    for (const p of tufts)
        put(tuftM, p.x, 0, p.z, 1.1 * p.s, 0.55 * p.s, 1.1 * p.s, p.tone * 6, "#ffffff", 0.8 + p.tone * 0.35);
    for (const im of [trunkM, canopyM, coneM, shrubM, tuftM]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor)
            im.instanceColor.needsUpdate = true;
        if (im.count === 0)
            im.visible = false;
        else
            im.computeBoundingSphere();
    }
    return g;
}
/** The height-map look (C4's robot view): ground dark blue, objects teal or orange, flat-lit. */
export const HEIGHT_MAP = {
    sky: "#14212e",
    ground: "#1b2d40",
    track: "#22394f",
    passable: "#3fc7b0",
    blocked: "#f08a3c"
};
