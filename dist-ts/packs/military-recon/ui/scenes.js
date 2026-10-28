// Camera-panel images: one stylised forward-view still per scene (brief
// section 5: "Events are recognisable from the image alone"). The whole
// mission is off-road: every scene is a dirt track across open country,
// scrub or woodland - no paved roads, no lane markings. Drawn as SVG so every
// participant sees the same picture and the images ship with the code. Scene
// ids come from the route network: event kind ids (event-definitions.ts),
// track_<terrain>_<n>, bypass_track, section_line, objective.
const W = 320;
const H = 200;
const HORIZON = 86;
const VP = { x: 160, y: HORIZON + 4 };
/** x of the track's left/right edge at screen row y (simple one-point perspective). */
function trackEdges(y) {
    const t = (y - VP.y) / (H - VP.y);
    const half = 5 + t * 100;
    return [VP.x - half, VP.x + half];
}
function trackPolygon(y0 = VP.y, y1 = H) {
    const [a0, b0] = trackEdges(y0);
    const [a1, b1] = trackEdges(y1);
    return `${a0},${y0} ${b0},${y0} ${b1},${y1} ${a1},${y1}`;
}
/**
 * Gradients shared by every scene and the live camera view. The ids are the same in every SVG on a
 * page, and every copy defines them identically, so whichever copy the browser resolves looks the same.
 */
