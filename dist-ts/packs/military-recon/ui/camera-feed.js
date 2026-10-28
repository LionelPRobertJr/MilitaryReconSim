import { CameraFeed2D, cameraPath, cockpitSvg, fmtTc, grain } from "./camera-feed-2d.js";
import { sceneLabel } from "./scenes.js";
import { World3D } from "./three/world.js";
/**
 * The 3D view where WebGL works, else the drawn one. If the browser drops the 3D view's graphics context
 * mid-session (low memory, a GPU reset), that panel switches to the drawn view at once, so the participant
 * never faces a blank windscreen.
 */
export function createCameraFeed(el, robotId, label, network, geometry, reducedMotion, onWaypoint) {
    const drawn = () => new CameraFeed2D(el, robotId, label, network, geometry, reducedMotion, onWaypoint);
    if (new URLSearchParams(location.search).get("view") === "2d")
        return withDispose(drawn());
    let current;
    try {
        const feed = new CameraFeed(el, robotId, label, network, reducedMotion, onWaypoint);
        current = feed;
        feed.onContextLost = () => {
            console.warn(`${label}: 3D view lost its graphics context; using the drawn view`);
            feed.dispose();
            current = withDispose(drawn());
            el.classList.remove("three");
        };
    }
    catch (err) {
        console.warn("3D view unavailable, using the drawn view", err);
        current = withDispose(drawn());
    }
    return {
        update: (...a) => current.update(...a),
        dispose: () => current.dispose()
    };
}
function withDispose(f) {
    if (typeof f.dispose !== "function")
        f.dispose = () => { };
    return f;
}
export class CameraFeed {
    el;
    label;
    network;
    reducedMotion;
    onWaypoint;
    world3d;
    pins;
    placard;
    banner;
    tc;
    mfd;
    mfdText = "";
    sceneId = "";
    phase = 0;
    speed = 0;
    last = null;
    wpBypass = null;
    lastKey = "";
    constructor(el, robotId, label, network, reducedMotion, onWaypoint) {
        this.el = el;
        this.label = label;
        this.network = network;
        this.reducedMotion = reducedMotion;
        this.onWaypoint = onWaypoint;
        el.innerHTML = `<div class="window">
        <canvas class="view3d" aria-hidden="true"></canvas>
        <div class="grain" aria-hidden="true"></div>
        <div class="pins"></div>
        <div class="alert-banner" role="status" hidden></div>
        <div class="take-hint" data-role="hint"></div>
      </div>
      ${cockpitSvg()}
      <div class="placard" aria-hidden="true"></div>`;
        const canvas = el.querySelector("canvas");
        try {
            this.world3d = new World3D(canvas, network, robotId);
        }
        catch (err) {
            el.innerHTML = "";
            throw err;
        }
        el.classList.add("three");
        canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            if (this.disposed)
                return;
            // Switch on the next frame, outside the renderer's own handler.
            window.setTimeout(() => this.onContextLost?.(), 0);
        });
        // Test seam: draw-call and triangle counts of the live views.
        const g = window;
        (g.__views3d ??= []).push(this.world3d);
        (window.__feeds3d ??= []).push(this);
        this.pins = el.querySelector(".pins");
        this.placard = el.querySelector(".placard");
        this.banner = el.querySelector(".alert-banner");
        this.tc = el.querySelector("[data-role=mfd-time]");
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
        this.pins.addEventListener("click", (e) => {
            if (e.target.closest("[data-waypoint]")) {
                e.stopPropagation();
                this.onWaypoint();
            }
        });
        this.pins.addEventListener("keydown", (e) => {
            if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-waypoint]")) {
                e.preventDefault();
                this.onWaypoint();
            }
        });
    }
    update(u, simTime, frameSimSeconds, waypoints, placard, alert = null, world) {
        if (this.disposed)
            return;
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
        if (u.cameraSceneId !== this.sceneId) {
            this.sceneId = u.cameraSceneId;
            this.el.setAttribute("aria-label", `${this.label}. ${sceneLabel(u.cameraSceneId)}`);
        }
        const moving = this.speed > 0.05;
        const { pts, reversing } = cameraPath(u, this.network);
        if (!this.reducedMotion)
            this.phase += (reversing ? -1 : 1) * this.speed * frameSimSeconds;
        const bob = moving && !this.reducedMotion ? Math.sin(this.phase * 6) * 0.025 + Math.sin(this.phase * 2.3) * 0.015 : 0;
        const stuck = u.state === "holding" && u.holdReason === "immobilised";
        // Render only when something visible changed (both views stay still while the mission is paused).
        const statusKey = world ? Object.values(world.eventStatus).join("") : "";
        const w = this.el.clientWidth;
        const key = `${u.x.toFixed(4)}|${u.y.toFixed(4)}|${bob.toFixed(4)}|${waypoints}|${stuck}|${statusKey}|${w}|${this.el.clientHeight}`;
        // Test seam (scripts/playtest/driver.mjs): skip drawing while the driver fast-forwards; the next drawn frame
        // then settles at once.
        if (window.__skipRender3d) {
            this.skipped = true;
        }
        else if (key !== this.lastKey || !this.settled || this.skipped) {
            this.lastKey = key;
            // Keep rendering until the smoothed heading has come to rest.
            // While the simulation stands still (paused), the view settles at once rather than turning on screen.
            if (world)
                this.settled = this.world3d.render(u, world, pts, bob, waypoints, stuck, frameSimSeconds === 0 || this.skipped);
            this.skipped = false;
            this.placePins(waypoints);
        }
        this.tc.textContent = `CAM FWD  ${fmtTc(simTime)}`;
        if (this.placard.textContent !== placard) {
            this.placard.textContent = placard;
            this.placard.dataset.mode = placard;
        }
        const kmh = Math.round(this.speed * 14);
        const hdg = Math.round((((u.heading * 180) / Math.PI + 90) % 360 + 360) % 360);
        const text = `${placard}|${kmh}|${hdg}|${u.state}|${u.holdReason}`;
        if (text !== this.mfdText) {
            this.mfdText = text;
            this.mfd.mode.textContent = u.state === "holding" && u.holdReason === "operator" ? "MODE  OPR STOP" : u.manual ? "MODE  OPERATOR WPT" : u.state === "help_requested" ? "MODE  HALTED" : u.state === "holding" ? "MODE  HOLD" : "MODE  AUTO NAV";
            this.mfd.speed.textContent = `${String(kmh).padStart(2, " ")} km/h`;
            this.mfd.hdg.textContent = `HDG ${String(hdg).padStart(3, "0")}`;
            const a = (-220 + Math.min(1, kmh / 30) * 260) * (Math.PI / 180);
            this.mfd.needle.setAttribute("d", `M132 306 L ${(132 + Math.cos(a) * 14).toFixed(1)} ${(306 + Math.sin(a) * 14).toFixed(1)}`);
        }
    }
    settled = false;
    disposed = false;
    /** Set by createCameraFeed: called if the browser drops the WebGL context. */
    onContextLost = null;
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.world3d.renderer.dispose();
        this.world3d.renderer.forceContextLoss?.();
    }
    skipped = false;
    /** The numbered waypoint pins: buttons over the 3D pin heads. */
    placePins(bypassId) {
        if (bypassId !== this.wpBypass) {
            this.wpBypass = bypassId;
            this.el.classList.toggle("can-take-over", !!bypassId);
            this.pins.innerHTML = bypassId
                ? [1, 2, 3].map((i) => `<button type="button" class="wp-pin" data-waypoint="${i}" aria-label="Waypoint ${i}: take over and send ${this.label} around">${i}</button>`).join("")
                : "";
        }
        if (!bypassId)
            return;
        const raw = this.world3d.pinScreen();
        const buttons = [...this.pins.querySelectorAll("[data-waypoint]")];
        // A pin outside the view (close to an obstacle, or once the vehicle is stuck at it, the pins beside it can be
        // off to the side or behind the camera) is held at the edge of the view on its side, so all three stay visible
        // and clickable (agent testing, Oct 28, 2026: pins slid out of view and stayed in the Tab order unseen).
        const canvas = this.world3d.renderer.domElement;
        const W = canvas.clientWidth;
        const H = canvas.clientHeight;
        const M = 20;
        const screen = raw.map((p) => {
            if (p.visible)
                return { ...p, edge: false };
            const x = p.behind ? (p.side < 0 ? M : W - M) : Math.min(W - M, Math.max(M, p.x));
            const y = p.behind ? H * 0.62 : Math.min(H - M, Math.max(M, p.y));
            return { ...p, x, y, dist: Math.max(p.dist, 1), visible: W > 0 && H > 0, edge: true };
        });
        // Far off, the three pins are almost on top of each other: spread them sideways (in their order across the
        // view) so each number stays readable and clickable; close up they sit on their stems.
        const placed = screen.map((p, i) => ({ i, p, size: p ? Math.max(22, Math.min(34, 520 / p.dist)) : 0, x: p?.x ?? 0 }));
        const shown = placed.filter((q) => q.p && q.p.visible).sort((a, b) => a.x - b.x);
        for (let k = 1; k < shown.length; k++) {
            const a = shown[k - 1];
            const b = shown[k];
            const gap = (a.size + b.size) / 2 + 4;
            if (Math.abs(a.p.y - b.p.y) < gap && b.x - a.x < gap) {
                // Pins held at the same side edge are stacked; others are spread sideways.
                if (a.p.edge && b.p.edge && Math.abs(a.x - b.x) < 1)
                    b.p = { ...b.p, y: a.p.y - gap };
                else
                    b.x = a.x + gap;
            }
        }
        if (shown.length > 1 && !shown.some((q) => q.p.edge)) {
            // Re-centre the group on where the pins really are.
            const shift = (shown.reduce((t, q) => t + q.p.x, 0) - shown.reduce((t, q) => t + q.x, 0)) / shown.length;
            for (const q of shown)
                q.x += shift;
        }
        buttons.forEach((b, i) => {
            const q = placed[i];
            if (!q || !q.p || !q.p.visible) {
                b.hidden = true;
                return;
            }
            b.hidden = false;
            b.classList.toggle("wp-edge", !!q.p.edge);
            b.style.width = b.style.height = `${q.size.toFixed(0)}px`;
            b.style.fontSize = `${(q.size * 0.5).toFixed(0)}px`;
            // Far off, the pins are lifted clear above the obstacle so they do not hide it (agent testing, Oct 28,
            // 2026); close up they sit on their stems.
            const lift = q.p.edge ? 0 : q.size * 1.1 * Math.min(1, Math.max(0, (q.p.dist - 15) / 25));
            const x = Math.min(W - q.size / 2, Math.max(q.size / 2, q.x));
            const y = Math.min(H - q.size / 2, Math.max(q.size / 2, q.p.y - lift));
            b.style.transform = `translate(${(x - q.size / 2).toFixed(1)}px, ${(y - q.size / 2).toFixed(1)}px)`;
        });
    }
}
