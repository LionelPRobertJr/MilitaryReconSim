import * as THREE from "three";
// Procedural textures for the 3D views, drawn once on 2D canvases. Everything is seeded, so every participant
// sees exactly the same world. Textures are made to tile seamlessly where they repeat.
/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Smooth value noise in [0, 1], periodic with the given period (for tileable textures). */
export function valueNoise(seed, period = 0) {
    const r = rng(seed);
    const N = 256;
    const table = Array.from({ length: N * N }, () => r());
    const cell = (i, j) => {
        const p = period || N;
        const ii = ((i % p) + p) % p % N;
        const jj = ((j % p) + p) % p % N;
        return table[ii * N + jj];
    };
    const s = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const fx = s(x - xi);
        const fy = s(y - yi);
        const a = cell(xi, yi);
        const b = cell(xi + 1, yi);
        const c = cell(xi, yi + 1);
        const d = cell(xi + 1, yi + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
}
function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return [c, c.getContext("2d")];
}
function finish(c, repeat = true) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat)
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}
/** Draw fn at (x, y) and at its wrapped copies, so marks near an edge continue on the opposite edge. */
function wrapped(w, h, x, y, m, fn) {
    for (const dx of [0, -w, w])
        for (const dy of [0, -h, h])
            if (x + dx > -m && x + dx < w + m && y + dy > -m && y + dy < h + m)
                fn(x + dx, y + dy);
}
const GRASS = {
    open: { base: [118, 136, 82], blades: ["#5f7440", "#7d9152", "#93a564", "#6b7f45", "#a8b277"], patches: ["rgba(150,150,90,0.25)", "rgba(70,95,45,0.25)"] },
    scrub: { base: [146, 142, 98], blades: ["#7d7a50", "#9a9564", "#b2aa78", "#6f7148", "#c2b98a"], patches: ["rgba(170,160,110,0.28)", "rgba(100,105,65,0.25)"] },
    wood: { base: [96, 116, 66], blades: ["#4c6233", "#647d43", "#7a9152", "#56683a", "#8a9a5c"], patches: ["rgba(70,85,45,0.3)", "rgba(110,120,70,0.22)"] }
};
const cache = new Map();
/** Grass and earth, 512 px tiling (about 10 m in the world). */
export function grassTexture(kind) {
    const key = `grass-${kind}`;
    if (cache.has(key))
        return cache.get(key);
    const S = 512;
    const [c, g] = canvas(S, S);
    const spec = GRASS[kind];
    const n = valueNoise(kind.length * 17 + 3, 16);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const v = n((x / S) * 16, (y / S) * 16) * 0.6 + n((x / S) * 16 * 4.0, (y / S) * 16 * 4.0) * 0.4;
            const k = 0.78 + v * 0.42;
            const i = (y * S + x) * 4;
            img.data[i] = spec.base[0] * k;
            img.data[i + 1] = spec.base[1] * k;
            img.data[i + 2] = spec.base[2] * k;
            img.data[i + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const r = rng(kind.length * 101 + 7);
    for (let i = 0; i < 40; i++) {
        const x = r() * S;
        const y = r() * S;
        const rad = 10 + r() * 40;
        g.fillStyle = spec.patches[i % 2];
        wrapped(S, S, x, y, rad, (px, py) => {
            g.beginPath();
            g.ellipse(px, py, rad, rad * (0.5 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
            g.fill();
        });
    }
    g.lineCap = "round";
    for (let i = 0; i < 9000; i++) {
        const x = r() * S;
        const y = r() * S;
        const len = 3 + r() * 7;
        const a = -Math.PI / 2 + (r() - 0.5) * 1.1;
        g.strokeStyle = spec.blades[Math.floor(r() * spec.blades.length)];
        g.globalAlpha = 0.55 + r() * 0.45;
        g.lineWidth = 0.8 + r() * 0.9;
        wrapped(S, S, x, y, 12, (px, py) => {
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
            g.stroke();
        });
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 260; i++) {
        const x = r() * S;
        const y = r() * S;
        g.fillStyle = i % 3 ? "rgba(90,80,60,0.35)" : "rgba(220,215,190,0.3)";
        wrapped(S, S, x, y, 3, (px, py) => g.fillRect(px, py, 1.6, 1.6));
    }
    const t = finish(c);
    cache.set(key, t);
    return t;
}
/** The dirt track: u across (0..1 over its width), v along (one tile = 12 m). Wheel ruts, a grassy centre strip. */
export function trackTexture() {
    if (cache.has("track"))
        return cache.get("track");
    const W = 256;
    const H = 512;
    const [c, g] = canvas(W, H);
    const n = valueNoise(911, 8);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const u = x / W;
            const v = n(u * 8, (y / H) * 8) * 0.55 + n(u * 32, (y / H) * 32) * 0.45;
            const rut = Math.exp(-(((u - 0.27) / 0.07) ** 2)) + Math.exp(-(((u - 0.73) / 0.07) ** 2));
            const centre = Math.exp(-(((u - 0.5) / 0.06) ** 2));
            const edge = Math.min(1, Math.max(0, (Math.min(u, 1 - u) - 0.0) / 0.12));
            let r = 168 + v * 40;
            let gg = 146 + v * 34;
            let b = 108 + v * 26;
            r -= rut * 38;
            gg -= rut * 36;
            b -= rut * 30;
            r = r * (1 - centre * 0.35) + 118 * centre * 0.35;
            gg = gg * (1 - centre * 0.35) + 132 * centre * 0.35;
            b = b * (1 - centre * 0.35) + 80 * centre * 0.35;
            const i = (y * W + x) * 4;
            img.data[i] = r;
            img.data[i + 1] = gg;
            img.data[i + 2] = b;
            img.data[i + 3] = Math.round(255 * Math.min(1, edge * 1.4));
        }
    g.putImageData(img, 0, 0);
    const r = rng(77);
    for (let i = 0; i < 700; i++) {
        const x = r() * W;
        const y = r() * H;
        const s = 0.8 + r() * 2.4;
        g.fillStyle = r() < 0.5 ? "rgba(110,95,70,0.6)" : "rgba(205,195,170,0.55)";
        wrapped(W, H, x, y, 4, (px, py) => {
            g.beginPath();
            g.ellipse(px, py, s, s * 0.7, 0, 0, Math.PI * 2);
            g.fill();
        });
    }
    // Tufts in the centre strip and along the edges.
    g.lineCap = "round";
    for (let i = 0; i < 900; i++) {
        const zone = r();
        const u = zone < 0.5 ? 0.5 + (r() - 0.5) * 0.1 : zone < 0.75 ? r() * 0.08 : 1 - r() * 0.08;
        const x = u * W;
        const y = r() * H;
        g.strokeStyle = ["#6f7d45", "#869558", "#5c6b3a"][i % 3];
        g.lineWidth = 1;
        wrapped(W, H, x, y, 8, (px, py) => {
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(px + (r() - 0.5) * 3, py - 3 - r() * 4);
            g.stroke();
        });
    }
    const t = finish(c);
    cache.set("track", t);
    return t;
}
/** Worn verge beside the track: an alpha ramp of flattened, dusty grass. */
export function vergeTexture() {
    if (cache.has("verge"))
        return cache.get("verge");
    const W = 128;
    const H = 256;
    const [c, g] = canvas(W, H);
    const n = valueNoise(5, 8);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const u = x / W;
            const edge = 1 - Math.abs(u - 0.5) * 2;
            const v = n(u * 8, (y / H) * 8);
            const i = (y * W + x) * 4;
            img.data[i] = 150 + v * 30;
            img.data[i + 1] = 140 + v * 26;
            img.data[i + 2] = 96 + v * 20;
            img.data[i + 3] = Math.max(0, Math.min(255, (edge * 1.6 - 0.25 + (v - 0.5) * 0.6) * 200));
        }
    g.putImageData(img, 0, 0);
    const t = finish(c);
    cache.set("verge", t);
    return t;
}
/** Bark: dark ridges along the trunk (v along the trunk). */
export function barkTexture(grey = false) {
    const key = grey ? "bark-grey" : "bark";
    if (cache.has(key))
        return cache.get(key);
    const W = 128;
    const H = 256;
    const [c, g] = canvas(W, H);
    g.fillStyle = grey ? "#8a857a" : "#6b4e34";
    g.fillRect(0, 0, W, H);
    const r = rng(grey ? 3 : 4);
    for (let i = 0; i < 160; i++) {
        const x = r() * W;
        g.strokeStyle = r() < 0.6 ? (grey ? "rgba(60,58,52,0.55)" : "rgba(40,28,18,0.6)") : grey ? "rgba(180,176,165,0.35)" : "rgba(150,115,80,0.35)";
        g.lineWidth = 1 + r() * 3;
        g.beginPath();
        let y = 0;
        g.moveTo(x, y);
        let xx = x;
        while (y < H) {
            y += 8 + r() * 14;
            xx += (r() - 0.5) * 4;
            g.lineTo(xx, y);
        }
        g.stroke();
    }
    const t = finish(c);
    cache.set(key, t);
    return t;
}
/** Rock / rubble surface. */
export function rockTexture() {
    if (cache.has("rock"))
        return cache.get("rock");
    const S = 256;
    const [c, g] = canvas(S, S);
    const n = valueNoise(13, 8);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const v = n((x / S) * 8, (y / S) * 8) * 0.5 + n((x / S) * 32, (y / S) * 32) * 0.5;
            const i = (y * S + x) * 4;
            img.data[i] = 120 + v * 70;
            img.data[i + 1] = 114 + v * 66;
            img.data[i + 2] = 102 + v * 60;
            img.data[i + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const t = finish(c);
    cache.set("rock", t);
    return t;
}
/** Soft round puff for smoke and dust sprites. */
export function puffTexture() {
    if (cache.has("puff"))
        return cache.get("puff");
    // A billowing puff: a soft round core broken up by fractal noise, so overlapping sprites read as smoke rather
    // than as discs.
    const S = 256;
    const [c, g] = canvas(S, S);
    const img = g.createImageData(S, S);
    const n1 = valueNoise(91);
    const n2 = valueNoise(92);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const dx = (x - S / 2) / (S / 2);
            const dy = (y - S / 2) / (S / 2);
            const d = Math.sqrt(dx * dx + dy * dy);
            const f = n1(x / 22, y / 22) * 0.6 + n2(x / 9, y / 9) * 0.4;
            const a = Math.max(0, 1 - d * (0.75 + f * 0.6)) ** 1.4;
            const k = (y * S + x) * 4;
            const shade = 225 + f * 30;
            img.data[k] = img.data[k + 1] = shade;
            img.data[k + 2] = shade - 4;
            img.data[k + 3] = Math.round(Math.min(1, a * 1.35) * 255);
        }
    g.putImageData(img, 0, 0);
    const t = finish(c, false);
    cache.set("puff", t);
    return t;
}
/** A tiling normal map of fine wind ripples, for still water (lights it and breaks up its reflection). */
export function rippleNormalTexture() {
    if (cache.has("ripple"))
        return cache.get("ripple");
    const S = 256;
    const [c, g] = canvas(S, S);
    const img = g.createImageData(S, S);
    const n = valueNoise(57, 16);
    const h = (x, y) => n((x / S) * 16, (y / S) * 16) * 0.7 + n((x / S) * 16 * 2 + 3, (y / S) * 16 * 2) * 0.3;
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const dx = h(x + 1, y) - h(x - 1, y);
            const dy = h(x, y + 1) - h(x, y - 1);
            const k = (y * S + x) * 4;
            img.data[k] = Math.round(128 - dx * 380);
            img.data[k + 1] = Math.round(128 - dy * 380);
            img.data[k + 2] = 255;
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    cache.set("ripple", t);
    return t;
}
/** Wet mud: dark brown with lighter smears and tyre-churned streaks (tiling). */
export function mudTexture() {
    if (cache.has("mud"))
        return cache.get("mud");
    const S = 256;
    const [c, g] = canvas(S, S);
    const img = g.createImageData(S, S);
    const n = valueNoise(61, 16);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const f = n((x / S) * 16, (y / S) * 16) * 0.6 + n((x / S) * 64, (y / S) * 16) * 0.4;
            const k = (y * S + x) * 4;
            img.data[k] = 70 + f * 60;
            img.data[k + 1] = 55 + f * 45;
            img.data[k + 2] = 36 + f * 28;
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const t = finish(c);
    cache.set("mud", t);
    return t;
}
/** The sky dome's colours: a vertical gradient from deep blue overhead to a pale, hazy horizon. */
export function skyTexture() {
    if (cache.has("sky"))
        return cache.get("sky");
    // Equirectangular: x wraps around the horizon, row 0 is the zenith and the middle row the horizon.
    const W = 1024;
    const H = 512;
    const [c, g] = canvas(W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#3f6f9f");
    grad.addColorStop(0.3, "#5d8bb8");
    grad.addColorStop(0.42, "#86aacb");
    grad.addColorStop(0.475, "#b9cfdc");
    grad.addColorStop(0.5, "#dfe5e2");
    grad.addColorStop(0.51, "#c9cbb8");
    grad.addColorStop(1, "#b8bba6");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Fair-weather cumulus: fractal noise, flattened towards the horizon, white tops and grey bases.
    const n1 = valueNoise(77, 16);
    const n2 = valueNoise(78, 32);
    const n3 = valueNoise(79, 64);
    const img = g.getImageData(0, 0, W, H / 2);
    for (let y = 0; y < H / 2; y++) {
        const elev = 1 - y / (H / 2); // 1 zenith, 0 horizon
        if (elev < 0.015)
            continue;
        const squash = 1 / Math.max(0.12, elev);
        for (let x = 0; x < W; x++) {
            const u = (x / W) * 16;
            const v = (y / H) * 16 * squash * 0.35;
            const f = n1(u, v) * 0.55 + n2(u * 2, v * 2) * 0.3 + n3(u * 4, v * 4) * 0.15;
            const cover = Math.max(0, Math.min(1, (f - 0.55) / 0.18)) * Math.min(1, elev * 6);
            if (cover <= 0)
                continue;
            const shade = 0.82 + 0.18 * Math.min(1, (f - 0.55) / 0.3);
            const k = (y * W + x) * 4;
            const cr = 250 * shade;
            const cg = 251 * shade;
            const cb = 255 * shade;
            const a = cover * 0.92;
            img.data[k] = img.data[k] * (1 - a) + cr * a;
            img.data[k + 1] = img.data[k + 1] * (1 - a) + cg * a;
            img.data[k + 2] = img.data[k + 2] * (1 - a) + cb * a;
        }
    }
    g.putImageData(img, 0, 0);
    const t = finish(c, false);
    t.wrapS = THREE.RepeatWrapping;
    cache.set("sky", t);
    return t;
}
/** A clump of grass blades on a transparent background (for crossed-quad grass). */
export function bladeTexture(dry) {
    const key = `blades-${dry}`;
    if (cache.has(key))
        return cache.get(key);
    const [c, g] = canvas(256, 256);
    const r = rng(dry ? 404 : 403);
    const cols = dry ? ["#8c8657", "#a39b68", "#b8ae7c", "#77744c", "#c7bd8e"] : ["#4f6a32", "#62803d", "#77954b", "#86a058", "#5a7436", "#9aab68"];
    for (let i = 0; i < 140; i++) {
        const x0 = 128 + (r() - 0.5) * 200 * Math.pow(r(), 0.5);
        const h = 90 + r() * 160;
        const lean = (r() - 0.5) * 70;
        const w = 2 + r() * 4;
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.beginPath();
        g.moveTo(x0 - w, 256);
        g.quadraticCurveTo(x0 + lean * 0.3, 256 - h * 0.6, x0 + lean, 256 - h);
        g.quadraticCurveTo(x0 + lean * 0.3 + w * 0.4, 256 - h * 0.6, x0 + w, 256);
        g.closePath();
        g.fill();
    }
    // Darken the base, where the blades shade each other.
    const grad = g.createLinearGradient(0, 160, 0, 256);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(20,25,10,0.45)");
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // Give the transparent pixels the blades' average colour, so distant (mipmapped) clumps stay green instead
    // of fading to black at their edges.
    const img = g.getImageData(0, 0, 256, 256);
    const d = img.data;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4)
        if (d[i + 3] > 128) {
            sr += d[i];
            sg += d[i + 1];
            sb += d[i + 2];
            n++;
        }
    for (let i = 0; i < d.length; i += 4)
        if (d[i + 3] < 128) {
            d[i] = sr / n;
            d[i + 1] = sg / n;
            d[i + 2] = sb / n;
        }
    const t = new THREE.DataTexture(d, 256, 256, THREE.RGBAFormat);
    t.flipY = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    cache.set(key, t);
    return t;
}
/** Foliage: dappled leaf clusters, light and shade (tiling), for tree crowns and shrubs. */
export function leafTexture() {
    if (cache.has("leaf"))
        return cache.get("leaf");
    const [c, g] = canvas(256, 256);
    const r = rng(505);
    g.fillStyle = "#9a9a92";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2200; i++) {
        const x = r() * 256;
        const y = r() * 256;
        const s = 2 + r() * 5;
        const l = r();
        const v = Math.round(95 + l * 160);
        g.fillStyle = `rgb(${v},${Math.min(255, Math.round(v * 1.04))},${Math.round(v * 0.9)})`;
        wrapped(256, 256, x, y, 8, (X, Y) => {
            g.beginPath();
            g.ellipse(X, Y, s, s * 0.6, r() * Math.PI, 0, Math.PI * 2);
            g.fill();
        });
    }
    const t = finish(c);
    cache.set("leaf", t);
    return t;
}
// --- Oct 11, 2026: muddy water and the dry ditch, reworked (research team: "improve the visual aesthetics") ---
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
/**
 * Opaque muddy water seen from above: an ochre-brown base with slow plumes of lighter silt and darker eddies,
 * faint wind streaks along the route, and a few floating leaves and bits of foam. u runs along the route.
 */