export const SCENE_DEFS = `<defs>
  <linearGradient id="rc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86a7bf"/><stop offset="0.7" stop-color="#c9d7dc"/><stop offset="1" stop-color="#e2e5da"/></linearGradient>
  <linearGradient id="rc-gnd-open" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c29f"/><stop offset="0.25" stop-color="#a5b283"/><stop offset="1" stop-color="#83945f"/></linearGradient>
  <linearGradient id="rc-gnd-scrub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7c09c"/><stop offset="0.25" stop-color="#b4ad83"/><stop offset="1" stop-color="#928b62"/></linearGradient>
  <linearGradient id="rc-gnd-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a7b38d"/><stop offset="0.25" stop-color="#8fa274"/><stop offset="1" stop-color="#6c8052"/></linearGradient>
  <linearGradient id="rc-trk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfae90"/><stop offset="0.35" stop-color="#ab9270"/><stop offset="1" stop-color="#937656"/></linearGradient>
  <linearGradient id="rc-bark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b08a5f"/><stop offset="0.3" stop-color="#8a6644"/><stop offset="0.75" stop-color="#5e4329"/><stop offset="1" stop-color="#3a281a"/></linearGradient>
  <radialGradient id="rc-puff" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#c9c9c4" stop-opacity="0.95"/><stop offset="0.6" stop-color="#b4b4ae" stop-opacity="0.75"/><stop offset="1" stop-color="#a7a7a1" stop-opacity="0"/></radialGradient>
  <radialGradient id="rc-puff-dark" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7d7c77" stop-opacity="0.9"/><stop offset="0.65" stop-color="#8f8e88" stop-opacity="0.6"/><stop offset="1" stop-color="#9a9993" stop-opacity="0"/></radialGradient>
  <linearGradient id="rc-mud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7656"/><stop offset="0.5" stop-color="#6f5838"/><stop offset="1" stop-color="#5a4429"/></linearGradient>
  <radialGradient id="rc-roots" cx="0.45" cy="0.45" r="0.6"><stop offset="0" stop-color="#4a3826"/><stop offset="1" stop-color="#6e5a42"/></radialGradient>
</defs>`;
const GROUND_FILL = { open: "url(#rc-gnd-open)", scrub: "url(#rc-gnd-scrub)", wood: "url(#rc-gnd-wood)" };
/** Sky with a hazy far ridge, a nearer ridge and a few soft clouds. */
function sky() {
    return `<rect width="${W}" height="${HORIZON + 1}" fill="url(#rc-sky)"/>
  <g fill="#ffffff" opacity="0.32"><ellipse cx="62" cy="22" rx="34" ry="5"/><ellipse cx="84" cy="19" rx="18" ry="4"/><ellipse cx="236" cy="14" rx="42" ry="5"/><ellipse cx="262" cy="11" rx="20" ry="3.5"/></g>
  <path d="M0 ${HORIZON - 20} Q 40 ${HORIZON - 30} 90 ${HORIZON - 22} T 190 ${HORIZON - 27} T 320 ${HORIZON - 19} V ${HORIZON} H 0Z" fill="#b3c2c2"/>
  <path d="M0 ${HORIZON - 14} Q 60 ${HORIZON - 32} 120 ${HORIZON - 16} T 240 ${HORIZON - 22} T 320 ${HORIZON - 12} V ${HORIZON} H 0Z" fill="#9dad97"/>
  <rect y="${HORIZON - 5}" width="${W}" height="6" fill="#e3e6dc" opacity="0.35"/>`;
}
/** Grass and earth texture beside the track: denser and larger towards the camera. Deterministic. */
function groundTexture(kind, seed) {
    const blade = kind === "scrub" ? "#7f7a52" : kind === "wood" ? "#56693f" : "#6c7d4b";
    let out = "";
    for (let i = 0; i < 90; i++) {
        const r1 = Math.abs(Math.sin(seed * 17.1 + i * 12.9898) * 43758.5453) % 1;
        const r2 = Math.abs(Math.sin(seed * 5.3 + i * 78.233) * 12345.678) % 1;
        const t = r2 * r2;
        const y = HORIZON + 3 + t * (H - HORIZON);
        const [l, r] = trackEdges(y);
        const left = i % 2 === 0;
        const x = left ? l - 3 - r1 * (l + 10) : r + 3 + r1 * (W - r + 10);
        const k = 0.4 + t * 2.4;
        out += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${(-1.2 * k).toFixed(1)} ${(-2.6 * k).toFixed(1)} M${x.toFixed(1)} ${y.toFixed(1)} l0 ${(-3.2 * k).toFixed(1)} M${x.toFixed(1)} ${y.toFixed(1)} l${(1.2 * k).toFixed(1)} ${(-2.6 * k).toFixed(1)}" stroke="${blade}" stroke-width="${(0.5 + t * 0.7).toFixed(2)}" opacity="0.55"/>`;
        if (i % 3 === 0)
            out += `<ellipse cx="${(x + 6 * k).toFixed(1)}" cy="${(y + 0.6).toFixed(1)}" rx="${(1.6 * k).toFixed(1)}" ry="${(0.5 * k).toFixed(1)}" fill="#ffffff" opacity="0.08"/>`;
    }
    return out;
}
/** Ground and surroundings for a terrain type. */
const n1 = (x) => x.toFixed(1);
/** A broadleaf tree: two-tone trunk and a canopy of overlapping clumps lit from the upper left. */
export function treeSvg(x, base, r, variant = 0) {
    const w = Math.max(1.6, r * 0.18);
    const shade = variant % 2 ? ["#3c5630", "#53703b", "#6a8848", "#82a05a"] : ["#425d33", "#5a7841", "#71904d", "#88a660"];
    return `<path d="M${n1(x - w / 2)} ${n1(base)} L${n1(x - w * 0.3)} ${n1(base - r * 1.1)} L${n1(x + w * 0.3)} ${n1(base - r * 1.1)} L${n1(x + w / 2)} ${n1(base)} Z" fill="#5e4b36"/>
    <path d="M${n1(x)} ${n1(base)} L${n1(x)} ${n1(base - r * 1.1)} L${n1(x + w * 0.3)} ${n1(base - r * 1.1)} L${n1(x + w / 2)} ${n1(base)} Z" fill="#45372a"/>
    <circle cx="${n1(x + r * 0.28)}" cy="${n1(base - r * 1.15)}" r="${n1(r * 0.78)}" fill="${shade[0]}"/>
    <circle cx="${n1(x - r * 0.42)}" cy="${n1(base - r * 1.05)}" r="${n1(r * 0.62)}" fill="${shade[1]}"/>
    <circle cx="${n1(x)}" cy="${n1(base - r * 1.45)}" r="${n1(r * 0.8)}" fill="${shade[1]}"/>
    <circle cx="${n1(x - r * 0.25)}" cy="${n1(base - r * 1.7)}" r="${n1(r * 0.5)}" fill="${shade[2]}"/>
    <circle cx="${n1(x - r * 0.38)}" cy="${n1(base - r * 1.82)}" r="${n1(r * 0.24)}" fill="${shade[3]}"/>
    <ellipse cx="${n1(x + r * 0.15)}" cy="${n1(base + 0.5)}" rx="${n1(r * 0.7)}" ry="${n1(r * 0.12)}" fill="#1e2416" opacity="0.18"/>`;
}
/** A low shrub: dark base, mid body, lit top. */
function shrubSvg(x, y, s, dry = false) {
    const c = dry ? ["#6a6d46", "#7d8455", "#959a68"] : ["#4d6636", "#62803f", "#7c9a52"];
    return `<ellipse cx="${n1(x + s * 0.2)}" cy="${n1(y)}" rx="${n1(s * 1.3)}" ry="${n1(s * 0.75)}" fill="${c[0]}"/><ellipse cx="${n1(x - s * 0.15)}" cy="${n1(y - s * 0.25)}" rx="${n1(s)}" ry="${n1(s * 0.6)}" fill="${c[1]}"/><ellipse cx="${n1(x - s * 0.35)}" cy="${n1(y - s * 0.5)}" rx="${n1(s * 0.45)}" ry="${n1(s * 0.28)}" fill="${c[2]}"/>`;
}
/** clearVerges: obstacle scenes keep the ground beside the track open (only distant trees), so the way round is visible. */
function terrain(kind, seed, clearVerges = false) {
    let out = `<rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="${GROUND_FILL[kind]}"/>`;
    out += `<path d="M0 ${HORIZON + 18} Q 80 ${HORIZON + 8} 150 ${HORIZON + 14} L 0 ${H}Z" fill="#000" opacity="0.04"/>`;
    out += groundTexture(kind, seed);
    if (kind === "wood") {
        for (let i = 0; i < 14; i++) {
            const left = i % 2 === 0;
            const near = (i >> 1) / 6;
            if (clearVerges && near > 0.34)
                continue;
            const x = left ? 92 - near * 110 + ((seed * 7 + i * 5) % 9) : 228 + near * 110 - ((seed * 3 + i * 5) % 9);
            const r = 10 + near * 26;
            const y = HORIZON + 4 + near * 26;
            out += treeSvg(x, y + r * 0.9, r * 0.75, i);
        }
    }
    else {
        // A distant line of trees and bushes on the horizon, hazier than anything near.
        for (let i = 0; i < 9; i++) {
            const x = 8 + i * 37 + ((seed * 13 + i * 7) % 11);
            if (x > 125 && x < 195)
                continue;
            out += `<g opacity="0.82">${treeSvg(x, HORIZON + 1, 5.5 + (i % 3) * 1.2, i)}</g>`;
        }
    }
    if (kind === "scrub") {
        for (let i = 0; i < 16; i++) {
            const near = (i % 8) / 7;
            const y = HORIZON + 8 + near * near * 90;
            const [l, r] = trackEdges(y);
            const x = i < 8 ? l - 14 - near * 40 - ((seed + i) % 4) * 6 : r + 14 + near * 40 + ((seed + i) % 4) * 6;
            const s = 3 + near * 10;
            if (clearVerges && near > 0.4 && near < 0.95)
                continue;
            out += shrubSvg(x, y, s, true);
            if (i % 3 === 0)
                out += `<ellipse cx="${x + s * 1.6}" cy="${y + 1}" rx="${s * 0.6}" ry="${s * 0.4}" fill="#8f8a78"/><ellipse cx="${x + s * 1.5}" cy="${y + 0.4}" rx="${s * 0.35}" ry="${s * 0.18}" fill="#b3ae9c"/>`;
        }
    }
    return out;
}
/** The dirt track itself: packed earth, two darker wheel ruts, a grassy centre strip. No markings. */
function track() {
    const ruts = [0.3, 0.7]
        .map((f) => {
        const [l0, r0] = trackEdges(VP.y);
        const [l1, r1] = trackEdges(H);
        const x0 = l0 + (r0 - l0) * f;
        const x1 = l1 + (r1 - l1) * f;
        return `<polygon points="${x0 - 0.6},${VP.y} ${x0 + 0.6},${VP.y} ${x1 + 12},${H} ${x1 - 12},${H}" fill="#7a6246" opacity="0.75"/><polygon points="${x0 - 0.2},${VP.y} ${x0 + 0.2},${VP.y} ${x1 + 3},${H} ${x1 - 3},${H}" fill="#5f4b34" opacity="0.45"/>`;
    })
        .join("");
    const centre = `<polygon points="${VP.x - 0.4},${VP.y} ${VP.x + 0.4},${VP.y} ${VP.x + 10},${H} ${VP.x - 10},${H}" fill="#8b9a63" opacity="0.8"/>`;
    // Soft verges: the track's edges fray into the grass instead of ending on a hard line.
    const [a0, b0] = trackEdges(VP.y);
    const [a1, b1] = trackEdges(H);
    const verge = `<polygon points="${a0 - 1},${VP.y} ${a0 + 0.5},${VP.y} ${a1 + 7},${H} ${a1 - 9},${H}" fill="#8f8a5c" opacity="0.55"/><polygon points="${b0 - 0.5},${VP.y} ${b0 + 1},${VP.y} ${b1 + 9},${H} ${b1 - 7},${H}" fill="#8f8a5c" opacity="0.55"/>`;
    return `<polygon points="${trackPolygon()}" fill="url(#rc-trk)"/>${ruts}${centre}${verge}`;
}
function frame(body, label) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid slice">${SCENE_DEFS}${body}</svg>`;
}
/** Scales an obstacle about a point, so it covers the track but leaves clear ground on both verges to drive around it. */
const narrowed = (body, cx, cy, k) => `<g transform="translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})">${body}</g>`;
function stones(n, y0, y1, maxSize, color, seed) {
    let out = "";
    for (let i = 0; i < n; i++) {
        const r = (Math.sin(seed * 97 + i * 12.9898) * 43758.5453) % 1;
        const r2 = (Math.sin(seed * 31 + i * 78.233) * 12345.678) % 1;
        const y = y0 + Math.abs(r2) * (y1 - y0);
        const [l, rr] = trackEdges(y);
        const x = l + 6 + Math.abs(r) * (rr - l - 12);
        const s = 1.2 + Math.abs(r * r2) * maxSize * ((y - VP.y) / (H - VP.y) + 0.3);
        out += `<ellipse cx="${x}" cy="${y}" rx="${s * 1.4}" ry="${s * 0.8}" fill="${color}"/>`;
    }
    return out;
}
/** Terrain each event scene is shown in. */
const EVENT_TERRAIN = {
    small_debris: "open",
    shallow_water: "open",
    light_brush: "scrub",
    rubble_pile: "scrub",
    fallen_tree: "wood",
    abandoned_vehicle: "scrub",
    fallen_sapling: "wood",
    tall_reeds: "open",
    small_debris_b: "wood",
    fallen_tree_b: "wood",
    fallen_pole: "open",
    stalled_tractor: "open",
    flat_litter: "scrub",
    gravel_ford: "open",
    smoke_drift: "scrub",
    flooded_dip: "open",
    dry_ditch: "scrub",
    low_berm: "open"
};
const OBJECTS = {
    small_debris: () => stones(26, 130, 182, 3.2, "#5e584e", 3) +
        `<path d="M120 168 l26 -4 M180 158 l22 3 M150 146 l14 -2" stroke="#6b5235" stroke-width="2" stroke-linecap="round"/>`,
    shallow_water: () => {
        const [l1, r1] = trackEdges(132);
        const [l2, r2] = trackEdges(176);
        return `<path d="M${l1 - 14} 132 Q 160 126 ${r1 + 14} 132 L ${r2 + 18} 176 Q 160 184 ${l2 - 18} 176 Z" fill="#7fb2c9" opacity="0.45"/>
    <path d="M${l1 + 6} 140 h30 M${r1 - 34} 150 h24 M${l2 + 26} 168 h40" stroke="#e8f4f8" stroke-width="1.2" opacity="0.7"/>`;
    },
    light_brush: () => {
        let out = "";
        for (let i = 0; i < 22; i++) {
            const y = 110 + (i % 11) * 8;
            const [l, r] = trackEdges(y);
            const side = i < 11 ? l + 4 + (i % 3) * 5 : r - 4 - (i % 3) * 5;
            const h = 3 + (y - VP.y) * 0.12;
            out += `<path d="M${side} ${y} l-3 ${-h} M${side} ${y} l0 ${-h * 1.2} M${side} ${y} l3 ${-h}" stroke="#5f7a3e" stroke-width="1.3" stroke-linecap="round"/>`;
        }
        out += `<path d="M150 150 l-4 -7 M150 150 l0 -9 M150 150 l4 -7 M176 162 l-4 -8 M176 162 l0 -10 M176 162 l4 -8" stroke="#6d8746" stroke-width="1.4" stroke-linecap="round"/>`;
        return out;
    },
    rubble_pile: () => narrowed(`<path d="M70 168 L100 110 L128 96 L150 74 L178 88 L206 80 L232 114 L262 170 Z" fill="#8d8575"/>
     <path d="M96 140 l22 -8 l10 14 l-24 6z M150 96 l20 2 l-2 14 l-20 -2z M190 120 l26 -2 l4 16 l-28 0z M120 120 l14 -6 l6 10 l-14 6z M210 150 l18 -4 l6 10 l-20 4z" fill="#a69c88"/>
     <path d="M110 160 l30 -6 M200 100 l12 10 M160 130 l18 4" stroke="#5a5650" stroke-width="2"/>
     <rect x="136" y="84" width="34" height="8" fill="#9b6a4f" transform="rotate(-12 150 88)"/>`, 160, 168, 0.84),
    // A trunk across the whole track and a little beyond, with its crown at the left end and the torn-up root plate at
    // the right; clear ground on both verges, so a way round it is plain to see (Oct 2026).
    fallen_tree: () => `<ellipse cx="160" cy="154" rx="108" ry="7" fill="#221d16" opacity="0.45"/>
     <g transform="rotate(-2.5 160 140)">
       <path d="M96 131 l-16 -20 M84 120 l-8 -4 M128 130 l-6 -16 M176 130 l8 -18 M214 131 l12 -14" stroke="#5a4029" stroke-width="3.2" stroke-linecap="round"/>
       <rect x="74" y="128" width="172" height="21" rx="10" fill="url(#rc-bark)" stroke="#2e2216" stroke-width="1.4"/>
       <path d="M86 133 h38 M134 136 h50 M98 142 h30 M192 132 h36 M202 144 h32 M150 145 h24" stroke="#3f2d1d" stroke-width="1.1" opacity="0.65"/>
       <path d="M80 131 h160" stroke="#a88a66" stroke-width="1" opacity="0.5"/>
       <ellipse cx="152" cy="138" rx="3" ry="2" fill="#3f2d1d"/><ellipse cx="206" cy="139" rx="2.4" ry="1.6" fill="#3f2d1d"/>
       <circle cx="250" cy="138" r="17" fill="url(#rc-roots)"/>
       <path d="M250 138 l14 -10 M250 138 l16 4 M250 138 l9 13 M250 138 l-2 -16 M250 138 l-11 -12" stroke="#5b4630" stroke-width="2" stroke-linecap="round"/>
       <ellipse cx="248" cy="154" rx="12" ry="2.5" fill="#6e5a42" opacity="0.8"/>
       <ellipse cx="78" cy="122" rx="20" ry="15" fill="#4c6634"/><ellipse cx="66" cy="132" rx="13" ry="11" fill="#56713b"/>
       <ellipse cx="92" cy="114" rx="13" ry="10" fill="#62803f"/><ellipse cx="72" cy="112" rx="10" ry="8" fill="#6c8a47"/>
       <ellipse cx="84" cy="138" rx="12" ry="7" fill="#4c6634" opacity="0.9"/>
     </g>`,
    abandoned_vehicle: () => narrowed(`<ellipse cx="160" cy="160" rx="120" ry="8" fill="#2f2c28" opacity="0.3"/>
     <rect x="54" y="96" width="140" height="56" rx="4" fill="#6f7a6a"/>
     <path d="M194 112 h46 l20 22 v18 h-66z" fill="#5f6a5a"/>
     <path d="M204 116 h30 l14 16 h-44z" fill="#9db2bc"/>
     <path d="M77 162 Q 76 141 92 140 Q 108 141 107 162 Q 92 166 77 162Z" fill="#2a2826"/><ellipse cx="92" cy="152" rx="6" ry="5" fill="#77746d"/>
     <path d="M211 162 Q 210 141 226 140 Q 242 141 241 162 Q 226 166 211 162Z" fill="#2a2826"/><ellipse cx="226" cy="152" rx="6" ry="5" fill="#77746d"/>
     <rect x="206" y="118" width="34" height="32" fill="#2c302a"/>
     <path d="M240 117 L 274 106 L 274 150 L 240 152Z" fill="#66715f" stroke="#4f584a" stroke-width="1"/>
     <path d="M244 120 L 270 112 L 270 126 L 244 132Z" fill="#9db2bc"/>
     <path d="M60 104 h128" stroke="#58624f" stroke-width="2"/>
     <path d="M70 112 q 30 -4 60 2 M120 140 q 25 -3 50 1" stroke="#9c9a85" stroke-width="3" opacity="0.35"/>`, 160, 160, 0.8),
    // A thin young tree lying flat across the track: wrist-thick trunk, a few twigs, a small low crown at the left.
    fallen_sapling: () => `<ellipse cx="160" cy="152" rx="140" ry="4" fill="#3f3a33" opacity="0.2"/>
     <path d="M26 150 L 300 146" stroke="#8a6c4c" stroke-width="3.2" stroke-linecap="round"/>
     <path d="M80 149 l-10 -6 M126 148 l8 -7 M168 147 l-9 5 M210 147 l10 -6 M250 146 l-8 6" stroke="#7a5e40" stroke-width="1.3" stroke-linecap="round"/>
     <ellipse cx="34" cy="146" rx="18" ry="5" fill="#5d7d3e" opacity="0.9"/><ellipse cx="22" cy="149" rx="10" ry="4" fill="#6c8c48"/>
     <path d="M300 146 l6 -4 M300 146 l7 2 M300 146 l4 5" stroke="#5a4430" stroke-width="1"/>`,
    // Dense reeds taller than the vehicle filling the track: the ground among them cannot be seen.
    tall_reeds: () => {
        let stems = "";
        for (let i = 0; i < 120; i++) {
            const x = 20 + ((i * 53) % 281);
            const top = 60 + ((i * 37) % 30);
            const lean = ((i * 17) % 9) - 4;
            stems += `<path d="M${x} 172 Q ${x + lean} ${(172 + top) / 2} ${x + lean * 2} ${top}" stroke="${["#a59d58", "#b8ae68", "#8d8a4a", "#7c8645"][i % 4]}" stroke-width="2" fill="none"/>`;
            if (i % 4 === 0)
                stems += `<rect x="${x + lean * 2 - 1.6}" y="${top - 8}" width="3.2" height="9" rx="1.5" fill="#6a4a2c"/>`;
        }
        return `<rect x="10" y="110" width="300" height="64" fill="#6e6a3c"/>${stems}`;
    },
    small_debris_b: () => stones(22, 128, 184, 2.6, "#6b5a44", 11) +
        `<path d="M112 160 l20 -5 M178 150 l18 4 M140 176 l22 -2 M200 172 l16 -6" stroke="#5a4029" stroke-width="1.8" stroke-linecap="round"/>
     <ellipse cx="128" cy="148" rx="3" ry="4.5" fill="#7a5532"/><ellipse cx="190" cy="164" rx="3.5" ry="5" fill="#7a5532"/><ellipse cx="160" cy="138" rx="2.5" ry="3.5" fill="#7a5532"/>`,
    fallen_tree_b: () => narrowed(`<ellipse cx="160" cy="146" rx="150" ry="9" fill="#3f3a33" opacity="0.25"/>
     <rect x="12" y="126" width="296" height="16" rx="8" fill="#8a8678"/>
     <path d="M24 130 h276" stroke="#6d6a5f" stroke-width="1.6"/>
     <path d="M286 104 l26 26 l-26 22 l-30 -24z M268 112 l18 18 l-18 16 l-20 -18z" fill="#2f4a2b" opacity="0.55"/>
     <path d="M297.5 120.0 L314.0 120.0 M297.2 121.9 L312.7 126.0 M296.2 123.5 L308.9 131.3 M294.8 124.8 L303.0 135.2 M293.0 125.4 L295.8 137.3 M291.0 125.4 L288.2 137.3 M289.2 124.8 L281.0 135.2 M287.8 123.5 L275.1 131.3 M286.8 121.9 L271.3 126.0 M286.5 120.0 L270.0 120.0 M286.8 118.1 L271.3 114.0 M287.8 116.5 L275.1 108.7 M289.2 115.2 L281.0 104.8 M291.0 114.6 L288.2 102.7 M293.0 114.6 L295.8 102.7 M294.8 115.2 L303.0 104.8 M296.2 116.5 L308.9 108.7 M297.2 118.1 L312.7 114.0 M276.0 128.0 L288.0 128.0 M275.8 129.4 L287.0 132.4 M275.1 130.6 L284.3 136.2 M274.0 131.5 L280.0 139.1 M272.7 131.9 L274.8 140.6 M271.3 131.9 L269.2 140.6 M270.0 131.5 L264.0 139.1 M268.9 130.6 L259.7 136.2 M268.2 129.4 L257.0 132.4 M268.0 128.0 L256.0 128.0 M268.2 126.6 L257.0 123.6 M268.9 125.4 L259.7 119.8 M270.0 124.5 L264.0 116.9 M271.3 124.1 L269.2 115.4 M272.7 124.1 L274.8 115.4 M274.0 124.5 L280.0 116.9 M275.1 125.4 L284.3 119.8 M275.8 126.6 L287.0 123.6 M304.0 140.0 L316.0 140.0 M303.8 141.4 L315.0 144.4 M303.1 142.6 L312.3 148.2 M302.0 143.5 L308.0 151.1 M300.7 143.9 L302.8 152.6 M299.3 143.9 L297.2 152.6 M298.0 143.5 L292.0 151.1 M296.9 142.6 L287.7 148.2 M296.2 141.4 L285.0 144.4 M296.0 140.0 L284.0 140.0 M296.2 138.6 L285.0 135.6 M296.9 137.4 L287.7 131.8 M298.0 136.5 L292.0 128.9 M299.3 136.1 L297.2 127.4 M300.7 136.1 L302.8 127.4 M302.0 136.5 L308.0 128.9 M303.1 137.4 L312.3 131.8 M303.8 138.6 L315.0 135.6 M285.5 108.0 L296.0 108.0 M285.3 109.2 L295.2 111.8 M284.7 110.2 L292.7 115.2 M283.8 111.0 L289.0 117.7 M282.6 111.4 L284.4 119.0 M281.4 111.4 L279.6 119.0 M280.2 111.0 L275.0 117.7 M279.3 110.2 L271.3 115.2 M278.7 109.2 L268.8 111.8 M278.5 108.0 L268.0 108.0 M278.7 106.8 L268.8 104.2 M279.3 105.8 L271.3 100.8 M280.2 105.0 L275.0 98.3 M281.4 104.6 L279.6 97.0 M282.6 104.6 L284.4 97.0 M283.8 105.0 L289.0 98.3 M284.7 105.8 L292.7 100.8 M285.3 106.8 L295.2 104.2" stroke="#3f6234" stroke-width="1.6" stroke-linecap="round"/>
     <circle cx="18" cy="134" r="9" fill="#a8845c"/><circle cx="18" cy="134" r="4.5" fill="#c4a27a"/>`, 160, 134, 0.8),
    fallen_pole: () => narrowed(`<ellipse cx="160" cy="152" rx="140" ry="6" fill="#3f3a33" opacity="0.25"/>
     <rect x="20" y="138" width="282" height="9" rx="4" fill="#7a6650" transform="rotate(-3 160 142)"/>
     <rect x="236" y="120" width="5" height="32" fill="#6a5845" transform="rotate(-3 160 142)"/>
     <path d="M30 140 C 90 120 140 118 238 124" stroke="#33302c" stroke-width="1" fill="none"/>`, 160, 142, 0.72),
    stalled_tractor: () => `<ellipse cx="160" cy="166" rx="110" ry="7" fill="#2f2c28" opacity="0.3"/>
     <rect x="96" y="104" width="94" height="40" rx="4" fill="#b84a36"/>
     <rect x="180" y="78" width="46" height="52" rx="3" fill="#a8412f"/><rect x="188" y="84" width="30" height="24" fill="#9db2bc"/>
     <rect x="104" y="92" width="6" height="14" fill="#3a3a38"/>
     <circle cx="208" cy="148" r="26" fill="#2a2826"/><circle cx="208" cy="148" r="11" fill="#c9a34a"/>
     <circle cx="112" cy="156" r="15" fill="#2a2826"/><circle cx="112" cy="156" r="6" fill="#c9a34a"/>`,
    flat_litter: () => {
        let out = "";
        const pieces = [[118, 150, 26, 12, -8, "#d8cdb4"], [176, 140, 22, 10, 12, "#e6e2d8"], [150, 170, 34, 13, 4, "#c9b48c"], [196, 172, 24, 11, -14, "#dfe7ea"], [134, 134, 16, 7, 6, "#e6e2d8"]];
        for (const [x, y, w, h, r, c] of pieces)
            out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" transform="rotate(${r} ${x + w / 2} ${y + h / 2})" opacity="0.95"/>`;
        return out;
    },
    gravel_ford: () => {
        const [l1, r1] = trackEdges(132);
        const [l2, r2] = trackEdges(172);
        return `<path d="M0 128 Q 160 120 320 128 L 320 172 Q 160 182 0 172 Z" fill="#8ab8c8" opacity="0.5"/>
      ${stones(30, 132, 170, 2.2, "#8a8170", 21)}
      ${stones(18, 132, 170, 1.6, "#a39a86", 22)}
      <path d="M${l1 - 40} 140 h34 M${r1 + 10} 150 h30 M${l2 - 30} 164 h40 M${r2 - 20} 166 h36" stroke="#eef6f8" stroke-width="1.2" opacity="0.7"/>`;
    },
    // Smoke rolling across the track from the left: soft, layered puffs, densest over the track, so the ground
    // beyond is hidden.
    smoke_drift: () => {
        const puffs = [
            [24, 120, 44, 30, true], [70, 104, 58, 38, false], [128, 118, 66, 40, false], [190, 100, 70, 42, false], [250, 112, 62, 36, true],
            [300, 96, 46, 30, false], [96, 140, 52, 26, false], [168, 142, 70, 28, true], [236, 138, 54, 26, false], [150, 90, 80, 30, false],
            [40, 84, 50, 24, false], [280, 80, 50, 22, false], [112, 128, 34, 20, true], [206, 124, 36, 20, true]
        ];
        return `<rect y="${HORIZON - 30}" width="${W}" height="78" fill="#b5b5ae" opacity="0.55"/>
      ${puffs.map(([x, y, rx, ry, dark]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${dark ? "rc-puff-dark" : "rc-puff"})"/>`).join("")}
      <path d="M0 150 Q 60 138 120 146 T 240 142 T 320 148" stroke="#c9c9c4" stroke-width="7" fill="none" opacity="0.35" stroke-linecap="round"/>`;
    },
    // A dip in the track full of opaque, muddy water: wet dark banks, a dull sheen from the sky, ripples, and the
    // wheel ruts running into it and vanishing.
    flooded_dip: () => {
        const [l1, r1] = trackEdges(128);
        const [l2, r2] = trackEdges(176);
        const ruts = [0.3, 0.7]
            .map((f) => {
            const x0 = l2 + (r2 - l2) * f;
            const [lb, rb] = trackEdges(H);
            const x1 = lb + (rb - lb) * f;
            return `<polygon points="${x0 - 3},176 ${x0 + 3},176 ${x1 + 13},${H} ${x1 - 13},${H}" fill="#4f3e28" opacity="0.55"/>`;
        })
            .join("");
        return `<path d="M${l1 - 44} 127 Q 160 115 ${r1 + 44} 127 Q ${r2 + 60} 160 ${r2 + 34} 180 Q 160 196 ${l2 - 34} 180 Q ${l2 - 60} 160 ${l1 - 44} 127 Z" fill="#5d4a30" opacity="0.55"/>
      <path d="M${l1 - 34} 129 Q 160 118 ${r1 + 34} 129 Q ${r2 + 44} 158 ${r2 + 24} 176 Q 160 188 ${l2 - 24} 176 Q ${l2 - 44} 158 ${l1 - 34} 129 Z" fill="url(#rc-mud)"/>
      <path d="M${l1 - 26} 131 Q 160 121 ${r1 + 26} 131 Q ${r1 + 30} 137 ${r1 + 18} 139 Q 160 131 ${l1 - 18} 139 Q ${l1 - 30} 137 ${l1 - 26} 131 Z" fill="#cfc8b4" opacity="0.3"/>
      <path d="M${l1 - 10} 146 q 26 -4 52 0 M${r1 - 34} 153 q 22 -3 44 0 M${l2 + 20} 165 q 36 -5 72 0 M${l2 + 116} 170 q 22 -3 40 0" stroke="#a48b63" stroke-width="1.1" fill="none" opacity="0.7"/>
      <ellipse cx="204" cy="160" rx="10" ry="2" fill="none" stroke="#a08962" stroke-width="0.9" opacity="0.7"/>
      <ellipse cx="126" cy="150" rx="7" ry="1.5" fill="none" stroke="#a08962" stroke-width="0.8" opacity="0.7"/>
      ${ruts}`;
    },
    dry_ditch: () => {
        const band = (y0, y1, fill) => {
            const [a0, b0] = trackEdges(y0);
            const [a1, b1] = trackEdges(y1);
            return `<polygon points="${a0 - 60},${y0} ${b0 + 60},${y0} ${b1 + 70},${y1} ${a1 - 70},${y1}" fill="${fill}"/>`;
        };
        return band(140, 146, "#8a7352") + band(146, 152, "#76603f") + band(152, 158, "#8a7352");
    },
    low_berm: () => `<path d="M0 156 C 60 140 120 136 160 136 C 200 136 260 140 320 156 L 320 166 L 0 166 Z" fill="#87a066"/>
     <path d="M0 156 C 60 140 120 136 160 136 C 200 136 260 140 320 156" stroke="#6f8a52" stroke-width="2" fill="none"/>
     <path d="M70 146 l-2 -5 M110 140 l1 -5 M210 140 l-1 -5 M250 146 l2 -5" stroke="#5d7a45" stroke-width="1.4"/>`,
};
/** The critical scene: the track crosses a ravine on a narrow vehicle bridge; deck intact at the approach, a gap mid-span. */
function damagedBridge() {
    const [gl0, gr0] = trackEdges(120);
    const [gl1, gr1] = trackEdges(138);
    const deck = "#8a7a63";
    const planks = (y0, y1) => {
        let out = "";
        for (let y = y0; y < y1; y += 2.5 + (y - VP.y) * 0.09) {
            const [l, r] = trackEdges(y);
            out += `<path d="M${l} ${y} H ${r}" stroke="#6d5f4c" stroke-width="${0.5 + (y - VP.y) * 0.012}"/>`;
        }
        return out;
    };
    const rails = (side) => {
        let out = "";
        for (let y = VP.y + 4; y < H; y += 4 + (y - VP.y) * 0.18) {
            if (side === 0 && y > 120 && y < 136)
                continue; // one railing broken where the deck is damaged
            const e = trackEdges(y)[side];
            const h = 2 + (y - VP.y) * 0.14;
            out += `<rect x="${e + (side ? 1 : -2)}" y="${y - h}" width="${0.8 + (y - VP.y) * 0.02}" height="${h}" fill="#4d4b46"/>`;
        }
        const a = trackEdges(VP.y)[side];
        const b = trackEdges(H)[side];
        const hb = 2 + (H - VP.y) * 0.14;
        return out + `<path d="M${a} ${VP.y - 2} L ${b} ${H - hb}" stroke="#4d4b46" stroke-width="1.6"/>`;
    };
    return `${sky()}
    <rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#rc-gnd-open)"/>${groundTexture("open", 7)}
    <path d="M60 ${HORIZON + 2} L 260 ${HORIZON + 2} L 180 ${H} L 140 ${H} Z" fill="#4a3f33"/>
    <path d="M60 ${HORIZON + 2} L 110 ${HORIZON + 2} L 150 ${H} L 140 ${H} Z" fill="#5c4f3f"/>
    <path d="M210 ${HORIZON + 2} L 260 ${HORIZON + 2} L 180 ${H} L 170 ${H} Z" fill="#3d342b"/>
    <path d="M118 ${HORIZON + 30} L 202 ${HORIZON + 30} L 168 ${H} L 152 ${H} Z" fill="#3f6f84"/>
    <polygon points="${trackPolygon(VP.y, 120)}" fill="${deck}"/>${planks(VP.y + 1, 120)}
    <polygon points="${trackPolygon(120, 138)}" fill="${deck}"/>${planks(120, 138)}
    <!-- Mid-span damage, deliberately modest: a few planks missing on the left half of the deck, a dark gap
         and a slight sag. Visible on a careful look, not at a glance (tune in the pilot). -->
    <path d="M${gl0 + 2} 125 l6 -1.5 l5 2 l6 -1 l5 1.5 l6 -1.2 l4 1 L ${gl0 + (gr0 - gl0) * 0.5} 125.5 L ${gl1 + (gr1 - gl1) * 0.46} 132 l-5 1.2 l-6 -1 l-6 1.5 l-5 -1 l-6 1.3 L ${gl1 + 3} 132 Z" fill="#26231f"/>
    <path d="M${gl0 + (gr0 - gl0) * 0.5} 125.5 L ${gr0 - 6} 126.5 M${gl1 + (gr1 - gl1) * 0.46} 132 L ${gr1 - 8} 131" stroke="#5f5242" stroke-width="1.2" opacity="0.8"/>
    <polygon points="${trackPolygon(138, H)}" fill="${deck}"/>${planks(139, H)}
    ${rails(0)}${rails(1)}`;
}
/** Off-road: the side track a UGV follows on a bypass. */
function bypassTrack() {
    const [l1, r1] = trackEdges(H);
    return `${sky()}${terrain("scrub", 4)}
    <polygon points="${VP.x - 3},${VP.y} ${VP.x + 3},${VP.y} ${r1 - 30},${H} ${l1 + 30},${H}" fill="#a58f6a" opacity="0.75"/>
    <path d="M${VP.x - 2} ${VP.y + 2} L ${l1 + 62} ${H} M${VP.x + 2} ${VP.y + 2} L ${r1 - 62} ${H}" stroke="#8a7453" stroke-width="5" opacity="0.5"/>
    ${[120, 140, 160, 182].map((y, i) => `<path d="M${trackEdges(y)[0] + 26 + i * 6} ${y} l-3 -${4 + i * 2} M${trackEdges(y)[1] - 26 - i * 6} ${y} l3 -${4 + i * 2}" stroke="#6d8746" stroke-width="1.6"/>`).join("")}`;
}
/** Section line: a row of marker stakes with flags across the track. */
function sectionLine() {
    let stakes = "";
    for (let i = 0; i < 7; i++) {
        const x = 70 + i * 30;
        stakes += `<rect x="${x}" y="112" width="2.5" height="26" fill="#5b4a36"/><path d="M${x + 2.5} 113 h12 l-3 4 l3 4 h-12z" fill="${i % 2 ? "#e9e4d4" : "#c9483f"}"/>`;
    }
    return `${sky()}${terrain("open", 1)}${track()}${stakes}`;
}
/** The objective: a hilltop observation post reached by the track. */
function objective() {
    return `${sky()}${terrain("open", 2)}${track()}
    <path d="M70 ${HORIZON + 2} Q 160 40 250 ${HORIZON + 2} Z" fill="#8fa274"/>
    <rect x="132" y="56" width="56" height="26" fill="#7a6b55"/><rect x="128" y="52" width="64" height="6" fill="#5b4a36"/>
    <rect x="152" y="68" width="16" height="14" fill="#3e3a33"/>
    <rect x="196" y="28" width="2.5" height="40" fill="#3b3a36"/><path d="M198.5 29 h20 l-5 6 l5 6 h-20z" fill="#3e6fa8"/>`;
}
// --- training views (M3): C3's second camera angle and C4's robot height map ---------
/** Scenes whose height map shows the bottom through clear water rather than the water surface. */
const SEE_THROUGH_BOTTOM = {
    shallow_water: () => stones(16, 134, 174, 1.8, "#000", 31),
    gravel_ford: () => stones(30, 132, 170, 2.2, "#000", 21)
};
/**
 * C3's paired image: the same scene from a second camera, higher up and off
 * to one side (mirrored, more ground, the object seen obliquely). Same scene,
 * same objects - only the viewpoint changes.
 */
