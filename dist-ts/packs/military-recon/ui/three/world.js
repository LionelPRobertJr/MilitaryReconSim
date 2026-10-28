import * as THREE from "three";
import { cumulative, pointAt, slice } from "../../sim/geometry.js";
import { OBSTACLE_AHEAD, wayRound, wayRoundPins } from "../../sim/route.js";
import { buildObstacle, outpost, sectionStakes, TRACK_HALF, vegetation } from "./models.js";
import { grassTexture, rng, rockTexture, skyTexture, trackTexture, valueNoise, vergeTexture } from "./textures.js";
// One UGV's world in 3D (three.js, vendored): its route as a dirt track across open country, scrubland and
// woodland, hills and haze, sun and shadows, and its obstacles as 3D objects that appear when the UGV detects
// them. The camera is the UGV's forward camera at the vehicle's real position, so what the participant sees
// matches the simulation: the distance to an obstacle, the stopping point, and the way round (route.ts
// wayRound, the same function the simulation drives) are all the same geometry.
//
// One map unit is SCALE metres. Map y points down, which becomes +z in the world; seen from the vehicle, +z is
// to the right of the direction of travel.
export const SCALE = 6;
const CAM_HEIGHT = 2.1;
const SECTION_TERRAIN = { A: "open", B: "scrub", C: "wood" };
const TINT = { open: [1, 1, 1], scrub: [1.12, 1.04, 0.86], wood: [0.86, 0.95, 0.82] };
/** The bridge's patch of ground, in its local axes (x along the route from the bridge's start, z across). */
const PATCH = { x0: -22, x1: 34, d: 168 };
const w3 = (p, y = 0) => new THREE.Vector3(p.x * SCALE, y, p.y * SCALE);
const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
/**
 * Obstacles are drawn after the track (which is blended over the ground and does not write depth), so a low
 * obstacle lying on the track is never painted over by it: things on the bottom of a puddle first, then the
 * water, then everything solid.
 */