export function muddyWaterTexture() {
    if (cache.has("muddyWater"))
        return cache.get("muddyWater");
    const S = 512;
    const [c, g] = canvas(S, S);
    const img = g.createImageData(S, S);
    const plume = valueNoise(71, 6);
    const eddy = valueNoise(72, 12);
    const fine = valueNoise(73, 48);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const u = x / S, v = y / S;
            const p = plume(u * 6 + eddy(u * 12, v * 12) * 0.8, v * 6);
            const e = eddy(u * 12, v * 12);
            const f = fine(u * 48, v * 12); // stretched across: streaks along the route
            const silt = Math.max(0, p - 0.45) * 1.8;
            const k = (y * S + x) * 4;
            // Dark chocolate brown (Oct 11, 2026: must read as mud, not water, from 40-60 m away).
            img.data[k] = clamp255(80 + silt * 34 - (1 - e) * 18 + (f - 0.5) * 6);
            img.data[k + 1] = clamp255(62 + silt * 26 - (1 - e) * 14 + (f - 0.5) * 5);
            img.data[k + 2] = clamp255(40 + silt * 16 - (1 - e) * 9 + (f - 0.5) * 4);
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const r = rng(74);
    // A few bubbles.
    for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(232, 222, 196, ${0.2 + r() * 0.25})`;
        g.beginPath();
        g.arc(r() * S, r() * S, 0.8 + r() * 1.8, 0, Math.PI * 2);
        g.fill();
    }
    // Floating leaves and twigs.
    for (let i = 0; i < 26; i++) {
        const x = r() * S, y = r() * S, a = r() * Math.PI;
        g.save();
        g.translate(x, y);
        g.rotate(a);
        if (i % 4 === 0) {
            g.strokeStyle = "rgba(62, 44, 26, 0.8)";
            g.lineWidth = 1.6;
            g.beginPath();
            g.moveTo(-9, 0);
            g.lineTo(9, 1);
            g.stroke();
        }
        else {
            g.fillStyle = ["rgba(120, 92, 40, 0.85)", "rgba(96, 104, 48, 0.8)", "rgba(140, 104, 50, 0.8)"][i % 3];
            g.beginPath();
            g.ellipse(0, 0, 4 + r() * 3, 2 + r() * 1.5, 0, 0, Math.PI * 2);
            g.fill();
        }
        g.restore();
    }
    const t = finish(c);
    cache.set("muddyWater", t);
    return t;
}
/** Wet, churned mud for the bank round muddy water: darker wet patches, ruts, boot and tyre marks, puddled hollows. */
export function wetMudTexture() {
    if (cache.has("wetMud"))
        return cache.get("wetMud");
    const S = 512;
    const [c, g] = canvas(S, S);
    const img = g.createImageData(S, S);
    const big = valueNoise(81, 8);
    const small = valueNoise(82, 64);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const u = x / S, v = y / S;
            const b = big(u * 8, v * 8);
            const s = small(u * 64, v * 64);
            const wet = Math.max(0, b - 0.5) * 2; // darker, wetter patches
            const k = (y * S + x) * 4;
            img.data[k] = clamp255(104 - wet * 34 + (s - 0.5) * 22);
            img.data[k + 1] = clamp255(80 - wet * 27 + (s - 0.5) * 18);
            img.data[k + 2] = clamp255(52 - wet * 18 + (s - 0.5) * 12);
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    const r = rng(83);
    // Footprints and small water-filled hollows catching the sky.
    for (let i = 0; i < 40; i++) {
        g.fillStyle = i % 3 === 0 ? "rgba(196, 204, 206, 0.45)" : "rgba(52, 38, 22, 0.45)";
        g.beginPath();
        g.ellipse(r() * S, r() * S, 3 + r() * 6, 2 + r() * 3, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
    }
    const t = finish(c);
    cache.set("wetMud", t);
    return t;
}
/** Dried, cracked mud for the outer rim (lighter, a crazed network of cracks). */
export function crackedMudTexture() {
    if (cache.has("crackedMud"))
        return cache.get("crackedMud");
    const S = 512;
    const [c, g] = canvas(S, S);
    const n = valueNoise(91, 16);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
            const f = n((x / S) * 16, (y / S) * 16);
            const k = (y * S + x) * 4;
            img.data[k] = clamp255(160 + (f - 0.5) * 30);
            img.data[k + 1] = clamp255(140 + (f - 0.5) * 26);
            img.data[k + 2] = clamp255(106 + (f - 0.5) * 20);
            img.data[k + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    // Cracks: a Voronoi-like network from random seed points.
    const r = rng(92);
    const pts = Array.from({ length: 60 }, () => [r() * S, r() * S]);
    g.strokeStyle = "rgba(92, 72, 48, 0.55)";
    g.lineWidth = 1.3;
    for (const [x, y] of pts) {
        const near = pts.map(([a, b]) => [a, b, Math.hypot(a - x, b - y)]).sort((p, q) => p[2] - q[2]).slice(1, 4);
        for (const [a, b] of near) {
            g.beginPath();
            g.moveTo((x + a) / 2 + (b - y) * 0.25, (y + b) / 2 - (a - x) * 0.25);
            g.lineTo((x + a) / 2 - (b - y) * 0.25, (y + b) / 2 + (a - x) * 0.25);
            g.stroke();
        }
    }
    const t = finish(c);
    cache.set("crackedMud", t);
    return t;
}