export function secondAngleSvg(sceneId) {
    const kind = EVENT_TERRAIN[sceneId] ?? "open";
    const obj = OBJECTS[sceneId]?.() ?? "";
    const body = `<rect width="${W}" height="46" fill="#cfdde3"/>
    <path d="M0 40 Q 80 26 160 36 T 320 32 V 46 H 0Z" fill="#a9b8a4"/>
    <g transform="translate(0 -70.2) scale(1 1.351)">${terrain(kind, 5).replace(/<path d="M0 [^"]*Z" fill="#000" opacity="0.04"\/>/, "")}</g>
    <polygon points="20,${H} 150,${H} 250,46 222,46" fill="#a68d66"/>
    <polygon points="62,${H} 92,${H} 238,46 233,46" fill="#8a7352" opacity="0.7"/>
    <g transform="translate(234 -6) scale(-0.92 1.0) skewX(-14)">${obj}</g>`;
    return frame(body, `${sceneLabel(sceneId)} (second camera angle)`);
}
/**
 * C4's paired image: the robot's view - a height map of what its shape-and-
 * height sensing measures. Colour comes from the scene's geometry fact in the
 * event-definition file: anything that rises above the ground clearance
 * (geometry "blocked") is orange, low terrain is teal. Where clear water lets
 * it sense the bottom, the map shows the bottom, not the surface.
 */
