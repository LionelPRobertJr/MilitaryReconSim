import { cumulative, pointAt, slice } from "../sim/geometry.js";
import { SCENE_DEFS, SCENE_GEOMETRY, sceneLabel, sceneSvg, sceneTerrain, treeSvg, waypointGeometry } from "./scenes.js";
// Each UGV panel's forward view, seen through the vehicle's windscreen
// (research team redesign, Oct 2026: "both views from the UGV should appear
// to be viewed through a front dash window").
//
// Driving: the view is drawn from the vehicle's real position and the actual
// path ahead of it (its route, or the waypoints it is following and the route
// after it), in one-point perspective. A take-over is seen as it happens: the
// vehicle backs up if it has to, the track ahead bends off to the side, the
// horizon pans as it turns, and it bends back onto the route at the far end.
//
// An obstacle: the camera shows exactly the scene still (scenes.ts) that the
// log records (camera_scene) and that training uses, from the moment the UGV
// detects it (yellow light). While the UGV approaches, the view closes in on
// it; driving through, it zooms past and cuts back to the live view; stuck on
// the bridge, the view tilts. The waypoints for a take-over are drawn beside
// the obstacle whenever a take-over is possible.
//
// Display only: everything comes from simulation state, so it is identical in
// every condition, freezes when the mission pauses, and changes nothing that
// is logged. prefers-reduced-motion keeps the views but drops the bob, grain
// and glitches.
const { W, H, HORIZON, VP } = SCENE_GEOMETRY;
const SECTION_TERRAIN = { A: "open", B: "scrub", C: "wood" };
// Camera model (map units ahead f, to the right l): y = VP.y + A / f, x = VP.x + FX * l / f.
const A = (H - VP.y) * 0.5; // the ground at the bottom edge is 0.5 map units ahead
const FX = 210;
const F_NEAR = 0.35;
const LOOK_AHEAD = 32;
/** Track half-width, map units. */
const HW = 0.25;
/** The horizon panorama wraps once around 360 degrees of heading. */
const PANO = Math.round(2 * Math.PI * FX);
/** Zoom of an obstacle still when the UGV reaches it (1 at detection), and when it has driven through. */
const ZOOM_AT_OBSTACLE = 1.08;
const ZOOM_PASSED = 2.2;
/** Ground-mark cycle length along the path, map units. */
const MARK_SPAN = 12;
const MARKS = [];
for (let i = 0; i < 10; i++) {
    MARKS.push({ lane: -0.5, kind: "rut", offset: i / 10 });
    MARKS.push({ lane: 0.5, kind: "rut", offset: (i + 0.5) / 10 });
    MARKS.push({ lane: 0, kind: "tuft", offset: (i + 0.25) / 10 });
}
for (let i = 0; i < 7; i++) {
    MARKS.push({ lane: -1.5 - (i % 3) * 0.5, kind: "stone", offset: (i + 0.1) / 7 });
    MARKS.push({ lane: 1.6 + (i % 2) * 0.6, kind: "stone", offset: (i + 0.6) / 7 });
}
// --- the horizon panorama: periodic, so it wraps seamlessly as the vehicle turns ---
const panoCache = new Map();
function panorama(kind) {
    const hit = panoCache.get(kind);
    if (hit)
        return hit;
    const k = (2 * Math.PI) / PANO;
    let hills = `M0 ${HORIZON}`;
    const hillY = (x) => (HORIZON - 15 - 8 * Math.sin(x * k * 3 + 0.7) - 5 * Math.sin(x * k * 7 + 2.1)).toFixed(1);
    // Sample to exactly PANO (and a little past), so copies placed side by side join without a notch.
    for (let x = 0; x < PANO; x += 12)
        hills += ` L${x} ${hillY(x)}`;
    hills += ` L${PANO} ${hillY(PANO)} L${PANO + 2} ${hillY(PANO + 2)}`;
    hills += ` L${PANO + 2} ${HORIZON} Z`;
    let veg = "";
    const n = kind === "wood" ? 70 : 34;
    for (let i = 0; i < n; i++) {
        const r1 = Math.abs(Math.sin(i * 12.9898 + (kind === "wood" ? 3 : kind === "scrub" ? 2 : 1)) * 43758.5453) % 1;
        const x = (i / n) * PANO + r1 * 14;
        if (kind === "wood")
            veg += treeSvg(x, HORIZON + 1, 6 + r1 * 5, i);
        else
            veg += `<g opacity="0.85">${treeSvg(x, HORIZON + 1, 4.5 + r1 * 3, i)}</g>`;
    }
    const out = `<path d="${hills}" fill="#9dad97"/>${veg}`;
    panoCache.set(kind, out);
    return out;
}
let grainUrl = null;
export function grain() {
    if (grainUrl !== null)
        return grainUrl;
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    if (!g)
        return (grainUrl = "");
    const img = g.createImageData(96, 96);
    let s = 12345;
    for (let i = 0; i < img.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const v = s & 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (grainUrl = c.toDataURL());
}
export const fmtTc = (t) => {
    const s = Math.max(0, t);
    const m = Math.floor(s / 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s * 10) % 10)}`;
};
const f1 = (x) => x.toFixed(1);
/** The path the camera looks along, starting at the vehicle, and whether the vehicle is backing up. */
export function cameraPath(u, network) {
    const route = network.routes[u.id];
    if (u.manual) {
        const m = u.manual;
        const ev = network.events.find((e) => e.id === m.eventId);
        // A take-over right at an obstacle first backs up a little along the route (startReroute in session.ts).
        const backUp = m.backUp;
        if (m.progress < backUp - 1e-6) {
            // Backing up: the camera still faces forward, along the route ahead of where the vehicle now is.
            const at = u.s - m.progress;
            return { pts: slice(route.points, route.cum, at, at + LOOK_AHEAD), reversing: true, branch: null };
        }
        const cum = cumulative(m.path);
        const onBypass = slice(m.path, cum, m.progress, m.length);
        const used = m.length - m.progress;
        // The route the vehicle left, past the obstacle: seen beside the bypass, so the turn-off reads as a fork.
        const branch = slice(route.points, route.cum, Math.max(0, ev.sE - 3), Math.min(route.length, ev.sX + LOOK_AHEAD));
        return { pts: [...onBypass, ...slice(route.points, route.cum, ev.sX, ev.sX + Math.max(4, LOOK_AHEAD - used)).slice(1)], reversing: false, branch };
    }
    return { pts: slice(route.points, route.cum, u.s, u.s + LOOK_AHEAD), reversing: false, branch: null };
}
/** Which side of the track a bypass leaves on, as seen from the vehicle: +1 right, -1 left. */
function bypassSide(network, ev) {
    const route = network.routes[ev.robotId];
    const p = pointAt(route.points, route.cum, ev.sE);
    const b = network.bypasses.find((x) => x.id === ev.bypassId);
    const mid = b.points[Math.floor(b.points.length / 2)];
    const fx = Math.cos(p.heading);
    const fy = Math.sin(p.heading);
    const l = -(mid.x - p.x) * fy + (mid.y - p.y) * fx;
    return l >= 0 ? 1 : -1;
}
/** The cab: roof lining, A-pillars, windscreen rubber, dashboard with instruments, a multi-function display and the wheel (viewBox 580 x 400; the window opening is see-through). */
export function cockpitSvg() {
    const hole = "M70 34 L510 34 Q 532 34 536 56 L 552 246 Q 554 262 538 262 L 42 262 Q 26 262 28 246 L 44 56 Q 48 34 70 34 Z";
    const ticks = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => {
        const a = (-220 + (260 * i) / (n - 1)) * (Math.PI / 180);
        const r0 = r - (i % 2 ? 3 : 5);
        return `M${(cx + Math.cos(a) * r0).toFixed(1)} ${(cy + Math.sin(a) * r0).toFixed(1)} L${(cx + Math.cos(a) * (r - 1)).toFixed(1)} ${(cy + Math.sin(a) * (r - 1)).toFixed(1)}`;
    }).join(" ");
    // The view is cropped at the top of the wheel, so most of the cab's height is windscreen.
    return `<svg class="cockpit" viewBox="0 0 580 330" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="ck-roof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151513"/><stop offset="0.12" stop-color="#2a2925"/><stop offset="1" stop-color="#1e1d1a"/></linearGradient>
      <linearGradient id="ck-pillar-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#121210"/><stop offset="0.7" stop-color="#2f2e29"/><stop offset="1" stop-color="#3b3a34"/></linearGradient>
      <linearGradient id="ck-pillar-r" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#121210"/><stop offset="0.7" stop-color="#2f2e29"/><stop offset="1" stop-color="#3b3a34"/></linearGradient>
      <linearGradient id="ck-dash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#55534a"/><stop offset="0.1" stop-color="#3e3d36"/><stop offset="0.45" stop-color="#2b2a25"/><stop offset="1" stop-color="#181816"/></linearGradient>
      <linearGradient id="ck-glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/></linearGradient>
      <radialGradient id="ck-gauge" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#232420"/><stop offset="1" stop-color="#0c0c0b"/></radialGradient>
    </defs>
    <path d="${hole}" fill="url(#ck-glare)"/>
    <path fill-rule="evenodd" fill="url(#ck-roof)" d="M0 0 H580 V330 H0 Z ${hole}"/>
    <path d="M0 0 L 44 56 L 28 246 L 0 262 Z" fill="url(#ck-pillar-l)"/>
    <path d="M580 0 L 536 56 L 552 246 L 580 262 Z" fill="url(#ck-pillar-r)"/>
    <path d="${hole}" fill="none" stroke="#0e0e0d" stroke-width="9"/>
    <path d="${hole}" fill="none" stroke="#4a4840" stroke-width="1.6" opacity="0.7"/>
    <path d="M0 262 L 580 262 L 580 330 L 0 330 Z" fill="url(#ck-dash)"/>
    <path d="M0 268 Q 290 252 580 268" fill="none" stroke="#6a675b" stroke-width="2.4" opacity="0.8"/>
    <path d="M0 274 Q 290 259 580 274" fill="none" stroke="#11110f" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.6"/>
    <path d="M150 259 Q 230 250 334 247" fill="none" stroke="#0d0d0c" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M334 247 l 9 5" stroke="#0d0d0c" stroke-width="5" stroke-linecap="round"/>
    <path d="M86 282 Q 165 272 248 282 L 250 334 L 84 334 Z" fill="#1a1a17" stroke="#3c3b35" stroke-width="2"/>
    <g>
      <circle cx="132" cy="306" r="19" fill="url(#ck-gauge)" stroke="#55534a" stroke-width="2"/>
      <path d="${ticks(132, 306, 17, 11)}" stroke="#d9d4c2" stroke-width="1.1"/>
      <path data-role="needle" d="M132 306 L 120 294" stroke="#e8823a" stroke-width="2" stroke-linecap="round"/>
      <circle cx="132" cy="306" r="2.4" fill="#55534a"/>
      <circle cx="196" cy="308" r="15" fill="url(#ck-gauge)" stroke="#55534a" stroke-width="2"/>
      <path d="${ticks(196, 308, 13, 9)}" stroke="#d9d4c2" stroke-width="1"/>
      <path d="M196 308 L 204 300" stroke="#e8823a" stroke-width="1.6" stroke-linecap="round"/>
    </g>
    <rect x="376" y="281" width="142" height="46" rx="4" fill="#0b0d0c" stroke="#4a4840" stroke-width="2"/>
    <rect x="381" y="285" width="132" height="38" rx="2" fill="#0f1a14"/>
    <g font-family="IBM Plex Mono, monospace" fill="#7fe0a0">
      <text data-role="mfd-mode" x="387" y="296" font-size="8.5"></text>
      <text data-role="mfd-speed" x="387" y="309" font-size="10" font-weight="600"></text>
      <text data-role="mfd-hdg" x="456" y="309" font-size="8.5"></text>
      <text data-role="mfd-time" x="387" y="320" font-size="7.5" fill="#5fae7c"></text>
    </g>
    <circle data-role="mfd-rec" cx="506" cy="292" r="2.6" fill="#e04a3a"/>
    <path d="M30 372 Q 168 270 306 372" fill="none" stroke="#0e0e0c" stroke-width="26" stroke-linecap="round"/>
    <path d="M34 372 Q 168 276 302 372" fill="none" stroke="#38362f" stroke-width="2.2"/>
  </svg>`;
}
/** Simple solids for obstacles seen from the side while driving round them (map units; the track is 0.5 wide). */
const OBSTACLE_SOLIDS = {
    fallen_tree: { halfWidth: 0.52, depth: 0.1, height: 0.1, topScale: 1, color: "#7d5c3d", dark: "#5a412a", light: "#a07a52", crown: true },
    rubble_pile: { halfWidth: 0.36, depth: 0.32, height: 0.3, topScale: 0.35, color: "#8d8575", dark: "#6c665a", light: "#a8a08e" },
    abandoned_vehicle: { halfWidth: 0.4, depth: 0.2, height: 0.22, topScale: 0.95, color: "#6f7a6a", dark: "#545d50", light: "#86917f" },
    small_debris: { halfWidth: 0.3, depth: 0.3, height: 0, topScale: 1, color: "#6b6152", dark: "", light: "" },
    shallow_water: { halfWidth: 0.42, depth: 0.35, height: 0, topScale: 1, color: "#8fb7c6", dark: "", light: "" },
    light_brush: { halfWidth: 0.4, depth: 0.4, height: 0, topScale: 1, color: "#6d8746", dark: "", light: "" },
    flooded_dip: { halfWidth: 0.5, depth: 0.45, height: 0, topScale: 1, color: "#9a7650", dark: "", light: "" },
    gravel_ford: { halfWidth: 0.6, depth: 0.3, height: 0, topScale: 1, color: "#8ab8c8", dark: "", light: "" },
    low_berm: { halfWidth: 0.6, depth: 0.2, height: 0.04, topScale: 0.6, color: "#87a066", dark: "#6f8a52", light: "#9cb47a" },
    fallen_sapling: { halfWidth: 0.52, depth: 0.05, height: 0.01, topScale: 1, color: "#8a6c4c", dark: "#6a5038", light: "#a08060" },
    tall_reeds: { halfWidth: 0.6, depth: 0.5, height: 0.25, topScale: 1, color: "#a59d58", dark: "#8d8a4a", light: "#b8ae68" },
    smoke_drift: { halfWidth: 0.7, depth: 0.6, height: 0.4, topScale: 0.8, color: "#a7a6a0", dark: "#8a8984", light: "#c4c3be" }
};
export class CameraFeed2D {
    el;
    robotId;
    label;
    network;
    geometry;
    reducedMotion;
    onWaypoint;
    scene;
    tc;
    feed;
    wp;
    placard;
    sceneId = "";
    /** "live" (drawn from the path ahead) or the id of the still being shown. */
    shown = "";
    phase = 0;
    speed = 0;
    last = null;
    cutTimer = 0;
    wpKey = "";
    mfd;
    banner;
    mfdText = "";
    /** Terrain of the live view: that of the latest scene, so it matches the stills around it. */
    terrain = null;
    constructor(el, robotId, label, network, geometry, reducedMotion, 
    /** A waypoint was clicked (the take-over). */
    onWaypoint) {
        this.el = el;
        this.robotId = robotId;
        this.label = label;
        this.network = network;
        this.geometry = geometry;
        this.reducedMotion = reducedMotion;
        this.onWaypoint = onWaypoint;
        el.innerHTML = `<div class="window">
        <div class="feed"><div class="scene"></div><svg class="wp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice"></svg></div>
        <div class="grain" aria-hidden="true"></div>
        <div class="alert-banner" role="status" hidden></div>
        <div class="take-hint" data-role="hint"></div>
      </div>
      ${cockpitSvg()}
      <div class="placard" aria-hidden="true"></div>`;
        this.feed = el.querySelector(".feed");
        this.scene = el.querySelector(".scene");
        this.tc = el.querySelector("[data-role=mfd-time]");
        this.wp = el.querySelector(".wp");
        this.placard = el.querySelector(".placard");
        this.banner = el.querySelector(".alert-banner");
        this.mfd = {
            mode: el.querySelector("[data-role=mfd-mode]"),
            speed: el.querySelector("[data-role=mfd-speed]"),
            hdg: el.querySelector("[data-role=mfd-hdg]"),
            needle: el.querySelector("[data-role=needle]")
        };
        const gr = el.querySelector(".grain");
        if (!reducedMotion)
            gr.style.backgroundImage = `url(${grain()})`;
        el.classList.toggle("reduced", reducedMotion);
        this.wp.addEventListener("click", (e) => {
            if (e.target.closest("[data-waypoint]")) {
                e.stopPropagation();
                this.onWaypoint();
            }
        });
    }
    /**
     * frameSimSeconds: simulation seconds this animation frame stands for (0 while paused). The
     * simulation moves in 0.1 s ticks; the view moves smoothly between them. waypoints: the
     * bypass whose waypoints to draw (a take-over is possible), or null.
     */
    update(u, simTime, frameSimSeconds, waypoints, placard, alert = null) {
        if (this.banner.hidden !== !alert)
            this.banner.hidden = !alert;
        if (alert && this.banner.textContent !== alert)
            this.banner.textContent = alert;
        if (!this.last)
            this.last = { x: u.x, y: u.y, t: simTime };
        else if (simTime > this.last.t + 1e-9) {
            this.speed = Math.hypot(u.x - this.last.x, u.y - this.last.y) / (simTime - this.last.t);
            this.last = { x: u.x, y: u.y, t: simTime };
        }
        const moving = this.speed > 0.05;
        if (u.cameraSceneId !== this.sceneId) {
            this.sceneId = u.cameraSceneId;
            const t = u.cameraSceneId === "bypass_track" ? null : sceneTerrain(u.cameraSceneId);
            if (t)
                this.terrain = t;
            this.el.setAttribute("aria-label", `${this.label}. ${sceneLabel(u.cameraSceneId)}`);
            // Plain track and bypass: the live view. Obstacles, section lines and the objective: their still.
            this.cut(/^track_|^bypass_track$/.test(u.cameraSceneId) ? "live" : u.cameraSceneId);
        }
        // Closing in on an obstacle, driving through it, or stuck on it: all from the simulation's position.
        let transform = "";
        const ev = u.atEventId ? this.network.events.find((e) => e.id === u.atEventId) ?? null : null;
        if (this.shown !== "live" && ev && u.cameraEventId === ev.id && !this.reducedMotion) {
            const D = this.geometry.detectionDistance;
            let zoom;
            if (!u.reachedObstacle)
                zoom = 1 + (ZOOM_AT_OBSTACLE - 1) * Math.min(1, Math.max(0, 1 - (ev.sE - u.s) / D));
            else
                zoom = ZOOM_AT_OBSTACLE + (ZOOM_PASSED - ZOOM_AT_OBSTACLE) * Math.min(1, Math.max(0, (u.s - ev.sE) / this.geometry.passDistance));
            transform = `scale(${zoom.toFixed(3)})`;
            if (u.state === "holding" && u.holdReason === "immobilised")
                transform += " rotate(-3.5deg) translateY(6px)";
        }
        const { pts, reversing, branch } = cameraPath(u, this.network);
        if (!this.reducedMotion)
            this.phase += (reversing ? -1 : 1) * this.speed * frameSimSeconds;
        // On the way round, the obstacle itself stays in the live view, beside the vehicle as it passes.
        const passing = u.manual ? this.network.events.find((e) => e.id === u.manual.eventId) ?? null : null;
        if (this.shown === "live")
            this.scene.innerHTML = this.liveSvg(pts, this.terrain ?? SECTION_TERRAIN[u.section] ?? "open", branch, passing);
        this.scene.style.transform = transform;
        this.wp.style.transform = transform;
        const bob = moving && !this.reducedMotion ? Math.sin(this.phase * 5) * 0.8 : 0;
        this.feed.style.transform = bob ? `translateY(${bob.toFixed(2)}px)` : "";
        this.tc.textContent = `CAM FWD  ${fmtTc(simTime)}`;
        if (this.placard.textContent !== placard) {
            this.placard.textContent = placard;
            this.placard.dataset.mode = placard;
        }
        // Dash readouts: speed (1 map unit/s shown as 14 km/h), compass heading (map y points south).
        const kmh = Math.round(this.speed * 14);
        const hdg = Math.round((((u.heading * 180) / Math.PI + 90) % 360 + 360) % 360);
        const text = `${placard}|${kmh}|${hdg}`;
        if (text !== this.mfdText) {
            this.mfdText = text;
            this.mfd.mode.textContent = u.state === "holding" && u.holdReason === "operator" ? "MODE  OPR STOP" : u.manual ? "MODE  OPERATOR WPT" : u.state === "help_requested" ? "MODE  HALTED" : u.state === "holding" ? "MODE  HOLD" : "MODE  AUTO NAV";
            this.mfd.speed.textContent = `${String(kmh).padStart(2, " ")} km/h`;
            this.mfd.hdg.textContent = `HDG ${String(hdg).padStart(3, "0")}`;
            const a = (-220 + Math.min(1, kmh / 30) * 260) * (Math.PI / 180);
            this.mfd.needle.setAttribute("d", `M132 306 L ${(132 + Math.cos(a) * 14).toFixed(1)} ${(306 + Math.sin(a) * 14).toFixed(1)}`);
        }
        this.drawWaypoints(waypoints);
    }
    drawWaypoints(bypassId) {
        const key = bypassId ? `${bypassId}|${this.sceneId}` : "";
        if (key === this.wpKey)
            return;
        this.wpKey = key;
        this.el.classList.toggle("can-take-over", !!bypassId);
        if (!bypassId) {
            this.wp.innerHTML = "";
            return;
        }
        const b = this.network.bypasses.find((x) => x.id === bypassId);
        const ev = this.network.events.find((e) => e.id === b.eventId);
        const { path, pins } = waypointGeometry(this.sceneId, bypassSide(this.network, ev));
        // Depth scale: things nearer the camera (lower in the image) are drawn larger.
        const k = (y) => 0.35 + 0.75 * Math.max(0, Math.min(1, (y - VP.y) / (H - VP.y)));
        // A translucent ribbon on the ground along the way round, narrowing with distance.
        const left = [];
        const right = [];
        path.forEach((p, i) => {
            const a = path[Math.max(0, i - 1)];
            const c = path[Math.min(path.length - 1, i + 1)];
            const dx = c.x - a.x;
            const dy = c.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const w = 9 * k(p.y);
            left.push(`${f1(p.x - (dy / len) * w)},${f1(p.y + (dx / len) * w * 0.45)}`);
            right.push(`${f1(p.x + (dy / len) * w)},${f1(p.y - (dx / len) * w * 0.45)}`);
        });
        // The last leg runs behind the obstacle, so it is drawn fainter.
        const near = path.slice(0, -1);
        const line = near.map((p, i) => `${i ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`).join(" ");
        const far = `M${f1(path.at(-2).x)} ${f1(path.at(-2).y)} L${f1(path.at(-1).x)} ${f1(path.at(-1).y)}`;
        const pin = (p, i) => {
            const s = k(p.y);
            const h = 15 * s;
            return `<g class="wp-pt" data-waypoint="${i + 1}" role="button" tabindex="0" aria-label="Waypoint ${i + 1}: take over and send ${this.label} around">
        <ellipse cx="${f1(p.x)}" cy="${f1(p.y)}" rx="${f1(7 * s)}" ry="${f1(2.2 * s)}" class="wp-shadow"/>
        <path d="M${f1(p.x)} ${f1(p.y)} V ${f1(p.y - h)}" class="wp-stem" stroke-width="${f1(1.4 * s + 0.4)}"/>
        <circle class="hit" cx="${f1(p.x)}" cy="${f1(p.y - h)}" r="${f1(Math.max(11, 15 * s))}"/>
        <g transform="translate(${f1(p.x)} ${f1(p.y - h)}) scale(${s.toFixed(3)})"><circle class="wp-head" r="8.5"/><text y="3.5">${i + 1}</text></g>
      </g>`;
        };
        this.wp.innerHTML = `<polygon class="wp-ribbon" points="${[...left.slice(0, -1), ...right.slice(0, -1).reverse()].join(" ")}"/><path class="wp-path" d="${line}"/><path class="wp-path far" d="${far}"/>${pins.map(pin).join("")}`;
        for (const g of this.wp.querySelectorAll("[data-waypoint]")) {
            g.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.onWaypoint();
                }
            });
        }
    }
    cut(to) {
        this.shown = to;
        if (to !== "live")
            this.scene.innerHTML = sceneSvg(to).replace('preserveAspectRatio="xMidYMid slice"', 'preserveAspectRatio="xMidYMax slice"');
        this.scene.style.transform = "";
        if (this.reducedMotion)
            return;
        this.el.classList.remove("cut");
        void this.el.offsetWidth; // restart the animation
        this.el.classList.add("cut");
        window.clearTimeout(this.cutTimer);
        this.cutTimer = window.setTimeout(() => this.el.classList.remove("cut"), 260);
    }
    /**
     * The obstacle being driven round, as a simple solid in the same perspective as the live view: a box (or a
     * flat patch for low obstacles) across the route at the obstacle's position, lit from the upper left.
     */
    obstacleSvg(ev, project) {
        const spec = OBSTACLE_SOLIDS[ev.kindId];
        if (!spec)
            return "";
        const route = this.network.routes[ev.robotId];
        const CAM_H = A / FX; // camera height, map units
        const corner = (along, lateral, up) => {
            const p = pointAt(route.points, route.cum, ev.sE + along);
            const q = project({ x: p.x - Math.sin(p.heading) * lateral, y: p.y + Math.cos(p.heading) * lateral });
            return { f: q.f, x: q.x, y: VP.y + (FX * (CAM_H - up)) / q.f };
        };
        const d = spec.depth / 2;
        const w = spec.halfWidth;
        const nearL = corner(-d, -w, 0), nearR = corner(-d, w, 0), farL = corner(d, -w, 0), farR = corner(d, w, 0);
        if ([nearL, nearR, farL, farR].some((c) => c.f <= F_NEAR))
            return "";
        const poly = (cs, fill, extra = "") => `<polygon points="${cs.map((c) => `${f1(c.x)},${f1(c.y)}`).join(" ")}" fill="${fill}"${extra}/>`;
        if (spec.height <= 0)
            return poly([nearL, nearR, farR, farL], spec.color, ' opacity="0.9"');
        const h = spec.height;
        const tNL = corner(-d, -w * spec.topScale, h), tNR = corner(-d, w * spec.topScale, h), tFL = corner(d, -w * spec.topScale, h), tFR = corner(d, w * spec.topScale, h);
        let out = poly([corner(-d - 0.05, -w - 0.05, 0), corner(-d - 0.05, w + 0.05, 0), corner(d + 0.15, w + 0.12, 0), corner(d + 0.15, -w - 0.12, 0)], "#1e1a12", ' opacity="0.28"');
        // The end facing the camera (the vehicle passes on one side), then the front, then the top.
        const camLateral = -((nearL.x + nearR.x) / 2 - VP.x);
        out += camLateral > 0 ? poly([nearL, farL, tFL, tNL], spec.dark) : poly([nearR, farR, tFR, tNR], spec.dark);
        out += poly([nearL, nearR, tNR, tNL], spec.color);
        out += poly([tNL, tNR, tFR, tFL], spec.light);
        if (spec.crown) {
            const c = corner(0, -w - 0.05, h * 1.6);
            const r = Math.max(2, (FX * 0.16) / Math.max(F_NEAR, c.f));
            out += `<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="${f1(r)}" fill="#56743d"/><circle cx="${f1(c.x - r * 0.3)}" cy="${f1(c.y - r * 0.35)}" r="${f1(r * 0.6)}" fill="#6d8c4a"/>`;
        }
        return out;
    }
    /** The live view: sky, a horizon panorama panned to the camera's heading, and the path ahead in perspective. */
    liveSvg(pts, kind, branch = null, obstacle = null) {
        const cum = cumulative(pts);
        const total = cum[cum.length - 1] ?? 0;
        const p0 = pts[0];
        // Camera heading: along the path just ahead (smooth through bends; also right while backing up).
        const look = pointAt(pts, cum, Math.min(total, 0.6));
        const th = total > 0.05 ? Math.atan2(look.y - p0.y, look.x - p0.x) : 0;
        const fx = Math.cos(th);
        const fy = Math.sin(th);
        const project = (q) => {
            const dx = q.x - p0.x;
            const dy = q.y - p0.y;
            const f = dx * fx + dy * fy;
            const l = -dx * fy + dy * fx; // to the right of the heading (map y points down)
            return { f, x: VP.x + (FX * l) / f, y: VP.y + A / f };
        };
        /** Point at arc a along a path, offset sideways by `side` map units (to the right). */
        const onPath = (path, pcum, a, side) => {
            const p = pointAt(path, pcum, a);
            return project({ x: p.x - Math.sin(p.heading) * side, y: p.y + Math.cos(p.heading) * side });
        };
        const at = (a, side) => onPath(pts, cum, a, side);
        // Horizon: two copies of the panorama so it always covers the frame.
        const pan = ((((VP.x - FX * th) % PANO) + PANO) % PANO) - PANO;
        let out = `${SCENE_DEFS}<rect width="${W}" height="${HORIZON + 1}" fill="url(#rc-sky)"/><g transform="translate(${f1(pan)} 0)">${panorama(kind)}<g transform="translate(${PANO} 0)">${panorama(kind)}</g></g>`;
        out += `<rect y="${HORIZON - 5}" width="${W}" height="6" fill="#e3e6dc" opacity="0.35"/><rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#rc-gnd-${kind})"/>`;
        // The track: a strip between two offsets from the centreline, sampled densely near the camera.
        const arcsFor = (len) => {
            const xs = [];
            for (let a = 0; a <= Math.min(len, 5); a += 0.15)
                xs.push(a);
            for (let a = 5.5; a <= len; a += 0.75)
                xs.push(a);
            return xs;
        };
        const arcs = arcsFor(total);
        const strip = (from, to, fill, opacity = 1, path = pts, pcum = cum, parcs = arcs) => {
            const left = [];
            const right = [];
            let started = false;
            for (const a of parcs) {
                const L = onPath(path, pcum, a, from * HW);
                const R = onPath(path, pcum, a, to * HW);
                const ok = L.f > F_NEAR && R.f > F_NEAR;
                if (!ok) {
                    if (started)
                        break; // the path turns back behind the camera
                    continue;
                }
                started = true;
                left.push(`${f1(Math.max(-3000, Math.min(3000, L.x)))},${f1(L.y)}`);
                right.push(`${f1(Math.max(-3000, Math.min(3000, R.x)))},${f1(R.y)}`);
            }
            if (left.length < 2)
                return "";
            return `<polygon points="${[...left, ...right.reverse()].join(" ")}" fill="${fill}"${opacity < 1 ? ` opacity="${opacity}"` : ""}/>`;
        };
        if (branch) {
            // Going round an obstacle: the vehicle is off the track, on the grass beside it. The track (its route)
            // runs alongside and the way round rejoins it ahead; the vehicle's own path is only flattened grass.
            const bcum = cumulative(branch);
            const barcs = arcsFor(bcum[bcum.length - 1] ?? 0);
            out += strip(-1.35, 1.35, "#8f8a5c", 0.45, branch, bcum, barcs);
            out += strip(-1, 1, "url(#rc-trk)", 1, branch, bcum, barcs);
            out += strip(-0.68, -0.32, "#7a6246", 0.75, branch, bcum, barcs);
            out += strip(0.32, 0.68, "#7a6246", 0.75, branch, bcum, barcs);
            out += strip(-0.1, 0.1, "#8b9a63", 0.8, branch, bcum, barcs);
            out += strip(-0.75, 0.75, "#9fa67a", 0.35);
            out += strip(-0.62, -0.38, "#7d7a52", 0.35);
            out += strip(0.38, 0.62, "#7d7a52", 0.35);
        }
        else {
            out += strip(-1.35, 1.35, "#8f8a5c", 0.45);
            out += strip(-1, 1, "url(#rc-trk)");
            out += strip(-0.68, -0.32, "#7a6246", 0.75);
            out += strip(0.32, 0.68, "#7a6246", 0.75);
            out += strip(-0.1, 0.1, "#8b9a63", 0.8);
        }
        if (obstacle)
            out += this.obstacleSvg(obstacle, project);
        // Marks streaming along the path at the vehicle's speed.
        if (!this.reducedMotion) {
            for (const m of MARKS) {
                const a = F_NEAR + ((((m.offset * MARK_SPAN - this.phase) % MARK_SPAN) + MARK_SPAN) % MARK_SPAN);
                if (a > total)
                    continue;
                const q = at(a, m.lane * HW);
                if (q.f <= F_NEAR || q.y > H + 8 || q.x < -20 || q.x > W + 20)
                    continue;
                const s = 1 / q.f;
                if (m.kind === "rut")
                    out += `<rect x="${f1(q.x - FX * 0.07 * s)}" y="${f1(q.y)}" width="${f1(FX * 0.14 * s + 0.6)}" height="${f1(Math.max(0.6, A * 0.05 * s * s))}" rx="1" fill="#5a4630" opacity="0.55"/>`;
                else if (m.kind === "tuft") {
                    const h = FX * 0.05 * s + 0.6;
                    const w = FX * 0.05 * s + 0.6;
                    out += `<path d="M${f1(q.x - w)} ${f1(q.y)} l${f1(w * 0.4)} -${f1(h)} l${f1(w * 0.3)} ${f1(h * 0.85)} l${f1(w * 0.4)} -${f1(h * 0.8)} l${f1(w * 0.3)} ${f1(h * 0.8)} l${f1(w * 0.6)} ${f1(h * 0.15)}Z" fill="#557038" opacity="0.9"/>`;
                }
                else
                    out += `<ellipse cx="${f1(q.x)}" cy="${f1(q.y)}" rx="${f1(FX * 0.035 * s + 0.5)}" ry="${f1(FX * 0.016 * s + 0.4)}" fill="#6f6a5a" opacity="0.7"/>`;
            }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${out}</svg>`;
    }
}