function drawAfterTrack(g) {
    g.traverse((o) => {
        // Sprites (the smoke's puffs) come last, so the track is never painted over them (Oct 28, 2026: the track
        // showed clearly through the smoke bank, as if there were a clear lane through it).
        if (o.isSprite) {
            o.renderOrder = o.userData?.renderOrder ?? 11;
            return;
        }
        if (!o.isMesh)
            return;
        const role = o.userData?.role;
        o.renderOrder = o.userData?.renderOrder ?? (role === "water" ? 9 : role === "bottom" ? 8 : role === "surface" ? 7 : 10);
        if (o.userData?.keepMaterial)
            return; // e.g. the ditch's stencil portal and trough (models.ts)
        if (!o.material.transparent) {
            o.material = o.material.clone();
            o.material.transparent = true;
            o.material.opacity = 1;
        }
    });
}
let envCache = null;
function environment(renderer) {
    if (envCache && envCache.renderer === renderer)
        return envCache.texture;
    const pm = new THREE.PMREMGenerator(renderer);
    const sky = skyTexture().clone();
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.needsUpdate = true;
    const texture = pm.fromEquirectangular(sky).texture;
    pm.dispose();
    envCache = { renderer, texture };
    return texture;
}
export class World3D {
    canvas;
    network;
    robotId;
    renderer;
    scene;
    camera;
    sun;
    sky;
    /** False hides trees and grass (the C4 height map). */
    showScenery = true;
    obstacles = new Map();
    /** Grass clumps per chunk: drawn only near the camera (they are too small to see further off). */
    tufts = [];
    bridge = null;
    wp;
    wpKey = "";
    pinPoints = [];
    heading = null;
    route;
    sectionOf;
    constructor(canvas, network, robotId, 
    /** A renderer to share (the training studio renders many small worlds with one). */
    shared) {
        this.canvas = canvas;
        this.network = network;
        this.robotId = robotId;
        this.route = network.routes[robotId];
        const ends = this.route.sectionEnds;
        this.sectionOf = (s) => SECTION_TERRAIN[network.sections[Math.max(0, ends.findIndex((e) => s <= e + 1e-6))] ?? "A"] ?? "open";
        this.renderer = shared ?? new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog("#cfdbe0", 90, 700);
        // 50 degrees vertical (was 60, Oct 10, 2026): low, flat obstacles were a sliver at 35 m; the same as the training pictures.
        this.camera = new THREE.PerspectiveCamera(50, 2, 0.15, 760);
        // The sky: a panorama behind everything (scene background), so the far plane can stay close.
        const sky = skyTexture();
        sky.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.background = sky;
        // The same sky lights the scene softly from all round and is what water reflects.
        this.scene.environment = environment(this.renderer);
        this.scene.environmentIntensity = 0.55;
        this.sky = { visible: true };
        this.scene.add(new THREE.HemisphereLight("#dbe7ee", "#6c7448", 0.75));
        this.sun = new THREE.DirectionalLight("#fff1d6", 2.4);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        const sc = this.sun.shadow.camera;
        sc.left = -70;
        sc.right = 70;
        sc.top = 70;
        sc.bottom = -70;
        sc.near = 1;
        sc.far = 400;
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.03;
        this.scene.add(this.sun, this.sun.target);
        this.buildGround();
        this.buildTrack();
        this.buildScenery();
        this.buildObstacles();
        this.buildMarkers();
        this.wp = new THREE.Group();
        this.scene.add(this.wp);
    }
    dispose() {
        this.renderer.dispose();
    }
    /** Frees this world's geometry and materials (textures are shared and kept). */
    disposeScene() {
        this.scene.traverse((o) => {
            o.geometry?.dispose?.();
            for (const m of [].concat(o.material ?? []))
                m.dispose?.();
        });
    }
    // --- building -------------------------------------------------------------------------------------------
    routeAt(s) {
        const p = pointAt(this.route.points, this.route.cum, s);
        return { x: p.x * SCALE, z: p.y * SCALE, h: p.heading };
    }
    /** The route's z at world x (the route runs left to right across the map, so x is monotonic along it). */
    routeZ(x) {
        const pts = this.route.points;
        let lo = 0;
        let hi = pts.length - 1;
        const X = x / SCALE;
        if (X <= pts[0].x)
            return pts[0].y * SCALE;
        if (X >= pts[hi].x)
            return pts[hi].y * SCALE;
        while (hi - lo > 1) {
            const m = (lo + hi) >> 1;
            if (pts[m].x <= X)
                lo = m;
            else
                hi = m;
        }
        const t = (X - pts[lo].x) / (pts[hi].x - pts[lo].x || 1);
        return (pts[lo].y + (pts[hi].y - pts[lo].y) * t) * SCALE;
    }
    /** Route arc length at world x (approximate; used to pick the terrain type of the ground there). */
    sAtX(x) {
        const pts = this.route.points;
        const X = x / SCALE;
        let lo = 0;
        let hi = pts.length - 1;
        if (X <= pts[0].x)
            return 0;
        if (X >= pts[hi].x)
            return this.route.length;
        while (hi - lo > 1) {
            const m = (lo + hi) >> 1;
            if (pts[m].x <= X)
                lo = m;
            else
                hi = m;
        }
        return this.route.cum[lo];
    }
    /** The bridge's ravine area, in the bridge's local axes (for cutting it out of the ground). */
    bridgeFrame() {
        const crit = this.network.events.find((e) => e.robotId === this.robotId && e.classId === "critical_novel");
        if (!crit)
            return null;
        const o = this.routeAt(crit.sE);
        const c = Math.cos(o.h);
        const sn = Math.sin(o.h);
        return {
            origin: o,
            inside: (x, z) => {
                const dx = x - o.x;
                const dz = z - o.z;
                const lx = dx * c + dz * sn;
                const lz = -dx * sn + dz * c;
                return lx > PATCH.x0 && lx < PATCH.x1 && Math.abs(lz) < PATCH.d / 2;
            }
        };
    }
    hills = null;
    /** Ground height at world (x, z): flat along the route, rolling hills further off. */
    groundY(x, z) {
        const hills = (this.hills ??= valueNoise(this.robotId === "UGV1" ? 21 : 22));
        const d = Math.abs(z - this.routeZ(x));
        const far = smoothstep(18, 90, d);
        const h = far * (hills(x / 260, z / 260) * 26 + hills(x / 70 + 50, z / 70) * 5 - 6) + smoothstep(500, 1000, d) * 40 * hills(x / 400 + 9, z / 400);
        return Math.max(-2, h);
    }
    grid = null;
    /** Height of the ground mesh itself at (x, z): the same triangles the renderer draws, so patches laid on it match. */
    groundMeshY(x, z) {
        const g = this.grid;
        const fx0 = (x - g.xmin) / g.cell;
        const fz0 = (z - g.zmin) / g.cell;
        const i = Math.max(0, Math.min(g.nx - 1, Math.floor(fx0)));
        const j = Math.max(0, Math.min(g.nz - 1, Math.floor(fz0)));
        const fx = fx0 - i;
        const fz = fz0 - j;
        const at = (ii, jj) => g.y[jj * (g.nx + 1) + ii];
        const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
        return fx + fz <= 1 ? a + fx * (b - a) + fz * (c - a) : d + (1 - fx) * (c - d) + (1 - fz) * (b - d);
    }
    tintNoise = null;
    /** The ground's colour tint at (x, z): by section, with slow patchy variation. */
    groundTint(x, z) {
        const n = (this.tintNoise ??= valueNoise(this.robotId === "UGV1" ? 31 : 32));
        const t = TINT[this.sectionOf(this.sAtX(x))];
        const k = 0.86 + n(x / 90, z / 90) * 0.26;
        return [t[0] * k, t[1] * k, t[2] * k];
    }
    /** Lifts a geometry placed at origin o (turned to heading o.h) onto the ground's rolling surface. */
    drape(geom, o, tint = false) {
        const p = geom.attributes.position;
        const c = Math.cos(o.h);
        const sn = Math.sin(o.h);
        const col = [];
        for (let i = 0; i < p.count; i++) {
            const lx = p.getX(i);
            const lz = p.getZ(i);
            const X = o.x + lx * c - lz * sn;
            const Z = o.z + lx * sn + lz * c;
            p.setY(i, p.getY(i) + this.groundMeshY(X, Z));
            if (tint)
                col.push(...this.groundTint(X, Z));
        }
        if (tint)
            geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        geom.computeVertexNormals();
    }
    buildGround() {
        const pts = this.route.points;
        const xmin = pts[0].x * SCALE - 420;
        const xmax = pts.at(-1).x * SCALE + 420;
        const zs = pts.map((p) => p.y * SCALE);
        const zmid = (Math.min(...zs) + Math.max(...zs)) / 2;
        const zmin = zmid - 1100;
        const zmax = zmid + 1100;
        const cell = 12;
        const nx = Math.ceil((xmax - xmin) / cell);
        const nz = Math.ceil((zmax - zmin) / cell);
        const pos = [];
        const uv = [];
        const col = [];
        for (let j = 0; j <= nz; j++)
            for (let i = 0; i <= nx; i++) {
                const x = xmin + i * cell;
                const z = zmin + j * cell;
                pos.push(x, this.groundY(x, z), z);
                uv.push(x / 10, z / 10);
                col.push(...this.groundTint(x, z));
            }
        this.grid = { xmin, zmin, cell, nx, nz, y: pos.filter((_, k) => k % 3 === 1) };
        const bridge = this.bridgeFrame();
        const idx = [];
        for (let j = 0; j < nz; j++)
            for (let i = 0; i < nx; i++) {
                // Cells wholly inside the bridge patch are left out; the patch covers them (and overlaps the rest).
                const x0 = xmin + i * cell;
                const z0 = zmin + j * cell;
                if (bridge && [[x0, z0], [x0 + cell, z0], [x0, z0 + cell], [x0 + cell, z0 + cell]].every(([X, Z]) => bridge.inside(X, Z)))
                    continue;
                const a = j * (nx + 1) + i;
                const b = a + 1;
                const c = a + nx + 1;
                const d = c + 1;
                idx.push(a, c, b, b, c, d);
            }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        geom.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        geom.setIndex(idx);
        geom.computeVertexNormals();
        const grass = grassTexture("open");
        const ground = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1 }));
        ground.receiveShadow = true;
        this.scene.add(ground);
    }
    /** A strip along the route (or any path) between lateral offsets, as a textured mesh lying on the ground. */
    ribbon(path, half, y, material, vScale, from = 0, to = Infinity) {
        const cum = cumulative(path);
        const pos = [];
        const uv = [];
        const idx = [];
        const total = cum.at(-1);
        const step = 0.4;
        let k = 0;
        for (let a = Math.max(0, from); a <= Math.min(total, to) + 1e-9; a += step) {
            const p = pointAt(path, cum, Math.min(a, total));
            const nx = -Math.sin(p.heading);
            const nz = Math.cos(p.heading);
            const X = p.x * SCALE;
            const Z = p.y * SCALE;
            pos.push(X - nx * half, y, Z - nz * half, X + nx * half, y, Z + nz * half);
            const v = (a * SCALE) / vScale;
            uv.push(0, v, 1, v);
            if (k > 0) {
                const b = (k - 1) * 2;
                idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); // counter-clockwise from above
            }
            k++;
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        geom.setIndex(idx);
        geom.computeVertexNormals();
        const m = new THREE.Mesh(geom, material);
        m.receiveShadow = true;
        return m;
    }
    buildTrack() {
        const verge = new THREE.MeshStandardMaterial({ map: vergeTexture(), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        const track = new THREE.MeshStandardMaterial({ map: trackTexture(), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const crit = this.network.events.find((e) => e.robotId === this.robotId && e.classId === "critical_novel");
        const pts = this.route.points;
        const spans = crit ? [[0, crit.sE - 0.4], [crit.sE + 2.45, Infinity]] : [[0, Infinity]];
        for (const [a, b] of spans) {
            const v = this.ribbon(pts, 3.6, 0.02, verge, 14, a, b);
            v.renderOrder = 1;
            const t = this.ribbon(pts, TRACK_HALF, 0.04, track, 12, a, b);
            t.renderOrder = 2;
            this.scene.add(v, t);
        }
        if (crit) {
            // The track where the ravine will be: shown until the UGV detects the bridge, with the flat ground there.
            const fillV = this.ribbon(pts, 3.6, 0.02, verge, 14, crit.sE - 0.4, crit.sE + 2.45);
            const fillT = this.ribbon(pts, TRACK_HALF, 0.04, track, 12, crit.sE - 0.4, crit.sE + 2.45);
            fillV.renderOrder = 1;
            fillT.renderOrder = 2;
            const g = new THREE.Group();
            g.add(fillV, fillT);
            this.scene.add(g);
            this.pendingFlatTrack = g;
        }
    }
    pendingFlatTrack = null;
    buildScenery() {
        const r = rng(this.robotId === "UGV1" ? 1201 : 1202);
        const keepClear = this.network.events
            .filter((e) => e.robotId === this.robotId)
            .map((e) => ({ s: e.classId === "critical_novel" ? e.sE + 1 : e.sE + OBSTACLE_AHEAD, critical: e.classId === "critical_novel" }));
        const bridge = this.bridgeFrame();
        // Plants are grouped in chunks along the route, so the renderer skips the chunks out of view.
        const CHUNK = 24;
        const chunks = new Map();
        const add = (s, lateral, kind, size) => {
            // Open ground beside every obstacle, so the way round is plainly clear; nothing in the ravine.
            for (const k of keepClear) {
                if (kind !== "tuft" && Math.abs(s - k.s) < (k.critical ? 4.5 : 3.6) && Math.abs(lateral) < (k.critical ? 24 : 14))
                    return;
                if (kind === "tuft" && Math.abs(s - k.s) < (k.critical ? 3 : 1.6) && Math.abs(lateral) < (k.critical ? 24 : 6))
                    return;
            }
            const p = this.routeAt(s);
            const x = p.x - Math.sin(p.h) * lateral;
            const z = p.z + Math.cos(p.h) * lateral;
            if (bridge && bridge.inside(x, z))
                return;
            const terrain = this.sectionOf(s);
            const key = `${Math.floor(s / CHUNK)}|${terrain === "scrub" ? "dry" : "wet"}|${Math.abs(lateral) > 120 ? "far" : "near"}`;
            if (!chunks.has(key))
                chunks.set(key, []);
            chunks.get(key).push({ x, z, s: size, kind, tone: r() });
        };
        const len = this.route.length;
        for (let s = 0; s < len; s += 1) {
            const t = this.sectionOf(s);
            for (const side of [-1, 1]) {
                // Tufts and small plants along the verge.
                for (let i = 0; i < 16; i++)
                    add(s + r(), side * (2.3 + Math.pow(r(), 1.7) * 34), "tuft", 0.55 + r() * 0.7);
                // A few low clumps on the hump between the wheel ruts.
                if (side < 0 && r() < 0.6)
                    add(s + r(), (r() - 0.5) * 0.5, "tuft", 0.35 + r() * 0.2);
                const nTrees = t === "wood" ? 3.2 : t === "open" ? 0.35 : 0.22;
                const nShrubs = t === "scrub" ? 3 : t === "open" ? 0.9 : 1.2;
                const count = (n) => Math.floor(n) + (r() < n - Math.floor(n) ? 1 : 0);
                for (let i = 0; i < count(nTrees); i++) {
                    const near = t === "wood" ? 9 + Math.pow(r(), 1.6) * 90 : 14 + Math.pow(r(), 0.8) * 240;
                    const kind = t === "wood" && r() < 0.35 ? "conifer" : "tree";
                    add(s + r(), side * near, kind, 0.75 + r() * 0.6);
                }
                for (let i = 0; i < count(nShrubs); i++)
                    add(s + r(), side * (6 + Math.pow(r(), 1.3) * 120), "shrub", 0.6 + r() * 0.9);
            }
            // Occasional clumps of trees far off, for the skyline.
            if (r() < 0.25) {
                const side = r() < 0.5 ? -1 : 1;
                const d = 260 + r() * 300;
                for (let i = 0; i < 6; i++)
                    add(s + r() * 3, side * (d + r() * 40), "tree", 1 + r() * 0.6);
            }
        }
        for (const [key, list] of chunks) {
            const g = vegetation(list, key.includes("|dry|"), key.endsWith("|far"));
            this.scene.add(g);
            g.traverse((o) => {
                if (o.name === "tufts" && o.visible && o.boundingSphere)
                    this.tufts.push({ mesh: o, centre: o.boundingSphere.center.clone(), radius: o.boundingSphere.radius });
            });
        }
    }
    buildObstacles() {
        for (const ev of this.network.events) {
            if (ev.robotId !== this.robotId)
                continue;
            if (ev.classId === "critical_novel") {
                this.buildBridge(ev);
                continue;
            }
            const g = buildObstacle(ev.kindId);
            const p = this.routeAt(ev.sE + OBSTACLE_AHEAD);
            // Set a little towards the side away from the way round, with its smaller end (a fallen tree's root
            // plate, not its crown) towards the way round, so the vehicle passes it with clear room.
            const side = this.network.bypasses.find((b) => b.id === ev.bypassId)?.side ?? 1;
            const shift = -side * 0.7;
            g.position.set(p.x - Math.sin(p.h) * shift, 0, p.z + Math.cos(p.h) * shift);
            g.rotation.y = -p.h + (side < 0 ? Math.PI : 0);
            g.visible = false;
            drawAfterTrack(g);
            this.scene.add(g);
            this.obstacles.set(ev.id, g);
        }
    }
    /** The critical scene: a narrow timber bridge over a ravine, damaged mid-span; an intact crossing off to one side. */
    buildBridge(ev) {
        const o = this.routeAt(ev.sE);
        const bypass = this.network.bypasses.find((b) => b.id === ev.bypassId);
        const place = (obj) => {
            obj.position.set(o.x, 0, o.z);
            obj.rotation.y = -o.h;
            return obj;
        };
        // The ravine: a deep V-shaped cut across the route, tapering out at both ends, in bare earth and rock; flat
        // grass on either side of it out to the edges of the hole cut in the ground (bridgeFrame).
        const W = PATCH.x1 - PATCH.x0;
        const D = PATCH.d;
        const cx = 6.2;
        const half = 5.6;
        const geom = new THREE.PlaneGeometry(half * 2, D, 40, 168);
        geom.rotateX(-Math.PI / 2);
        const p = geom.attributes.position;
        const uvs = geom.attributes.uv;
        const colors = [];
        for (let i = 0; i < p.count; i++) {
            const lx = p.getX(i) + cx;
            const lz = p.getZ(i);
            p.setX(i, lx);
            uvs.setXY(i, lx / 4, lz / 4);
            const across = Math.abs(lx - cx) / 5.4;
            const taper = 1 - smoothstep(46, 64, Math.abs(lz));
            const depth = across < 1 ? 9 * Math.pow(1 - across * across, 0.55) * taper : 0;
            p.setY(i, -depth);
            const wall = Math.min(1, depth / 1.2);
            const k = 0.9 + ((i * 7919) % 97) / 97 * 0.2;
            // Grass-tinted at the lip, earth and rock down the walls, a dark damp floor.
            const g = [0.62, 0.7, 0.45];
            const rock = [0.66, 0.58, 0.48];
            const floor = [0.42, 0.4, 0.34];
            const f = smoothstep(7.2, 8.6, depth);
            for (let c = 0; c < 3; c++)
                colors.push(((g[c] * (1 - wall) + rock[c] * wall) * (1 - f) + floor[c] * f) * k);
        }
        geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        this.drape(geom, o);
        const ravineGround = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: rockTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
        ravineGround.receiveShadow = true;
        // Drawn over the ground where the two overlap at the patch's edges.
        const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture("open"), vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
        const strip = (x0, x1) => {
            const g2 = new THREE.PlaneGeometry(x1 - x0, D, 12, 56);
            g2.rotateX(-Math.PI / 2);
            g2.translate((x0 + x1) / 2, 0, 0);
            this.drape(g2, o, true);
            const uv2 = g2.attributes.uv;
            for (let i = 0; i < uv2.count; i++)
                uv2.setXY(i, uv2.getX(i) * ((x1 - x0) / 10), uv2.getY(i) * (D / 10));
            const m = new THREE.Mesh(g2, grassMat);
            m.receiveShadow = true;
            return m;
        };
        const ravine = new THREE.Group();
        ravine.add(ravineGround, strip(PATCH.x0, cx - half), strip(cx + half, PATCH.x1));
        const stream = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 100), new THREE.MeshStandardMaterial({ color: "#47707f", roughness: 0.1 }));
        stream.rotation.x = -Math.PI / 2;
        stream.position.set(cx, -8.7, 0);
        ravine.add(stream);
        ravine.add(this.bridgeDeck(-1.8, 14.2, 0, true));
        ravine.add(this.bridgeDeck(-3, 15.5, bypass.side * 2.6 * SCALE, false));
        ravine.visible = false;
        this.scene.add(place(ravine));
        // Before the UGV detects it, the ground there looks like the rest: flat grass with the track running on.
        const flatGeom = new THREE.PlaneGeometry(W, D, 20, 56);
        flatGeom.rotateX(-Math.PI / 2);
        flatGeom.translate((PATCH.x0 + PATCH.x1) / 2, 0, 0);
        this.drape(flatGeom, o, true);
        const fuv = flatGeom.attributes.uv;
        for (let i = 0; i < fuv.count; i++)
            fuv.setXY(i, fuv.getX(i) * (W / 10), fuv.getY(i) * (D / 10));
        const flat = new THREE.Mesh(flatGeom, grassMat);
        flat.receiveShadow = true;
        this.scene.add(place(flat));
        this.bridge = { eventId: ev.id, ravine, flat };
    }
    /**
     * A timber deck across the ravine from x0 to x1 (local), centred at lateral z. Damaged (Oct 28, 2026, user: make it
     * "clearer and earlier that it is out"; it was a few missing planks that showed only once the UGV was on it): the
     * middle of the span has given way. The deck sags into a V, its planks cracked, darker and askew; one half of the
     * deck has fallen through there, so the ravine shows below it; both railings are broken there, one hanging down into the ravine. Planks remain along the other wheel
     * path, so to the UGV it is a surface whose strength it cannot judge.
     */
    bridgeDeck(x0, x1, z, damaged) {
        const g = new THREE.Group();
        const plank = new THREE.BoxGeometry(0.32, 0.08, 3.6);
        const wood = new THREE.MeshStandardMaterial({ color: "#8a7a63", roughness: 0.95 });
        const dark = new THREE.MeshStandardMaterial({ color: "#6d5f4c", roughness: 0.95 });
        const rotten = new THREE.MeshStandardMaterial({ color: "#4e4334", roughness: 1 });
        const B0 = 4.6;
        const B1 = 8.8;
        const mid = (B0 + B1) / 2;
        const SAG = 0.75;
        // The sag at x: 0 at the ends of the failed section, deepest in the middle (a V with rounded shoulders).
        const sagAt = (x) => (x <= B0 || x >= B1 ? 0 : SAG * (1 - Math.abs(x - mid) / ((B1 - B0) / 2)) ** 0.8);
        const slope = (x) => (x <= B0 || x >= B1 ? 0 : (x < mid ? -1 : 1) * (SAG / ((B1 - B0) / 2)));
        let k = 0;
        for (let x = x0; x < x1; x += 0.36, k++) {
            const broken = damaged && x > B0 && x < B1;
            if (!broken) {
                const m = new THREE.Mesh(plank, k % 3 ? wood : dark);
                m.castShadow = true;
                m.receiveShadow = true;
                m.position.set(x, 0.2, z);
                g.add(m);
                continue;
            }
            // Cracked in two across its length, the halves offset and tilted; every fourth one's outer half is gone.
            const y = 0.2 - sagAt(x);
            const tilt = Math.atan(slope(x));
            for (const half of [-1, 1]) {
                // One half of the deck has fallen through over most of the failed section, so the ravine shows below it;
                // elsewhere every fourth plank's outer half is gone.
                if (half < 0 && (k % 4 === 0 || (x > B0 + 0.5 && x < B1 - 0.5)))
                    continue;
                const m = new THREE.Mesh(plank, k % 2 ? rotten : dark);
                m.scale.z = 0.47;
                m.position.set(x + half * 0.03, y - (half > 0 ? 0.05 : 0), z + half * 0.93);
                m.rotation.set(half * 0.06 * ((k % 3) - 1), 0, tilt + half * 0.04);
                m.castShadow = true;
                g.add(m);
            }
        }
        // The two beams under the deck; on the damaged side they break and follow the sag.
        for (const dz of [-1.3, 1.3]) {
            const segs = damaged ? [[x0, B0], [B0, mid], [mid, B1], [B1, x1]] : [[x0, x1]];
            for (const [a, b] of segs) {
                const len = Math.hypot(b - a, sagAt(b) - sagAt(a));
                const bm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.45, 0.3), dark);
                bm.position.set((a + b) / 2, -0.12 - (sagAt(a) + sagAt(b)) / 2, z + dz);
                bm.rotation.z = Math.atan2(sagAt(a) - sagAt(b), b - a);
                bm.castShadow = true;
                g.add(bm);
            }
        }
        const post = new THREE.BoxGeometry(0.12, 1.0, 0.12);
        const railMat = new THREE.MeshStandardMaterial({ color: "#4d4b46", roughness: 0.9 });
        for (const side of [-1, 1]) {
            for (let x = x0 + 0.3; x < x1; x += 2) {
                if (damaged && x > B0 - 0.4 && x < B1 + 0.4)
                    continue; // both railings gone where the deck failed
                const m = new THREE.Mesh(post, railMat);
                m.position.set(x, 0.7, z + side * 1.85);
                m.castShadow = true;
                g.add(m);
            }
            const segs = damaged ? [[x0, B0 - 0.4], [B1 + 0.4, x1]] : [[x0, x1]];
            for (const [a, b] of segs) {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.08, 0.08), railMat);
                rail.position.set((a + b) / 2, 1.15, z + side * 1.85);
                rail.castShadow = true;
                g.add(rail);
            }
            if (damaged) {
                // A broken length of railing still attached at one end, hanging down over the edge.
                const len = 2.6;
                const hang = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), railMat);
                const ax = side < 0 ? B0 - 0.4 : B1 + 0.4;
                const dir = side < 0 ? 1 : -1;
                const ang = 0.75;
                hang.position.set(ax + dir * (len / 2) * Math.cos(ang), 1.15 - (len / 2) * Math.sin(ang), z + side * 2.0);
                hang.rotation.z = dir * -ang;
                hang.castShadow = true;
                g.add(hang);
            }
        }
        // Piers down the ravine walls at each end.
        for (const x of [x0 + 2.6, x1 - 2.6])
            for (const dz of [-1.3, 1.3]) {
                const pier = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), dark);
                pier.position.set(x, -3, z + dz);
                g.add(pier);
            }
        return g;
    }
    buildMarkers() {
        this.route.sectionEnds.forEach((s, i) => {
            const p = this.routeAt(s);
            const last = i === this.route.sectionEnds.length - 1;
            const g = last ? outpost() : sectionStakes();
            g.position.set(p.x, 0, p.z);
            g.rotation.y = -p.h;
            this.scene.add(g);
        });
    }
    // --- per frame --------------------------------------------------------------------------------------------
    /** Shows the take-over path and pins for this UGV's obstacle in view, or hides them (bypassId null). */
    updateWaypoints(u, bypassId) {
        const ev = bypassId ? this.network.events.find((e) => e.bypassId === bypassId) ?? null : null;
        const key = ev ? `${ev.id}|${u.s.toFixed(1)}` : "";
        if (key === this.wpKey)
            return;
        this.wpKey = key;
        this.wp.clear();
        this.pinPoints = [];
        if (!ev)
            return;
        const side = this.network.bypasses.find((b) => b.id === ev.bypassId).side;
        const { path: full } = wayRound(this.route, ev, side, u.s);
        // Drawn from just before it leaves the track, not along the track from the vehicle (which would read as
        // part of the way round).
        const fcum = cumulative(full);
        const leave = Math.max(0, (ev.classId === "critical_novel" ? ev.sE - 3.3 : ev.sE + OBSTACLE_AHEAD - 2.5) - 0.8 - u.s);
        const path = leave > 0 && leave < fcum.at(-1) - 1 ? slice(full, fcum, leave, fcum.at(-1)) : full;
        const ribbonMat = new THREE.MeshBasicMaterial({ color: "#ffc63a", transparent: true, opacity: 0.34, depthWrite: false, fog: false });
        const ribbon = this.ribbon(path, 1.1, 0.09, ribbonMat, 6);
        ribbon.renderOrder = 5;
        this.wp.add(ribbon);
        const edgeMat = new THREE.MeshBasicMaterial({ color: "#ffd257", transparent: true, opacity: 0.9, depthWrite: false, fog: false });
        const edge = this.ribbon(path, 0.12, 0.1, edgeMat, 6);
        edge.renderOrder = 6;
        this.wp.add(edge);
        const pins = wayRoundPins(this.route, ev, side);
        const stem = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6);
        const stemMat = new THREE.MeshStandardMaterial({ color: "#2b2410" });
        for (const pin of pins) {
            const base = w3(pin);
            const s = new THREE.Mesh(stem, stemMat);
            s.position.set(base.x, 1.1, base.z);
            s.castShadow = true;
            this.wp.add(s); // the pin head is an HTML button over the stem's top (camera-feed.ts)
            this.pinPoints.push(new THREE.Vector3(base.x, 2.35, base.z));
        }
    }
    /** Screen positions (CSS pixels within the canvas) of the waypoint pin heads, and their distance (for sizing). */
    pinScreen() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        this.camera.updateMatrixWorld();
        return this.pinPoints.map((p) => {
            const v = p.clone().project(this.camera);
            const c = p.clone().applyMatrix4(this.camera.matrixWorldInverse); // camera space: in front when z < 0
            const dist = p.distanceTo(this.camera.position);
            const behind = c.z >= -0.05;
            return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, dist, visible: !behind && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05, behind, side: c.x < 0 ? -1 : 1 };
        });
    }
    resize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (!w || !h)
            return;
        const pr = this.renderer.getPixelRatio();
        if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) {
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
    }
    /**
     * Places the camera at the UGV and renders. lookPath: the path ahead of the vehicle (map coordinates, from the
     * vehicle), as the camera feed computes it for driving, going round and backing up.
     */
    render(u, world, lookPath, bob, bypassId, stuck, snap = false) {
        this.resize();
        for (const [id, g] of this.obstacles)
            g.visible = world.eventStatus[id] !== "pending";
        if (this.bridge) {
            const shown = world.eventStatus[this.bridge.eventId] !== "pending";
            this.bridge.ravine.visible = shown;
            this.bridge.flat.visible = !shown;
            if (this.pendingFlatTrack)
                this.pendingFlatTrack.visible = !shown;
        }
        this.updateWaypoints(u, bypassId);
        const cum = cumulative(lookPath);
        const total = cum.at(-1) ?? 0;
        const p0 = lookPath[0] ?? { x: u.x, y: u.y };
        const ahead = total > 0.05 ? pointAt(lookPath, cum, Math.min(total, 2.2)) : { x: p0.x + Math.cos(u.heading), y: p0.y + Math.sin(u.heading) };
        const target = Math.atan2(ahead.y - p0.y, ahead.x - p0.x);
        // Smooth the heading so the view turns like a vehicle, not a cursor.
        let settled = true;
        if (this.heading === null || snap)
            this.heading = target;
        else {
            let d = target - this.heading;
            while (d > Math.PI)
                d -= Math.PI * 2;
            while (d < -Math.PI)
                d += Math.PI * 2;
            if (Math.abs(d) < 2e-4)
                this.heading = target;
            else {
                this.heading += d * 0.18;
                settled = false;
            }
        }
        const pos = w3({ x: u.x, y: u.y }, CAM_HEIGHT + bob);
        this.camera.position.copy(pos);
        const look = pos.clone().add(new THREE.Vector3(Math.cos(this.heading) * 20, -2.1 - (stuck ? 1.2 : 0), Math.sin(this.heading) * 20));
        this.camera.lookAt(look);
        if (stuck)
            this.camera.rotateZ(-0.06);
        for (const t of this.tufts)
            t.mesh.visible = this.showScenery && t.centre.distanceTo(pos) - t.radius < 110;
        this.sun.position.set(pos.x - 80, 120, pos.z - 60);
        this.sun.target.position.set(pos.x + Math.cos(this.heading) * 30, 0, pos.z + Math.sin(this.heading) * 30);
        this.renderer.render(this.scene, this.camera);
        return settled;
    }
}