export function heightMapSvg(sceneId, geometry) {
    const fid = `hm-${sceneId}`;
    const color = geometry === "blocked" ? "#f08a3c" : "#3fc7b0";
    let scan = "";
    for (let y = VP.y + 2, k = 0; y < H; y += 2 + k * 0.9, k++)
        scan += `<path d="M0 ${y} H ${W}" stroke="#2c4660" stroke-width="0.6"/>`;
    const obj = SEE_THROUGH_BOTTOM[sceneId]?.() ?? OBJECTS[sceneId]?.() ?? "";
    const body = `<defs><filter id="${fid}"><feFlood flood-color="${color}"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#14212e"/>
    <rect y="${VP.y}" width="${W}" height="${H - VP.y}" fill="#1b2d40"/>${scan}
    <polygon points="${trackPolygon()}" fill="#22394f"/>
    <g filter="url(#${fid})">${obj}</g>
    <rect x="8" y="8" width="10" height="8" fill="#3fc7b0"/><text x="22" y="15" font-size="9" fill="#cfe0ea" font-family="IBM Plex Sans, sans-serif">below ground clearance</text>
    <rect x="8" y="20" width="10" height="8" fill="#f08a3c"/><text x="22" y="27" font-size="9" fill="#cfe0ea" font-family="IBM Plex Sans, sans-serif">above ground clearance</text>`;
    return frame(body, `${sceneLabel(sceneId)} (robot's height map)`);
}
/** Any training image: camera view, C3's second angle, or C4's height map (colour from the scene's geometry fact). */
export function trainingImageSvg(img, geometry) {
    if (img.view === "second_angle")
        return secondAngleSvg(img.sceneId);
    if (img.view === "height_map")
        return heightMapSvg(img.sceneId, geometry);
    return sceneSvg(img.sceneId);
}
const cache = new Map();
/** SVG markup for a scene id. */
export function sceneSvg(sceneId) {
    const hit = cache.get(sceneId);
    if (hit)
        return hit;
    let svg;
    const label = sceneLabel(sceneId);
    if (sceneId === "damaged_bridge")
        svg = frame(damagedBridge(), label);
    else if (sceneId === "bypass_track")
        svg = frame(bypassTrack(), label);
    else if (sceneId === "section_line")
        svg = frame(sectionLine(), label);
    else if (sceneId === "objective")
        svg = frame(objective(), label);
    else {
        const m = /^track_(open|scrub|wood)_(\d)$/.exec(sceneId);
        const kind = m ? m[1] : EVENT_TERRAIN[sceneId] ?? "open";
        const variant = m ? Number(m[2]) : 1;
        const obj = OBJECTS[sceneId]?.() ?? "";
        svg = frame(`${sky()}${terrain(kind, variant, !m)}${track()}${obj}`, label);
    }
    cache.set(sceneId, svg);
    return svg;
}
/**
 * Where each mission obstacle sits in its still (scene units): its left and right extent, its top and its base.
 * Every one leaves clear ground on both verges, so the take-over waypoints can lead round it on either side.
 */
