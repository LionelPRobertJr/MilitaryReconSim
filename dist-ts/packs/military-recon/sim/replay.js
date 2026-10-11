import { Engine } from "../../../engine/engine.js";
import { ReconSimulation } from "./simulation.js";
/** The operator inputs recorded in a mission (or tutorial) log, in order. */
export function inputsFromEvents(events) {
    const out = [];
    for (const raw of events) {
        const e = raw;
        switch (e.type) {
            case "operator_action":
                out.push({
                    t: e.t,
                    kind: "command",
                    cmd: { kind: "ugv_action", robotId: e.robotId, action: e.action, ...(e.action === "reroute" && e.targetEdge ? { bypassId: e.targetEdge } : {}) }
                });
                break;
            case "spot_report":
                out.push({ t: e.t, kind: "command", cmd: { kind: "spot_report_submit", imageId: e.imageId, vehicles: e.answer.vehicles, people: e.answer.people } });
                break;
            case "camera_view":
            case "robot_select":
                out.push({ t: e.t, kind: e.type, robotId: e.robotId });
                break;
            case "pause_end":
                out.push({ t: e.t, kind: "resume" });
                break;
            case "session_end":
                if (e.reason === "manual_stop")
                    out.push({ t: e.t, kind: "command", cmd: { kind: "end_session", reason: "manual_stop" } });
                break;
        }
    }
    return out;
}
const EPS = 1e-6;
/**
 * Builds a simulation and feeds it the inputs at their times. Stops at the
 * last input (or, with runToEnd, when the session ends), leaving the
 * simulation exactly where the original was after that input: a resumed
 * mission continues from there in real time.
 */
export function replay(options, inputs, opts = {}) {
    const sim = new ReconSimulation(options);
    const now = () => sim.snapshot().simTime;
    for (const input of inputs) {
        while (!sim.isEnded() && now() < input.t - EPS) {
            if (sim.pausedReason() !== null)
                throw new Error(`replay: paused (${sim.pausedReason()}) at ${now()} but the next input is at ${input.t}`);
            sim.step(Engine.FIXED_DT);
        }
        if (input.kind === "command")
            sim.enqueueCommand(input.cmd);
        else if (input.kind === "camera_view")
            sim.logCameraView(input.robotId);
        else if (input.kind === "robot_select")
            sim.logRobotSelect(input.robotId);
        else
            sim.resume();
    }
    if (opts.runToEnd) {
        const limit = opts.maxSeconds ?? sim.config.sessionLengthSeconds + 10;
        while (!sim.isEnded() && now() < limit) {
            if (sim.pausedReason() !== null)
                sim.resume();
            sim.step(Engine.FIXED_DT);
        }
    }
    return sim;
}
/**
 * Replays a logged run up to its last event and checks that the replayed log
 * matches the original line for line. Returns the simulation positioned at
 * the original's last event, or the first mismatch.
 */
export function replayAndVerify(options, events) {
    const inputs = inputsFromEvents(events);
    const sim = replay(options, inputs);
    // Run on until the replayed log is as long as the original (events after the last input, e.g. a probe pause).
    const target = events.length;
    while (sim.logger.all().length < target && !sim.isEnded() && sim.pausedReason() === null)
        sim.step(Engine.FIXED_DT);
    const got = sim.logger.all();
    for (let i = 0; i < target; i++) {
        const a = JSON.stringify(events[i]);
        const b = JSON.stringify(got[i]);
        if (a !== b)
            return { ok: false, index: i, expected: a, actual: b ?? "(missing)" };
    }
    // got may run a few events past the original (the rest of the tick it stopped in): the caller
    // adds sim.logger.all().slice(events.length) to its own log.
    return { ok: true, sim };
}
