import { FAULT_FIXES, FAULT_READINGS, faultType } from "../sim/faults.js";
import { createCameraFeed } from "./camera-feed.js";
import { drawSpotImage } from "./spotImage.js";
// The Military Recon operator console, as redesigned by the research team
// (Oct 2026): two vehicle panels side by side, each with its name, a status
// line with one large light, a message box and the forward view through the
// windscreen; the Spot Report below. No map and no alert list. The only
// control is the take-over: clicking a waypoint drawn beside an obstacle in a
// vehicle's view. One ConsoleSession drives one running simulation (tutorial
// or mission); the participant flow (main.ts) creates it, handles probe pauses
// and decides what comes next.
const $ = (id) => document.getElementById(id);
const ROBOTS = ["UGV1", "UGV2"];
const NAME = { UGV1: "UGV #1", UGV2: "UGV #2" };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const LAMP_CLASS = {
    auto_navigation: "s-auto",
    processing: "s-proc",
    help_requested: "s-help",
    operator_control: "s-op",
    holding: "s-hold"
};
const fmt = (s) => {
    const t = Math.max(0, Math.floor(s));
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
export class ConsoleSession {
    sim;
    last = performance.now();
    raf = 0;
    lastSpotId = "\u0000none";
    /** The last image actually shown (not the pause placeholder). */
    lastRealSpotId = null;
    spotNoteUntil = -1;
    cleanups = [];
    lastRender = {};
    /** Take-overs sent but not yet applied by the simulation (command delay), so a second click does nothing. */
    sent = {};
    tutorial;
    onEnd;
    onPause;
    speed;
    onNote;
    feeds = {};
    /** Simulation seconds the current animation frame covers (0 while paused). */
    frameSim = 0;
    pauseHandled = null;
    constructor(opts) {
        this.sim = opts.sim;
        this.tutorial = opts.tutorial;
        this.onEnd = opts.onEnd;
        this.onPause = opts.onPause;
        this.speed = opts.speed;
        this.onNote = opts.onNote ?? (() => { });
        // Nothing carries over from a previous session (e.g. the tutorial).
        $("spot-form").reset();
        $("spot-status").textContent = "";
        this.buildPanels();
        const geometry = { detectionDistance: this.sim.config.detectionDistance, passDistance: this.sim.config.passDistance };
        for (const id of ROBOTS) {
            this.feeds[id] = createCameraFeed($(`panel-${id}`).querySelector("[data-role=cam]"), id, NAME[id], this.sim.network, geometry, reducedMotion, () => this.takeOver(id));
        }
        this.buildSections();
        $("clock-limit").textContent = `of ${fmt(this.sim.config.sessionLengthSeconds)}`;
        $("coach").hidden = !this.tutorial;
        // In the practice the coach's instructions take the quick reference's place (bottom left), so the views keep
        // their full height.
        $("quickref").hidden = this.tutorial;
        this.wire();
        this.watchFocus();
        this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    /**
     * Leaving the window during the mission (pilot feedback, Nov 2, 2026): on return, a message says how long they were
     * away and that the mission kept running. The mission does not pause (it would become a way to stop the clock);
     * focus changes are logged anyway (FocusTracker), and the message's showing is noted.
     */
    watchFocus() {
        let awaySince = null;
        let hideTimer = 0;
        const leave = () => {
            if (awaySince === null && !this.sim.isEnded() && !this.sim.pausedReason())
                awaySince = performance.now();
        };
        const back = () => {
            if (awaySince === null || document.hidden)
                return;
            const secs = (performance.now() - awaySince) / 1000;
            awaySince = null;
            if (secs < 1.5 || this.sim.isEnded())
                return;
            const el = $("focus-warning");
            el.textContent = `You left this window for about ${Math.round(secs)} seconds, and the ${this.tutorial ? "practice" : "mission"} kept running. Please keep this window in front until the ${this.tutorial ? "practice" : "mission"} ends.`;
            el.hidden = false;
            window.clearTimeout(hideTimer);
            hideTimer = window.setTimeout(() => (el.hidden = true), 8000);
            this.onNote("left_window_warning", { seconds: Math.round(secs * 10) / 10, simTime: this.sim.snapshot().simTime });
        };
        const onVis = () => (document.hidden ? leave() : back());
        window.addEventListener("blur", leave);
        window.addEventListener("focus", back);
        document.addEventListener("visibilitychange", onVis);
        this.cleanups.push(() => {
            window.removeEventListener("blur", leave);
            window.removeEventListener("focus", back);
            document.removeEventListener("visibilitychange", onVis);
            window.clearTimeout(hideTimer);
            $("focus-warning").hidden = true;
        });
    }
    dispose() {
        cancelAnimationFrame(this.raf);
        for (const c of this.cleanups)
            c();
        // Free the 3D views' graphics contexts (browsers allow only a few at a time).
        for (const id of ROBOTS)
            this.feeds[id]?.dispose();
    }
    on(el, type, fn) {
        el.addEventListener(type, fn);
        this.cleanups.push(() => el.removeEventListener(type, fn));
    }
    buildSections() {
        $("sections").innerHTML = this.sim.network.sections.length > 1 ? this.sim.network.sections.map((s) => `<span data-section="${s}">Section ${s}</span>`).join("") : "<span class=\"current\">Practice</span>";
    }
    buildPanels() {
        for (const id of ROBOTS) {
            $(`panel-${id}`).innerHTML = `
        <header class="ugv-head">
          <h2 class="ugv-name">${NAME[id]}</h2>
          <i class="lamp big" data-role="lamp" role="img"></i>
          <span class="ugv-status" data-role="status"></span>
          <div class="controls">
            <button type="button" class="ctl diag" data-role="diagnose" hidden><i aria-hidden="true"></i>Diagnose</button>
            <button type="button" class="ctl stop" data-ctl="hold"><i aria-hidden="true"></i>Stop</button>
            <button type="button" class="ctl go" data-ctl="resume"><i aria-hidden="true"></i>Continue</button>
          </div>
        </header>
        <div class="cab-wrap"><div class="cab" data-role="cam"></div><p class="message" data-role="msg" aria-live="polite"></p>
          <section class="fault-panel" data-role="fault-panel" role="dialog" aria-label="${NAME[id]} fault report" hidden></section></div>`;
        }
    }
    wire() {
        for (const id of ROBOTS) {
            const cam = $(`panel-${id}`).querySelector("[data-role=cam]");
            // A click on the view itself (not a waypoint) counts as looking at it (detection proxy).
            this.on(cam, "click", () => {
                this.sim.logCameraView(id);
                if (this.sim.rerouteTarget(id))
                    this.onNote("waypoint_click_missed", { robotId: id, simTime: this.sim.snapshot().simTime });
            });
            for (const btn of $(`panel-${id}`).querySelectorAll("[data-ctl]")) {
                this.on(btn, "click", () => {
                    if (this.sim.pausedReason() || this.sim.isEnded())
                        return;
                    const action = btn.dataset.ctl;
                    if (!this.sim.availableActions(id)[action])
                        return;
                    this.sim.enqueueCommand({ kind: "ugv_action", robotId: id, action });
                });
            }
        }
        // Optional faults (off in Study 2): Diagnose opens the vehicle's fault report; its buttons send the fix.
        for (const id of ROBOTS) {
            const panel = $(`panel-${id}`);
            this.on(panel.querySelector("[data-role=diagnose]"), "click", () => this.toggleFaultPanel(id));
            this.on(panel.querySelector("[data-role=fault-panel]"), "click", (e) => {
                const b = e.target.closest("[data-fix]");
                if (b)
                    this.applyFix(id, b.dataset.fix);
                else if (e.target.closest("[data-close]"))
                    this.closeFaultPanel(id);
            });
        }
        const form = $("spot-form");
        this.on(form, "submit", (e) => {
            e.preventDefault();
            const w = this.sim.snapshot();
            const img = w.spotReport.active;
            if (!img)
                return;
            const vehicles = Number($("spot-vehicles").value);
            const people = Number($("spot-people").value);
            this.sim.enqueueCommand({ kind: "spot_report_submit", imageId: img.id, vehicles, people });
            form.reset();
        });
    }
    faultPanelOpen = {};
    toggleFaultPanel(id) {
        if (this.faultPanelOpen[id])
            return this.closeFaultPanel(id);
        if (this.sim.pausedReason() || this.sim.isEnded())
            return;
        const f = this.sim.snapshot().ugvs[id].fault;
        if (!f)
            return;
        this.faultPanelOpen[id] = f.id;
        this.sim.enqueueCommand({ kind: "fault_action", robotId: id, action: "inspect" });
        const t = faultType(f.typeId);
        const readings = FAULT_READINGS.map((r) => `<tr><th scope="row">${r.label}</th><td>${r.key === t.reading ? t.abnormal : r.normal}</td></tr>`).join("");
        const fixes = FAULT_FIXES.map((x) => `<button type="button" data-fix="${x.id}">${x.label}<span>${x.seconds} s</span></button>`).join("");
        const panel = $(`panel-${id}`).querySelector("[data-role=fault-panel]");
        panel.innerHTML = `<header><h3>Fault report: ${NAME[id]}</h3><button type="button" class="fp-close" data-close aria-label="Close the fault report">×</button></header>
      <p class="fp-lead">One reading is outside its normal range. Pick the fix that matches it, or Reboot.</p>
      <table class="fp-readings">${readings}</table>
      <div class="fp-fixes">${fixes}<button type="button" data-fix="reboot" class="fp-reboot">Reboot (always works)<span>${this.sim.config.faults.rebootSeconds} s</span></button></div>
      <p class="fp-note">A wrong fix takes its time, does not help, and costs ${this.sim.config.faults.wrongFixPenalty} points.</p>`;
        panel.hidden = false;
        panel.querySelector("[data-fix]")?.focus({ preventScroll: true });
    }
    closeFaultPanel(id) {
        this.faultPanelOpen[id] = null;
        const panel = $(`panel-${id}`).querySelector("[data-role=fault-panel]");
        panel.hidden = true;
        panel.innerHTML = "";
    }
    applyFix(id, action) {
        if (this.sim.pausedReason() || this.sim.isEnded())
            return;
        if (this.sim.faultRejectReason(id, action) !== null)
            return;
        this.sim.enqueueCommand({ kind: "fault_action", robotId: id, action });
        this.closeFaultPanel(id);
    }
    /** A waypoint was clicked: send the vehicle around the obstacle in view. */
    takeOver(id) {
        if (this.sim.pausedReason() || this.sim.isEnded())
            return;
        const target = this.sim.rerouteTarget(id);
        if (!target || this.sent[id] === target)
            return;
        this.sent[id] = target;
        this.sim.enqueueCommand({ kind: "ugv_action", robotId: id, action: "reroute", bypassId: target });
    }
    frame(now) {
        // Cap the step so a backgrounded tab or a long frame never makes the clock jump.
        let dt = Math.min(0.25 * this.speed, ((now - this.last) / 1000) * this.speed);
        this.last = now;
        // Test seam (scripts/playtest/driver.mjs): mission time passes only as the driver grants it, so a tester
        // can think between commands; the 3D views skip drawing until the granted time has run.
        const pt = window.__playtestClock;
        if (pt) {
            dt = Math.min(0.25, pt.bank);
            pt.bank = Math.max(0, pt.bank - dt);
            window.__skipRender3d = pt.bank > 1e-9;
        }
        // The "window too small" notice covers the console; mission time does not run behind it (agent testing,
        // Oct 28, 2026: at 1024 x 700 the mission ran on with the notice hidden behind the camera views).
        if (document.getElementById("too-small")?.hidden === false)
            dt = 0;
        if (!this.sim.pausedReason())
            this.sim.advanceRealTime(dt);
        this.frameSim = this.sim.pausedReason() || this.sim.isEnded() ? 0 : dt;
        const w = this.sim.snapshot();
        this.renderTop(w);
        for (const id of ROBOTS) {
            try {
                this.renderPanel(w.ugvs[id], w);
            }
            catch (err) {
                // A display fault must never stop the mission clock or the logging.
                console.error(err);
            }
        }
        this.renderSpot(w);
        if (this.tutorial)
            this.renderCoach(w);
        const paused = this.sim.pausedReason();
        if (paused && this.pauseHandled !== paused) {
            this.pauseHandled = paused;
            void this.onPause(paused).then(() => {
                this.sim.resume();
                this.last = performance.now();
            });
        }
        else if (!paused)
            this.pauseHandled = null;
        if (this.sim.isEnded()) {
            this.dispose();
            this.onEnd(this.sim);
            return;
        }
        this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    setHtml(key, el, html) {
        if (this.lastRender[key] === html)
            return;
        this.lastRender[key] = html;
        el.innerHTML = html;
    }
    renderTop(w) {
        $("clock").textContent = fmt(w.simTime);
        $("score").textContent = String(w.score);
        const idx = this.sim.network.sections.indexOf(w.section);
        for (const el of $("sections").querySelectorAll("[data-section]")) {
            const i = this.sim.network.sections.indexOf(el.dataset.section);
            el.className = i < idx || (i === idx && w.missionComplete) ? "done" : i === idx ? "current" : "";
        }
    }
    /** Status line, message and dashboard placard for a vehicle. */
    describe(u, w) {
        const other = ROBOTS.find((r) => r !== u.id);
        const stopPenalty = this.sim.config.scoring.stopPenalty;
        if (u.state === "holding" && u.holdReason === "fault" && u.fault) {
            const r = u.fault.repair;
            if (r) {
                const what = r.action === "reboot" ? "Rebooting" : FAULT_FIXES.find((x) => x.id === r.action).label;
                return { status: "Repairing", message: `${what}: ${Math.max(0, Math.ceil(r.remaining))}\u00a0s left.`, placard: "REPAIR IN PROGRESS" };
            }
            const tried = this.sim.logger.all().some((e) => e.type === "fault_repair_end" && e.robotId === u.id && e.faultId === u.fault.id && !e.cleared);
            return {
                status: "Fault",
                message: tried ? "That fix did not clear the fault. Click Diagnose and try again, or Reboot." : "It has reported a fault and stopped. Click Diagnose to read its sensors and fix it.",
                placard: "VEHICLE FAULT"
            };
        }
        switch (u.state) {
            case "auto_navigation":
                return { status: "OK", message: "Driving its route.", placard: "AUTONOMY ACTIVE" };
            case "processing":
                return u.reachedObstacle
                    ? { status: "Driving through", message: "Driving on through it. The light turns green once it is past.", placard: "AUTONOMY ACTIVE" }
                    : { status: "Obstacle ahead", message: "Something on the track ahead. It slows down to judge it and keeps driving; it stops by itself only if it cannot get past.", placard: "AUTONOMY ACTIVE" };
            case "help_requested": {
                const since = u.helpSince !== null ? ` It has been waiting ${Math.floor(w.simTime - u.helpSince)}\u00a0s.` : "";
                const recovered = this.sim.logger.all().some((e) => e.type === "recovered" && e.robotId === u.id && e.eventId === u.atEventId);
                return {
                    status: "Stopped",
                    message: recovered
                        ? `Recovered, but it still cannot get past. Click Take over in its view to send it round.${since}`
                        : `Stopped: it cannot get past this (−${stopPenalty} points). Click Take over in its view to send it round.${since}`,
                    placard: "WAITING FOR OPERATOR"
                };
            }
            case "operator_control": {
                // Research team decision, Oct 28, 2026: an unnecessary take-over says so, with its cost, like the stop and
                // stuck penalties do.
                const take = this.sim.logger
                    .all()
                    .filter((e) => e.type === "operator_action" && e.robotId === u.id && e.accepted && e.action === "reroute")
                    .at(-1);
                const message = take?.unnecessary
                    ? `Not needed: it could have got past this by itself (−${this.sim.config.scoring.unnecessaryTakeoverPenalty} points). Going round it on the marked path.`
                    : "Going round the obstacle on the marked path, more slowly. It carries on by itself afterwards.";
                return { status: "Taken over", message, placard: "OPERATOR ROUTE" };
            }
            case "holding":
                if (u.holdReason === "operator")
                    return {
                        status: "Stopped by you",
                        message: u.manual
                            ? "Stopped on the way round. Press Continue to carry on round the obstacle."
                            : u.atEventId
                                ? "Stopped where it is. Click Take over in its view, or press Continue to let it drive on."
                                : "Stopped where it is. Press Continue to let it drive on.",
                        placard: "OPERATOR HOLD"
                    };
                if (u.holdReason === "immobilised")
                    return { status: "Stuck", message: `Stuck (−${this.sim.config.scoring.immobilisedPenalty} points). Recovering: ${fmt(u.immobilisedRemaining ?? 0)} left.`, placard: "VEHICLE STUCK" };
                if (u.holdReason === "objective")
                    return { status: "At objective", message: "Reached the objective.", placard: "MISSION COMPLETE" };
                {
                    const waiting = !(w.ugvs[other].state === "holding" && (w.ugvs[other].holdReason === "checkpoint" || w.ugvs[other].holdReason === "objective"));
                    return { status: "At section line", message: waiting ? `At the section line, waiting for ${NAME[other]}.` : "At the section line.", placard: "HOLDING" };
                }
        }
    }
    renderPanel(u, w) {
        const el = $(`panel-${u.id}`);
        const d = this.describe(u, w);
        const target = this.sim.isEnded() || this.sim.pausedReason() ? null : this.sim.rerouteTarget(u.id);
        if (!target)
            delete this.sent[u.id];
        // A short alert in the view when the vehicle first sees something ahead.
        const alert = u.state === "processing" && !u.reachedObstacle && u.assessingSince !== null && w.simTime - u.assessingSince < 4 ? "Obstacle detected ahead" : null;
        this.feeds[u.id].update(u, w.simTime, this.frameSim, target && this.sent[u.id] !== target ? target : null, d.placard, alert, w);
        const can = this.sim.isEnded() || this.sim.pausedReason() ? { hold: false, resume: false } : this.sim.availableActions(u.id);
        for (const btn of el.querySelectorAll("[data-ctl]"))
            btn.disabled = !can[btn.dataset.ctl];
        this.setHtml(`hint-${u.id}`, el.querySelector("[data-role=hint]"), target ? "To take over, click the marker beside the obstacle" : "");
        this.setHtml(`status-${u.id}`, el.querySelector("[data-role=status]"), d.status);
        const faulted = u.state === "holding" && u.holdReason === "fault";
        const lampClass = faulted ? "s-fault" : LAMP_CLASS[u.state];
        // The status light is repeated, large, at the top of the view beside the message (pilot feedback, Nov 2, 2026:
        // "it took me a long time to find the status light"; the one in the header stays).
        this.setHtml(`msg-${u.id}`, el.querySelector("[data-role=msg]"), `<span class="msg-status"><i class="lamp big on ${lampClass}" aria-hidden="true"></i><b>${d.status}</b></span><span class="msg-text">${d.message}</span>`);
        const lamp = el.querySelector("[data-role=lamp]");
        const cls = `lamp big on ${lampClass}`;
        // Optional faults: the Diagnose button, the report (closed once the fault clears) and a camera that has lost its signal.
        const diag = el.querySelector("[data-role=diagnose]");
        diag.hidden = !faulted;
        diag.disabled = !faulted || !!u.fault?.repair || !!this.sim.pausedReason();
        if (this.faultPanelOpen[u.id] && (!u.fault || u.fault.id !== this.faultPanelOpen[u.id] || u.fault.repair))
            this.closeFaultPanel(u.id);
        el.querySelector("[data-role=cam]").classList.toggle("no-signal", !!u.fault && u.fault.typeId === "camera_loss" && !(u.fault.repair && u.fault.repair.correct && u.fault.repair.remaining < 1));
        el.dataset.fault = faulted ? "1" : "";
        if (lamp.className !== cls)
            lamp.className = cls;
        lamp.setAttribute("aria-label", `${NAME[u.id]} status: ${d.status}`);
        el.dataset.state = u.state;
    }
    renderSpot(w) {
        const sr = w.spotReport;
        const paused = this.sim.pausedReason() !== null;
        // Hidden while paused, so nobody can count at leisure during a check-in.
        const id = paused ? "\u0000paused" : sr.active?.id ?? null;
        if (id !== this.lastSpotId) {
            this.lastSpotId = id;
            drawSpotImage($("spot-canvas"), paused ? null : sr.active, paused ? "Paused" : undefined);
            $("spot-submit").disabled = paused || !sr.active;
            // Counts typed for one image never carry over to another (also across a check-in, when the
            // image may have changed meanwhile). Both boxes are cleared together, with a note if anything was typed.
            const real = sr.active?.id ?? null;
            if (!paused && real !== this.lastRealSpotId) {
                const form = $("spot-form");
                const typed = [...form.querySelectorAll("input")].some((i) => i.value !== "");
                if (this.lastRealSpotId !== null && typed)
                    this.spotNoteUntil = w.simTime + 4;
                form.reset();
                this.lastRealSpotId = real;
            }
        }
        const next = sr.activeOnsetAt !== null ? this.sim.config.spotReportIntervalSeconds - (w.simTime - sr.activeOnsetAt) : null;
        const r = sr.lastResult;
        // Feedback with the true counts (research team decision, Oct 10, 2026).
        const mark = (ok, n) => (ok ? `${n} ✓` : `✗, it was ${n}`);
        const last = r ? `Last report: vehicles ${mark(r.vehiclesCorrect, r.truth.vehicles)}; people ${mark(r.peopleCorrect, r.truth.people)}. ` : "";
        const note = w.simTime < this.spotNoteUntil ? "New image: your counts for the old one were cleared. " : "";
        $("spot-status").textContent = paused ? "Paused." : sr.active ? `${note}${last}\nThis image is replaced in ${Math.max(0, Math.ceil(next ?? 0))} s.` : `${last}\nWaiting for the next image.`;
    }
    renderCoach(w) {
        const u1 = w.ugvs.UGV1;
        const u2 = w.ugvs.UGV2;
        const ev = (robot) => this.sim.network.events.find((e) => e.robotId === robot);
        const resolved = (robot) => w.eventStatus[ev(robot).id] === "resolved";
        const stop = this.sim.config.scoring.stopPenalty;
        let text;
        const faulty = u1.holdReason === "fault" ? u1 : u2.holdReason === "fault" ? u2 : null;
        if (faulty && faulty.fault)
            text = faulty.fault.repair
                ? `The repair is under way. When it finishes, ${NAME[faulty.id]} drives on by itself.`
                : `${NAME[faulty.id]} has reported a fault (purple light) and stopped. Click Diagnose on its panel: one reading is outside its normal range. Pick the fix that matches it, or Reboot, which always works but takes longest. In the mission, a wrong fix wastes time and costs ${this.sim.config.faults.wrongFixPenalty} points.`;
        else if (u1.holdReason === "objective" || u2.holdReason === "objective")
            text = "The practice route ends at the objective. The tutorial finishes by itself when both vehicles arrive.";
        else if (u1.state === "holding" && u1.holdReason === "operator")
            text = "You stopped UGV #1 (grey light): it waits where it is. You could take over now with the Take over marker. Here, press Continue to let it drive on and watch what it does.";
        else if (u2.state === "holding" && u2.holdReason === "operator")
            text = "You stopped UGV #2: it waits where it is. Now take over: click the Take over marker beside the tree in its view.";
        else if (u2.state === "help_requested")
            text = `UGV #2 could not get past and has stopped by itself: its light is red and it is waiting for you. A stop like this costs ${stop} points in the mission. Click the Take over marker beside the tree in UGV #2's view to send it round.`;
        else if (u2.state === "operator_control")
            text = "UGV #2 is going round the tree on the marked path (blue light), more slowly. It carries on by itself afterwards.";
        else if (resolved("UGV1") && resolved("UGV2"))
            text = "Both vehicles are past their obstacles and drive on to the objective. Meanwhile, keep counting in the Spot Report (bottom right).";
        else if (u1.state === "processing" && u2.state === "processing" && !u1.reachedObstacle)
            text =
                "Both lights are yellow: each vehicle has spotted something ahead. It slows down and judges it but keeps driving: it will only stop by itself if it cannot get past. You decide what to do. Stop halts a vehicle where it is while you look; Continue lets it drive on; clicking the Take over marker in its view sends it round. Try Stop on UGV #1 and then Continue. Take over UGV #2 with its marker.";
        else if (u1.state === "processing" && u1.reachedObstacle)
            text = "UGV #1 judged it could get through: it is driving on through the debris, and its light turns green once it is past.";
        else if (resolved("UGV1"))
            text = "UGV #1 got through by itself: its light is green again.";
        else
            text = "Nothing to do yet: both vehicles drive their routes on their own. Each panel has Stop and Continue buttons. The Spot Report (bottom right) asks you to count the vehicles and people in each image.";
        this.setHtml("coach", $("coach"), text);
    }
}