const OBSTACLE_EXTENT = {
    small_debris: { x0: 98, x1: 222, top: 128, base: 182 },
    shallow_water: { x0: 64, x1: 256, top: 126, base: 180 },
    light_brush: { x0: 78, x1: 242, top: 112, base: 176 },
    rubble_pile: { x0: 84, x1: 244, top: 90, base: 168 },
    fallen_tree: { x0: 50, x1: 270, top: 104, base: 154 },
    abandoned_vehicle: { x0: 74, x1: 252, top: 100, base: 166 },
    flooded_dip: { x0: 52, x1: 268, top: 118, base: 184 },
    tall_reeds: { x0: 18, x1: 302, top: 56, base: 174 },
    smoke_drift: { x0: 40, x1: 280, top: 70, base: 170 },
    low_berm: { x0: 40, x1: 280, top: 134, base: 166 },
    fallen_sapling: { x0: 22, x1: 302, top: 140, base: 154 },
    gravel_ford: { x0: 30, x1: 290, top: 126, base: 176 },
    // The bridge: the way round is an alternate crossing off to the side, along the ravine's rim.
    damaged_bridge: { x0: 58, x1: 262, top: 96, base: 152, offRoute: true }
};
/**
 * The take-over waypoints beside an obstacle, for a bypass on the given side (+1 right, -1 left): a ground path
 * leaving the track, passing the obstacle on the clear verge and rejoining beyond it, with three numbered pins.
 */
