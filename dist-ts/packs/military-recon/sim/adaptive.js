const NEEDS = new Set(["operator_needed", "novel_needed", "critical_novel"]);
/** Held back from training (Oct 10, 2026): the transfer obstacles, including the bridge. */
const HELD = new Set(["novel_handled", "novel_needed", "critical_novel"]);
/** Stopped and waiting on the operator, or stuck: the other UGV's state that makes demands concurrent. */
const isStopped = (x) => x.state === "help_requested" || (x.state === "holding" && x.holdReason === "immobilised");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => {
    if (xs.length < 2)
        return null;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
/** Inverse standard normal CDF (Acklam's rational approximation; |error| < 1.2e-9). */
export function probit(p) {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (p < lo) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo)
        return -probit(1 - p);
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function adaptivePerformance({ sim }) {
    const log = sim;
    const end = log.find((e) => e.type === "session_end");
    const net = log.find((e) => e.type === "route_network");
    if (!end || !net || net.type !== "route_network")
        return null;
    const endT = end.t;
    const kinds = new Map(net.events.map((e) => [e.id, e]));
    // Interventions: accepted take-overs and Stops (Continue is not an intervention on the obstacle).
    const actions = log.filter((e) => e.type === "operator_action" && e.accepted === true && e.action !== "resume");
    // Detections are the anchor: the moment the obstacle appears and the light turns yellow.
    const arrivals = log.filter((e) => e.type === "event_detected");
    const timeline = { UGV1: [{ t: 0, state: "auto_navigation", holdReason: null }], UGV2: [{ t: 0, state: "auto_navigation", holdReason: null }] };
    for (const e of log)
        if (e.type === "robot_state_change")
            timeline[e.robotId].push({ t: e.t, state: e.to, holdReason: e.holdReason });
    /** State at time t, after every change logged at or before t. */
    const stateAt = (robot, t) => {
        let s = timeline[robot][0];
        for (const x of timeline[robot])
            if (x.t <= t)
                s = x;
        return s;
    };
    /** First accepted take-over on a given event. */
    const firstAction = (eventId) => actions.find((a) => a.eventId === eventId) ?? null;
    // --- novel: the critical event ---------------------------------------------------
    const critDef = net.events.find((e) => e.classId === "critical_novel");
    let novel = null;
    if (critDef) {
        const sceneAt = log.find((e) => e.type === "camera_scene" && e.eventId === critDef.id)?.t ?? null;
        const arr = arrivals.find((a) => a.eventId === critDef.id)?.t ?? null;
        const first = firstAction(critDef.id);
        const looked = sceneAt === null ? null : log.find((e) => (e.type === "camera_view" || e.type === "robot_select") && e.robotId === critDef.robotId && e.t >= sceneAt) ?? null;
        const res = log.find((e) => e.type === "event_resolved" && e.eventId === critDef.id);
        const immob = log.find((e) => e.type === "immobilised" && e.eventId === critDef.id) ?? null;
        const proactive = first ? (immob === null || first.t < immob.t ? 1 : 0) : null;
        const correct = res && res.type === "event_resolved" && res.resolution === "rerouted" && !immob ? 1 : 0;
        // After the recovery UGV1 waits at the bridge (help request): how long until the operator sent it around.
        const help = immob ? log.find((e) => e.type === "help_request" && e.eventId === critDef.id && e.t >= immob.t) ?? null : null;
        const rescue = help ? actions.find((a) => a.eventId === critDef.id && a.t >= help.t) ?? null : null;
        novel = {
            reached: arr !== null,
            detectionSeconds: looked && sceneAt !== null ? looked.t - sceneAt : null,
            responseSeconds: first && arr !== null ? first.t - arr : null,
            proactive,
            correctResolution: arr === null ? null : correct,
            /** 0-2: sent around without being immobilised + taking over before it drove onto the bridge (the two coincide unless the mission ran out). */
            adaptationScore: arr === null ? null : correct + (proactive ?? 0),
            immobilised: !!immob,
            /** Seconds from UGV1 waiting at the bridge after its recovery to the take-over (null if never immobilised). */
            recoverySeconds: help ? (rescue ? rescue.t - help.t : null) : null
        };
    }
    // --- uncertain: discrimination, learning, revising plans ---------------------------
    // Events the UGV detected. A hit or false alarm = taking over IN TIME: an accepted take-over before
    // the UGV stopped at the obstacle or was immobilised on it (beforeStop). Take-overs after a stop are
    // forced (the UGV cannot go on otherwise) and are not counted as decisions.
    const reached = arrivals.map((a) => ({ arr: a, def: kinds.get(a.eventId) })).filter((x) => x.def);
    const took = (eventId) => actions.some((a) => a.eventId === eventId && a.beforeStop === true);
    const needs = reached.filter((x) => NEEDS.has(x.def.classId));
    const handles = reached.filter((x) => !NEEDS.has(x.def.classId));
    const hits = needs.filter((x) => took(x.def.id)).length;
    const fas = handles.filter((x) => took(x.def.id)).length;
    // Log-linear correction (Hautus, 1995) so rates of 0 or 1 still give finite z-scores.
    const hr = (hits + 0.5) / (needs.length + 1);
    const far = (fas + 0.5) / (handles.length + 1);
    // Held-back obstacles (never in training): a decision is correct if the operator took over in time (waypoints
    // before the UGV stopped or got stuck) where it needed them, and did not take over where it could pass.
    const rerouted = (eventId) => actions.some((a) => a.eventId === eventId && a.action === "reroute" && a.beforeStop === true);
    const heldNeeds = needs.filter((x) => HELD.has(x.def.classId));
    const heldHandles = handles.filter((x) => HELD.has(x.def.classId));
    const heldHits = heldNeeds.filter((x) => rerouted(x.def.id)).length;
    const heldFas = heldHandles.filter((x) => actions.some((a) => a.eventId === x.def.id && a.action === "reroute")).length;
    const latencyOf = (x) => {
        const a = firstAction(x.def.id);
        return a ? a.t - x.arr.t : null;
    };
    const known = needs.filter((x) => x.def.classId === "operator_needed");
    const knownLat = (section) => known.filter((x) => !section || x.def.section === section).map(latencyOf).filter((v) => v !== null);
    const faRate = (section) => {
        const xs = handles.filter((x) => x.def.section === section);
        return xs.length ? xs.filter((x) => took(x.def.id)).length / xs.length : null;
    };
    // After a stop: seconds from the UGV stopping at an obstacle to the take-over (how fast the operator recovers a miss).
    const stopResponses = log
        .filter((e) => e.type === "help_request")
        .map((h) => {
        const a = actions.find((x) => x.eventId === h.eventId && x.t >= h.t);
        return a ? a.t - h.t : null;
    })
        .filter((v) => v !== null);
    const latA = mean(knownLat("A"));
    const latC = mean(knownLat("C"));
    const faA = faRate("A");
    const faC = faRate("C");
    const uncertain = {
        needsEvents: needs.length,
        handledEvents: handles.length,
        hits,
        falseAlarms: fas,
        hitRate: needs.length ? hits / needs.length : null,
        falseAlarmRate: handles.length ? fas / handles.length : null,
        /** Signal-detection sensitivity (log-linear corrected): higher = takes over on the right events. */
        dPrime: needs.length && handles.length ? probit(hr) - probit(far) : null,
        /** Response criterion: negative = leans towards taking over, positive = leans towards leaving it. */
        criterion: needs.length && handles.length ? -(probit(hr) + probit(far)) / 2 : null,
        heldBackNeedsEvents: heldNeeds.length,
        heldBackHandledEvents: heldHandles.length,
        /** Held-back obstacles that needed the operator: share taken over in time. */
        heldBackHitRate: heldNeeds.length ? heldHits / heldNeeds.length : null,
        /** Held-back obstacles the UGV could pass: share where the operator took over anyway. */
        heldBackFalseAlarmRate: heldHandles.length ? heldFas / heldHandles.length : null,
        /** Share of correct decisions over all held-back obstacles reached. */
        heldBackAccuracy: heldNeeds.length + heldHandles.length ? (heldHits + heldHandles.length - heldFas) / (heldNeeds.length + heldHandles.length) : null,
        knownLatencyA: latA,
        knownLatencyB: mean(knownLat("B")),
        knownLatencyC: latC,
        /** Section C minus Section A (negative = got faster at known events). */
        knownLatencyChange: latA !== null && latC !== null ? latC - latA : null,
        falseAlarmRateA: faA,
        falseAlarmRateC: faC,
        falseAlarmChange: faA !== null && faC !== null ? faC - faA : null,
        stopsAtObstacles: log.filter((e) => e.type === "help_request").length,
        stopResponseSeconds: mean(stopResponses)
    };
    // --- stress: concurrent demands, team downtime, side task under load ----------------
    // Concurrent: when a UGV detects an obstacle that needs the operator, the other UGV is stopped (waiting or stuck).
    const lat = (x) => latencyOf(x);
    const other = (r) => (r === "UGV1" ? "UGV2" : "UGV1");
    const conc = needs.filter((x) => isStopped(stateAt(other(x.def.robotId), x.arr.t))).map(lat).filter((v) => v !== null);
    const single = needs.filter((x) => !isStopped(stateAt(other(x.def.robotId), x.arr.t))).map(lat).filter((v) => v !== null);
    // Team downtime: seconds a UGV spent in Help requested, waiting for the operator.
    const waits = [];
    for (const r of ["UGV1", "UGV2"]) {
        const tl = timeline[r];
        for (let i = 0; i < tl.length; i++)
            if (tl[i].state === "help_requested")
                waits.push((tl[i + 1]?.t ?? endT) - tl[i].t);
    }
    // Spot Report: images that appeared while either UGV had an obstacle in view (yellow, stopped or stuck: load) vs not (quiet).
    const answers = new Map(log.filter((e) => e.type === "spot_report").map((e) => [e.imageId, e]));
    const loadSplit = { load: [], quiet: [], loadRt: [], quietRt: [], loadMissed: 0, quietMissed: 0 };
    for (const o of log.filter((e) => e.type === "spot_report_onset")) {
        const busy = (x) => x.state === "processing" || isStopped(x);
        const underLoad = busy(stateAt("UGV1", o.t)) || busy(stateAt("UGV2", o.t));
        const ans = answers.get(o.imageId);
        if (!ans) {
            if (underLoad)
                loadSplit.loadMissed++;
            else
                loadSplit.quietMissed++;
            continue;
        }
        (underLoad ? loadSplit.load : loadSplit.quiet).push(ans.correctItems / 2);
        (underLoad ? loadSplit.loadRt : loadSplit.quietRt).push(ans.rtSeconds);
    }
    const accLoad = mean(loadSplit.load);
    const accQuiet = mean(loadSplit.quiet);
    const allKnown = knownLat();
    const stress = {
        concurrentEvents: conc.length,
        concurrentLatency: mean(conc),
        singleLatency: mean(single),
        /** Extra seconds to act when the other UGV is also stopped (positive = slower under double demand). */
        concurrencyCost: mean(conc) !== null && mean(single) !== null ? mean(conc) - mean(single) : null,
        helpWaitSecondsTotal: waits.reduce((a, b) => a + b, 0),
        helpWaitSecondsMax: waits.length ? Math.max(...waits) : 0,
        spotAccuracyUnderLoad: accLoad,
        spotAccuracyQuiet: accQuiet,
        /** Quiet minus under-load accuracy (positive = the side task suffered while vehicles needed attention). */
        spotLoadCost: accLoad !== null && accQuiet !== null ? accQuiet - accLoad : null,
        spotRtUnderLoad: mean(loadSplit.loadRt),
        spotRtQuiet: mean(loadSplit.quietRt),
        spotMissedUnderLoad: loadSplit.loadMissed,
        spotMissedQuiet: loadSplit.quietMissed,
        /** Spread of the latencies to known operator-needed events (lower = steadier). */
        knownLatencySd: sd(allKnown)
    };
    return { novel, uncertain, stress };
}
