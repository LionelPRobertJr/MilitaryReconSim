import { initialDrtState } from "../../../engine/instruments/drt.js";
import { initialSartState } from "../../../engine/instruments/sart.js";
import { isHeldBack, needsOperator } from "./event-definitions.js";
import { cumulative, pointAt } from "./geometry.js";
import { HIDDEN_STUCK_AT, ROBOT_IDS, wayRound } from "./route.js";
import { buildSpotImage, spotTruth } from "./spotReport.js";
// The Military Recon scenario pack's per-session logic (Study 2 brief
// sections 4-6, 8, 10). The engine owns the clock, command queue, pauses and
// logging; this file owns route following, the UGV state machine, events,
// sections and probes, the Spot Report task, scoring and summary metrics.
//
// Both UGVs behave identically in every condition: nothing here reads
// config.instructionSet. Event behaviour comes only from event-definitions.ts
// (via RouteEvent.behaviour).
/** Snapshot of the static network the UI needs is exposed by ReconSimulation; the world holds only dynamic state. */
export function createReconWorld(config, network) {
    const ugvs = {};
    for (const id of ROBOT_IDS) {
        const route = network.routes[id];
        const p = pointAt(route.points, route.cum, 0);
        ugvs[id] = {
            id,
            state: "auto_navigation",
            holdReason: null,
            s: 0,
            x: p.x,
            y: p.y,
            heading: p.heading,
            section: network.sections[0],
            atEventId: null,
            assessingSince: null,
            reachedObstacle: false,
            helpSince: null,
            immobilisedRemaining: null,
            manual: null,
            heldFrom: null,
            cameraSceneId: network.nodes[id][0].sceneId,
            cameraEventId: null,
            nextNodeIndex: 1
        };
    }
    const eventStatus = {};
    for (const ev of network.events)
        eventStatus[ev.id] = "pending";
    return {
        simTime: 0,
        phase: "running",
        ugvs,
        section: network.sections[0],
        sectionStartedAt: 0,
        eventStatus,
        score: 0,
        scoreBreakdown: { objective: 0, timeBonus: 0, spotReport: 0, penalties: 0 },
        missionComplete: false,
        spotReport: { active: null, activeOnsetAt: null, attempted: 0, itemsCorrect: 0, itemsTotal: 0, lastResult: null },
        drt: initialDrtState(),
        sart: initialSartState()
    };
}
/** Where the UGV "reaches" an obstacle: sE, except held-back obstacles with a hidden danger, where it drives into it (HIDDEN_STUCK_AT). */
export function arrivalAt(ev) {
    return ev.behaviour === "unresolvable" && ev.classId !== "critical_novel" ? ev.sE + HIDDEN_STUCK_AT : ev.sE;
}
const mean = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export class ReconSession {
    ctx;
    network;
    startup;
    tick;
    csvExcludedKeys = ["sections", "criticalEvent", "events", "decisions"];
    spotIndex = 0;
    nextSpotAt;
    spotRng;
    constructor(ctx, network) {
        this.ctx = ctx;
        this.network = network;
        // The tutorial draws its images from its own stream, so the mission never repeats a tutorial image.
        this.spotRng = ctx.stream(ctx.config.tutorial ? "spot-report-tutorial" : "spot-report");
        this.nextSpotAt = Math.min(15, this.config.spotReportIntervalSeconds);
        this.startup = [() => this.logNetwork(), "drt.schedule", "sart.schedule"];
        this.tick = [
            "drt.trigger",
            "sart.trigger",
            () => this.triggerSpotReport(),
            (dt) => {
                for (const id of ROBOT_IDS)
                    this.advance(this.world.ugvs[id], dt);
            },
            () => this.checkSection(),
            "drt.timeout",
            "drt.powerLossRecovery"
        ];
    }
    get world() {
        return this.ctx.world;
    }
    get config() {
        return this.ctx.config;
    }
    get now() {
        return this.world.simTime;
    }
    record(e) {
        this.ctx.logger.record(e);
    }
    sessionStartFields() {
        return { instructionSet: this.config.instructionSet, robotCount: 2, tutorial: this.config.tutorial };
    }
    isDelayedCommand(cmd) {
        return cmd.kind === "ugv_action";
    }
    applyCommand(cmd) {
        if (cmd.kind === "ugv_action")
            this.handleAction(cmd.robotId, cmd.action, cmd.bypassId ?? null);
        else
            this.handleSpotReport(cmd.imageId, cmd.vehicles, cmd.people);
    }
    logNetwork() {
        const n = this.network;
        this.record({
            t: 0,
            type: "route_network",
            events: n.events.map((e) => ({ id: e.id, robotId: e.robotId, section: e.section, kindId: e.kindId, classId: e.classId, behaviour: e.behaviour, sE: e.sE })),
            sectionLength: n.sectionLength
        });
    }
    // --- helpers ------------------------------------------------------------
    event(id) {
        return this.network.events.find((e) => e.id === id);
    }
    addScore(delta, reason, bucket) {
        if (delta === 0)
            return;
        this.world.score += delta;
        this.world.scoreBreakdown[bucket] += delta;
        this.record({ t: this.now, type: "score_change", delta, reason, total: this.world.score });
    }
    setState(u, to, holdReason = null) {
        if (u.state === to && u.holdReason === holdReason)
            return;
        const from = u.state;
        u.state = to;
        u.holdReason = to === "holding" ? holdReason : null;
        u.helpSince = to === "help_requested" ? this.now : null;
        this.record({ t: this.now, type: "robot_state_change", robotId: u.id, from, to, holdReason: u.holdReason, s: u.s, eventId: this.contextEventId(u) });
    }
    updatePoseOnRoute(u) {
        const r = this.network.routes[u.id];
        const p = pointAt(r.points, r.cum, u.s);
        u.x = p.x;
        u.y = p.y;
        u.heading = p.heading;
    }
    /** The next event on this UGV's route not yet detected and not behind it, within its current section. */
    nextEventAhead(u) {
        for (const ev of this.network.events) {
            if (ev.robotId !== u.id || ev.section !== u.section)
                continue;
            if (this.world.eventStatus[ev.id] !== "pending")
                continue;
            if (ev.sE < u.s)
                continue;
            return ev;
        }
        return null;
    }
    /** The obstacle in view: detected ahead, reached, or the one the UGV is going around. */
    contextEventId(u) {
        return u.atEventId ?? u.manual?.eventId ?? null;
    }
    sectionEnd(u) {
        const i = this.network.sections.indexOf(u.section);
        return this.network.routes[u.id].sectionEnds[i];
    }
    setCamera(u, sceneId, eventId) {
        if (u.cameraSceneId === sceneId && u.cameraEventId === eventId)
            return;
        u.cameraSceneId = sceneId;
        u.cameraEventId = eventId;
        this.record({ t: this.now, type: "camera_scene", robotId: u.id, sceneId, eventId });
    }
    // --- movement -------------------------------------------------------------
    advance(u, dt) {
        switch (u.state) {
            case "holding":
                if (u.holdReason === "immobilised" && u.immobilisedRemaining !== null) {
                    u.immobilisedRemaining -= dt;
                    if (u.immobilisedRemaining <= 1e-9)
                        this.recoverFromImmobilisation(u);
                }
                return;
            case "help_requested":
                return;
            case "operator_control":
                this.driveManual(u, dt);
                return;
            case "auto_navigation":
            case "processing":
                this.driveAuto(u, dt);
                return;
        }
    }
    /** Driving its own route: green, or yellow while assessing an obstacle ahead (slower). */
    driveAuto(u, dt) {
        const D = this.config.detectionDistance;
        if (!u.atEventId) {
            // Detection is positional, so it also fires on rejoining the route past a detection point.
            const next = this.nextEventAhead(u);
            if (next && u.s >= next.sE - D - 1e-9)
                this.detect(u, next);
        }
        const ev = u.atEventId ? this.event(u.atEventId) : null;
        let limit;
        let reach;
        if (ev) {
            limit = u.reachedObstacle ? ev.sE + this.config.passDistance : arrivalAt(ev);
            reach = u.reachedObstacle ? "pass" : "arrive";
        }
        else {
            const next = this.nextEventAhead(u);
            const end = this.sectionEnd(u);
            if (next && next.sE - D < end) {
                limit = next.sE - D;
                reach = "detect";
            }
            else {
                limit = end;
                reach = "end";
            }
        }
        const v = ev ? this.config.assessingSpeed : this.config.autonomousSpeed;
        const target = Math.min(limit, u.s + v * dt);
        this.passNodes(u, target);
        u.s = target;
        this.updatePoseOnRoute(u);
        if (u.s < limit - 1e-9)
            return;
        u.s = limit;
        if (reach === "arrive")
            this.arriveAtObstacle(u, ev);
        else if (reach === "pass")
            this.passObstacle(u, ev);
        else if (reach === "detect")
            this.detect(u, this.nextEventAhead(u));
        else
            this.reachSectionEnd(u);
    }
    /** Camera refreshes for route nodes passed up to arc length sTo. */
    passNodes(u, sTo) {
        const list = this.network.nodes[u.id];
        while (u.nextNodeIndex < list.length && list[u.nextNodeIndex].s <= sTo + 1e-9) {
            const node = list[u.nextNodeIndex];
            u.nextNodeIndex++;
            // Events change the camera when they are detected (detect), not at a node; approach and event
            // nodes only mark where bypasses start and where the obstacle is. While an obstacle is in view,
            // nothing else replaces it.
            if (node.kind === "approach" || node.kind === "event")
                continue;
            if (u.atEventId)
                continue;
            this.setCamera(u, node.sceneId, null);
        }
    }
    /** The UGV sees an obstacle ahead: yellow light, the obstacle on camera, slower while it assesses. */
    detect(u, ev) {
        this.world.eventStatus[ev.id] = "active";
        u.atEventId = ev.id;
        u.assessingSince = this.now;
        u.reachedObstacle = false;
        this.record({ t: this.now, type: "event_detected", robotId: u.id, eventId: ev.id, kindId: ev.kindId, classId: ev.classId, section: ev.section });
        this.setCamera(u, ev.kindId, ev.id);
        this.setState(u, "processing");
    }
    /** Reaching the obstacle itself: drive through (handled), stop and wait (operator-needed), or get stuck (critical). */
    arriveAtObstacle(u, ev) {
        u.reachedObstacle = true;
        this.record({ t: this.now, type: "event_arrival", robotId: u.id, eventId: ev.id, kindId: ev.kindId, classId: ev.classId, section: ev.section });
        if (ev.behaviour === "continues")
            return; // keeps driving through, still yellow
        if (ev.behaviour === "needs_operator") {
            this.setState(u, "help_requested");
            this.record({ t: this.now, type: "help_request", robotId: u.id, eventId: ev.id });
            this.addScore(-this.config.scoring.stopPenalty, "ugv_stopped", "penalties");
            return;
        }
        this.immobilise(u, ev);
    }
    /** Past a robot-handled obstacle: green again. */
    passObstacle(u, ev) {
        this.resolve(u, ev, "robot_continued", null);
        const exit = this.network.nodes[u.id].find((n) => n.kind === "exit" && n.eventId === ev.id);
        if (exit)
            this.setCamera(u, exit.sceneId, null);
        this.setState(u, "auto_navigation");
    }
    resolve(u, ev, resolution, timeLostSeconds) {
        this.world.eventStatus[ev.id] = "resolved";
        if (u.atEventId === ev.id) {
            u.atEventId = null;
            u.assessingSince = null;
            u.reachedObstacle = false;
        }
        this.record({ t: this.now, type: "event_resolved", robotId: u.id, eventId: ev.id, resolution, timeLostSeconds });
    }
    immobilise(u, ev) {
        u.immobilisedRemaining = this.config.immobilisationRecoverySeconds;
        this.setState(u, "holding", "immobilised");
        this.record({ t: this.now, type: "immobilised", robotId: u.id, eventId: ev.id, recoverySeconds: this.config.immobilisationRecoverySeconds });
        this.addScore(-this.config.scoring.immobilisedPenalty, "ugv_immobilised", "penalties");
    }
    recoverFromImmobilisation(u) {
        u.immobilisedRemaining = null;
        const ev = this.event(u.atEventId);
        this.record({ t: this.now, type: "recovered", robotId: u.id, eventId: ev.id });
        // Recovered back to the near end of the bridge: it still needs the operator to send it around.
        this.setState(u, "help_requested");
        this.record({ t: this.now, type: "help_request", robotId: u.id, eventId: ev.id });
    }
    driveManual(u, dt) {
        const m = u.manual;
        m.progress = Math.min(m.length, m.progress + this.config.operatorGuidedSpeed * dt);
        const p = pointAt(m.path, cumulative(m.path), m.progress);
        u.x = p.x;
        u.y = p.y;
        u.heading = p.heading;
        if (m.progress < m.length - 1e-9)
            return;
        // Rejoin the route at the event's exit node.
        const ev = this.event(m.eventId);
        u.manual = null;
        u.s = ev.sX;
        this.updatePoseOnRoute(u);
        // Skip the bypassed nodes; show the exit node's scene.
        const list = this.network.nodes[u.id];
        while (u.nextNodeIndex < list.length && list[u.nextNodeIndex].s < ev.sX - 1e-9)
            u.nextNodeIndex++;
        this.passNodes(u, ev.sX);
        this.resolve(u, ev, "rerouted", this.now - m.nominalRejoinAt);
        this.setState(u, "auto_navigation");
    }
    // --- operator actions -------------------------------------------------------
    /** Which actions the operator can take on this UGV right now. */
    availableActions(robotId) {
        const u = this.world.ugvs[robotId];
        return { reroute: this.rejectReason(u, "reroute", null) === null, hold: this.rejectReason(u, "hold", null) === null, resume: this.rejectReason(u, "resume", null) === null };
    }
    /** Why each action is unavailable right now (null = available). */
    actionReasons(robotId) {
        const u = this.world.ugvs[robotId];
        return { reroute: this.rejectReason(u, "reroute", null), hold: this.rejectReason(u, "hold", null), resume: this.rejectReason(u, "resume", null) };
    }
    /** The bypass a take-over would follow right now (its waypoints are shown beside the obstacle), or null. */
    rerouteTarget(robotId) {
        const u = this.world.ugvs[robotId];
        return this.rejectReason(u, "reroute", null) === null ? this.event(u.atEventId).bypassId : null;
    }
    rejectReason(u, action, bypassId) {
        if (this.world.phase !== "running" || this.world.missionComplete)
            return "session_not_running";
        const byOperator = u.state === "holding" && u.holdReason === "operator";
        if (u.state === "holding" && !byOperator)
            return u.holdReason === "immobilised" ? "immobilised" : u.holdReason === "checkpoint" ? "waiting_at_section_line" : "at_objective";
        if (action === "hold")
            return byOperator ? "already_stopped" : u.state === "help_requested" ? "already_stopped" : null;
        if (action === "resume")
            return byOperator ? null : "not_stopped";
        if (u.manual || u.state === "operator_control")
            return "already_rerouting";
        if (!u.atEventId)
            return "no_obstacle_in_view";
        const ev = this.event(u.atEventId);
        if (u.reachedObstacle && ev.behaviour === "continues")
            return "driving_through";
        if (bypassId !== null && bypassId !== ev.bypassId)
            return "edge_not_available";
        return null;
    }
    handleAction(robotId, action, bypassId) {
        const u = this.world.ugvs[robotId];
        if (!u)
            return;
        const reason = this.rejectReason(u, action, bypassId);
        const ctxId = this.contextEventId(u);
        const ctxEv = ctxId ? this.event(ctxId) : null;
        const base = {
            t: this.now,
            type: "operator_action",
            robotId,
            action,
            targetEdge: action !== "reroute" ? null : bypassId ?? (reason === null ? this.rerouteTarget(robotId) : null),
            robotState: u.state,
            holdReason: u.holdReason,
            eventId: ctxId,
            eventClass: ctxEv?.classId ?? null
        };
        if (reason !== null) {
            this.record({ ...base, accepted: false, rejectReason: reason, unnecessary: false, beforeStop: false, heldSeconds: null });
            return;
        }
        const beforeStop = u.state === "processing" || (u.state === "holding" && u.holdReason === "operator");
        const unnecessary = action !== "resume" && ctxEv !== null && ctxEv.behaviour === "continues";
        const heldSeconds = action === "resume" && u.heldFrom ? this.now - u.heldFrom.since : null;
        this.record({ ...base, accepted: true, rejectReason: null, unnecessary, beforeStop: action !== "resume" && ctxEv !== null && beforeStop, heldSeconds });
        if (action === "hold") {
            u.heldFrom = { state: u.state, since: this.now };
            this.setState(u, "holding", "operator");
        }
        else if (action === "resume") {
            const prior = u.heldFrom;
            u.heldFrom = null;
            this.setState(u, prior.state);
        }
        else {
            this.startReroute(u);
            if (unnecessary)
                this.addScore(-this.config.scoring.unnecessaryTakeoverPenalty, "unnecessary_takeover", "penalties");
        }
    }
    startReroute(u) {
        const ev = this.event(u.atEventId);
        const bypass = this.network.bypasses.find((b) => b.id === ev.bypassId);
        const route = this.network.routes[u.id];
        const v = this.config.autonomousSpeed;
        const vA = this.config.assessingSpeed;
        const pass = this.config.passDistance;
        // When the UGV would have reached the exit had it driven on (for the time lost by unnecessary take-overs).
        const nominalRemaining = u.reachedObstacle ? (ev.sX - ev.sE) / v : (ev.sE - u.s) / vA + pass / vA + (ev.sX - ev.sE - pass) / v;
        // The way round starts where the UGV is (route.ts wayRound, shared with the 3D view's waypoints).
        const { path, backUp } = wayRound(route, ev, bypass.side, u.s);
        const length = cumulative(path).at(-1);
        u.atEventId = null;
        u.assessingSince = null;
        u.reachedObstacle = false;
        u.heldFrom = null;
        this.world.eventStatus[ev.id] = "rerouting";
        u.manual = { eventId: ev.id, bypassId: bypass.id, path, backUp, length, progress: 0, startedAt: this.now, nominalRejoinAt: this.now + nominalRemaining };
        // On the way round the camera shows the live view of the path, not the obstacle still.
        this.setCamera(u, "bypass_track", null);
        this.setState(u, "operator_control");
    }
    // --- sections, objective, mission end ------------------------------------------
    reachSectionEnd(u) {
        const last = u.section === this.network.sections.at(-1);
        this.record({ t: this.now, type: "section_line_reached", robotId: u.id, section: u.section, sectionSeconds: this.now - this.world.sectionStartedAt });
        if (last) {
            this.setState(u, "holding", "objective");
            this.record({ t: this.now, type: "objective_reached", robotId: u.id });
            this.addScore(this.config.scoring.objectiveReachedPerUgv, "objective_reached", "objective");
        }
        else {
            this.setState(u, "holding", "checkpoint");
        }
    }
    /** A section ends when BOTH UGVs have crossed its line (brief section 4); then the probe fires and both are released together. */
    checkSection() {
        const w = this.world;
        if (w.missionComplete || w.phase !== "running")
            return;
        const done = ROBOT_IDS.every((id) => w.ugvs[id].state === "holding" && (w.ugvs[id].holdReason === "checkpoint" || w.ugvs[id].holdReason === "objective"));
        if (!done)
            return;
        const section = w.section;
        this.record({ t: this.now, type: "section_complete", section, durationSeconds: this.now - w.sectionStartedAt });
        const idx = this.network.sections.indexOf(section);
        if (idx === this.network.sections.length - 1) {
            w.missionComplete = true;
            const remaining = Math.floor(this.config.sessionLengthSeconds - this.now);
            if (remaining > 0)
                this.addScore(remaining * this.config.scoring.timeBonusPerSecond, "time_bonus", "timeBonus");
            this.ctx.endSession("mission_complete");
            return;
        }
        const nextSection = this.network.sections[idx + 1];
        w.section = nextSection;
        w.sectionStartedAt = this.now;
        for (const id of ROBOT_IDS) {
            const u = w.ugvs[id];
            u.section = nextSection;
            this.setState(u, "auto_navigation");
        }
        if (this.config.probesEnabled)
            this.ctx.requestPause(`probe_${idx + 1}`);
    }
    // --- Spot Report ---------------------------------------------------------------
    triggerSpotReport() {
        if (!this.config.spotReportEnabled || this.now < this.nextSpotAt - 1e-9)
            return;
        const sr = this.world.spotReport;
        if (sr.active)
            this.record({ t: this.now, type: "spot_report_skipped", imageId: sr.active.id });
        this.spotIndex += 1;
        const image = buildSpotImage(this.spotRng, this.spotIndex);
        const truth = spotTruth(image);
        sr.active = image;
        sr.activeOnsetAt = this.now;
        this.record({ t: this.now, type: "spot_report_onset", imageId: image.id, vehicles: truth.vehicles, people: truth.people });
        this.nextSpotAt = this.now + this.config.spotReportIntervalSeconds;
    }
    handleSpotReport(imageId, vehicles, people) {
        const sr = this.world.spotReport;
        if (!sr.active || sr.active.id !== imageId)
            return; // stale submit for an image already replaced
        const truth = spotTruth(sr.active);
        const answer = { vehicles: Math.round(vehicles), people: Math.round(people) };
        const correctItems = (answer.vehicles === truth.vehicles ? 1 : 0) + (answer.people === truth.people ? 1 : 0);
        this.record({ t: this.now, type: "spot_report", imageId, answer, truth, correctItems, correct: correctItems === 2, rtSeconds: this.now - sr.activeOnsetAt });
        sr.attempted += 1;
        sr.itemsCorrect += correctItems;
        sr.itemsTotal += 2;
        sr.lastResult = { imageId, correctItems, vehiclesCorrect: answer.vehicles === truth.vehicles, peopleCorrect: answer.people === truth.people, at: this.now, answer, truth };
        sr.active = null;
        sr.activeOnsetAt = null;
        // The next image follows shortly (continuous, self-paced Spot Report).
        this.nextSpotAt = this.now + this.config.spotReportNextAfterSubmitSeconds;
        this.addScore(correctItems * this.config.scoring.spotReportItemCorrect, "spot_report_correct", "spotReport");
    }
    // --- summary (brief section 10) ---------------------------------------------------
    summary(core) {
        const log = this.ctx.logger.all();
        // Interventions: take-overs and Stops (Continue is not an intervention on the obstacle).
        const actions = log.filter((e) => e.type === "operator_action" && e.accepted && e.action !== "resume");
        const resumes = log.filter((e) => e.type === "operator_action" && e.accepted && e.action === "resume");
        const detectedAt = (eventId) => log.find((e) => e.type === "event_detected" && e.eventId === eventId)?.t ?? null;
        const firstOn = (eventId) => actions.find((a) => a.eventId === eventId);
        // Critical event (UGV1, Section B). It looks like an obstacle the UGV handles: it drives on and is
        // immobilised unless the operator takes over first.
        const crit = this.network.events.find((e) => e.classId === "critical_novel") ?? null;
        let criticalEvent = null;
        if (crit) {
            const sceneAt = log.find((e) => e.type === "camera_scene" && e.robotId === crit.robotId && e.eventId === crit.id)?.t ?? null;
            const detected = detectedAt(crit.id);
            const reachedAt = log.find((e) => e.type === "event_arrival" && e.eventId === crit.id)?.t ?? null;
            const immobilisedAt = log.find((e) => e.type === "immobilised" && e.eventId === crit.id)?.t ?? null;
            const helpAt = log.find((e) => e.type === "help_request" && e.eventId === crit.id)?.t ?? null;
            const first = firstOn(crit.id);
            const detection = sceneAt === null ? undefined : log.find((e) => (e.type === "camera_view" || e.type === "robot_select") && e.robotId === crit.robotId && e.t >= sceneAt);
            const resolution = log.find((e) => e.type === "event_resolved" && e.eventId === crit.id);
            const immobilisations = log.filter((e) => e.type === "immobilised" && e.eventId === crit.id).length;
            criticalEvent = {
                eventId: crit.id,
                robotId: crit.robotId,
                sceneAppearedAt: sceneAt,
                detectedAt: detected,
                reachedAt,
                immobilisedAt,
                helpRequestedAt: helpAt,
                firstActionAt: first?.t ?? null,
                firstAction: first?.action ?? null,
                /** First intervention (take-over or Stop) on the bridge minus the moment it appeared (yellow light on). */
                interventionLatencySeconds: first && detected !== null ? first.t - detected : null,
                /** 1 if the operator intervened (took over or stopped it) before the UGV drove onto the bridge and was immobilised. */
                proactive: first ? (immobilisedAt === null || first.t < immobilisedAt ? 1 : 0) : null,
                /** Sent around without ever being immobilised there. */
                correctResolution: resolution && resolution.type === "event_resolved" && resolution.resolution === "rerouted" && immobilisations === 0 ? 1 : 0,
                immobilisations,
                detectionProxySeconds: detection && sceneAt !== null ? detection.t - sceneAt : null
            };
        }
        // Known operator-needed events: latency from detection to the take-over, and whether it came before the stop.
        const knownLatencies = [];
        let knownDetected = 0;
        let knownBeforeStop = 0;
        for (const ev of this.network.events.filter((e) => e.classId === "operator_needed")) {
            const start = detectedAt(ev.id);
            if (start === null)
                continue;
            knownDetected++;
            const first = firstOn(ev.id);
            if (!first)
                continue;
            knownLatencies.push(first.t - start);
            if (first.beforeStop)
                knownBeforeStop++;
        }
        // Unnecessary takeovers: take-overs and Stops on robot-handled events and lures; time lost (the way round's extra
        // time, or how long the operator held the UGV).
        const unnecessary = actions.filter((a) => a.unnecessary);
        let unnecessaryTimeLost = 0;
        for (const a of unnecessary) {
            if (a.action === "reroute") {
                const res = log.find((e) => e.type === "event_resolved" && e.eventId === a.eventId && e.resolution === "rerouted");
                if (res && res.type === "event_resolved" && res.timeLostSeconds !== null)
                    unnecessaryTimeLost += Math.max(0, res.timeLostSeconds);
            }
            else {
                const resume = resumes.find((r) => r.robotId === a.robotId && r.t >= a.t);
                unnecessaryTimeLost += resume?.heldSeconds ?? this.now - a.t;
            }
        }
        // Decisions at each obstacle (Oct 10, 2026): correct = took over (and was not stuck first) where the UGV needed
        // the operator; did not take over where it could pass by itself (Stop is free and does not count). Split into
        // the trained kinds and the HELD-BACK kinds (never in training): the transfer measure.
        const reroutes = actions.filter((a) => a.action === "reroute");
        const decide = (ev) => {
            const took = reroutes.some((a) => a.eventId === ev.id);
            if (!needsOperator(ev.classId))
                return took ? 0 : 1;
            const stuckFirst = log.some((e) => e.type === "immobilised" && e.eventId === ev.id) || log.some((e) => e.type === "help_request" && e.eventId === ev.id && ev.behaviour === "needs_operator");
            return took && !stuckFirst ? 1 : 0;
        };
        const decided = this.network.events.filter((ev) => detectedAt(ev.id) !== null);
        const acc = (evs) => (evs.length ? evs.reduce((n, ev) => n + decide(ev), 0) / evs.length : null);
        const held = decided.filter((ev) => isHeldBack(ev.classId));
        const trained = decided.filter((ev) => !isHeldBack(ev.classId));
        const decisions = decided.map((ev) => ({ eventId: ev.id, kindId: ev.kindId, classId: ev.classId, correct: decide(ev) }));
        const sections = log.filter((e) => e.type === "section_complete").map((e) => ({ section: e.section, durationSeconds: e.durationSeconds }));
        const sectionB = this.sectionTimes("B", log);
        const spotAnswers = log.filter((e) => e.type === "spot_report");
        const spotShown = log.filter((e) => e.type === "spot_report_onset").length;
        const sr = this.world.spotReport;
        return {
            ...core.header,
            instructionSet: this.config.instructionSet,
            seed: this.config.seed,
            tutorial: this.config.tutorial,
            missionComplete: this.world.missionComplete,
            missionTimeSeconds: this.now,
            score: this.world.score,
            scoreBreakdown: this.world.scoreBreakdown,
            criticalInterventionLatencySeconds: criticalEvent?.interventionLatencySeconds ?? null,
            criticalProactive: criticalEvent?.proactive ?? null,
            criticalCorrectResolution: criticalEvent?.correctResolution ?? null,
            criticalDetectionProxySeconds: criticalEvent?.detectionProxySeconds ?? null,
            sectionBSecondsUgv1: sectionB.UGV1,
            sectionBSecondsUgv2: sectionB.UGV2,
            knownEventMeanLatencySeconds: mean(knownLatencies),
            knownEventsWithAction: knownLatencies.length,
            knownEventsDetected: knownDetected,
            knownEventsTakenOverBeforeStop: knownBeforeStop,
            /** Times a UGV stopped at an obstacle and waited for the operator (each deducted stopPenalty). */
            stops: log.filter((e) => e.type === "score_change" && e.reason === "ugv_stopped").length,
            unnecessaryTakeovers: unnecessary.length,
            /** Take-overs (waypoints) at obstacles the UGV could pass; each deducted unnecessaryTakeoverPenalty. */
            unnecessaryReroutes: unnecessary.filter((a) => a.action === "reroute").length,
            immobilisations: log.filter((e) => e.type === "immobilised").length,
            /** Share of correct decisions at obstacles of trained kinds (see decide()). */
            trainedDecisionAccuracy: acc(trained),
            /** Share of correct decisions at HELD-BACK obstacles (never in training): the transfer measure. */
            heldBackDecisionAccuracy: acc(held),
            heldBackNeededAccuracy: acc(held.filter((ev) => needsOperator(ev.classId))),
            heldBackHandledAccuracy: acc(held.filter((ev) => !needsOperator(ev.classId))),
            heldBackDetected: held.length,
            unnecessaryTakeoverSecondsLost: unnecessaryTimeLost,
            spotReportsShown: spotShown,
            spotReportsAttempted: sr.attempted,
            spotReportAccuracy: sr.itemsTotal > 0 ? sr.itemsCorrect / sr.itemsTotal : null,
            spotReportMeanRtSeconds: mean(spotAnswers.map((e) => (e.type === "spot_report" ? e.rtSeconds : 0))),
            criticalEvent,
            decisions,
            sections,
            ...core.drt,
            ...core.questionnaires,
            ...core.sart
        };
    }
    /** Each UGV's Section B time: from Section B start to reaching its Section B line. */
    sectionTimes(section, log) {
        const out = { UGV1: null, UGV2: null };
        for (const e of log) {
            if (e.type === "section_line_reached" && e.section === section)
                out[e.robotId] = e.sectionSeconds;
        }
        return out;
    }
}