export function waypointGeometry(sceneId, side) {
    const e = OBSTACLE_EXTENT[sceneId] ?? { x0: 70, x1: 250, top: 110, base: 172 };
    const edge = side > 0 ? e.x1 : e.x0;
    const clampX = (x) => Math.max(20, Math.min(W - 20, x));
    // Beside the obstacle's base, on the clear verge; then the same sideways distance on the ground, seen in
    // perspective, for the points nearer and further away (lateral offsets shrink towards the horizon).
    const p2 = { x: clampX(edge + side * 24), y: e.base - 4 };
    const lateral = Math.abs(p2.x - VP.x) / (p2.y - VP.y);
    const at = (y, f) => ({ x: clampX(VP.x + side * lateral * (y - VP.y) * f), y });
    const start = { x: VP.x + side * 16, y: H + 2 };
    const p1 = at((H + p2.y) / 2 + 8, 0.55);
    // Past the obstacle: still clear of its far corner, then back onto the track behind it.
    const p3 = e.offRoute ? { x: clampX(p2.x + side * 14), y: VP.y + 18 } : { x: clampX(edge + side * 16), y: Math.max(VP.y + 12, e.top + (e.base - e.top) * 0.35) };
    const end = e.offRoute ? { x: side > 0 ? W + 6 : -6, y: VP.y + 6 } : { x: VP.x + side * 6, y: Math.max(VP.y + 5, e.top - 8) };
    return { path: [start, p1, p2, p3, end], pins: [p1, p2, p3] };
}
/** Geometry shared with the live camera feed (camera-feed.ts). */
export const SCENE_GEOMETRY = { W, H, HORIZON, VP, trackEdges };
/** The terrain a scene sits in (null for scenes with their own ground, e.g. the bridge). */
export function sceneTerrain(sceneId) {
    const m = /^track_(open|scrub|wood)_\d$/.exec(sceneId);
    if (m)
        return m[1];
    if (sceneId === "bypass_track")
        return "scrub";
    return EVENT_TERRAIN[sceneId] ?? null;
}
/** Plain-language alt text: what the camera shows, without classifying it. */
export function sceneLabel(sceneId) {
    const m = /^track_(open|scrub|wood)_/.exec(sceneId);
    if (m)
        return `Camera view: the track ahead (${m[1] === "open" ? "open country" : m[1] === "scrub" ? "scrubland" : "woodland"})`;
    const labels = {
        bypass_track: "Camera view: a side track (bypass)",
        small_debris: "Camera view: small debris on the track",
        shallow_water: "Camera view: water across the track",
        light_brush: "Camera view: brush along the track",
        rubble_pile: "Camera view: a rubble pile on the track",
        fallen_tree: "Camera view: a tree across the track",
        abandoned_vehicle: "Camera view: a vehicle across the track",
        fallen_sapling: "Camera view: a thin fallen tree across the track",
        tall_reeds: "Camera view: tall reeds filling the track",
        damaged_bridge: "Camera view: a bridge over a ravine",
        small_debris_b: "Camera view: twigs and pebbles on the track",
        fallen_tree_b: "Camera view: a fallen grey-barked tree across the track",
        fallen_pole: "Camera view: a pole across the track",
        stalled_tractor: "Camera view: a tractor across the track",
        flat_litter: "Camera view: flat litter on the track",
        gravel_ford: "Camera view: a stream across the track",
        smoke_drift: "Camera view: smoke across the track",
        flooded_dip: "Camera view: muddy water in a dip",
        dry_ditch: "Camera view: a ditch across the track",
        low_berm: "Camera view: a low mound across the track",
        section_line: "Camera view: section line markers",
        objective: "Camera view: the objective"
    };
    return labels[sceneId] ?? "Camera view";
}
