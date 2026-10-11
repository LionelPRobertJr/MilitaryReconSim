// The participant-session log: ONE append-only stream per participant that
// holds every shell event (consent, stages, questionnaires, focus, uploads)
// and every simulation event (tutorial and mission), in the order they
// happened. This is the session's events.jsonl (Study 2 brief section 10).
//
// Every line carries an envelope added at the moment the event is recorded:
//   seq     1, 2, 3 ... strictly increasing, never reused (also across a reload)
//   ts      session seconds since the log began; monotonic, survives a reload
//   wall    wall-clock ISO time
//   stage   the participant-flow stage it happened in (e.g. "mission")
//   attempt 1 for the first run of that stage, 2+ when a reload restarted it
//   src     "shell" or "sim" (an engine event, written by the engine and only stamped here)
// Simulation events keep their own `t` (simulation seconds); shell events get
// t = ts so every line has a `t`. The engine's own log is not changed, so the
// simulation's golden logs stay byte-identical.
export const PARTICIPANT_LOG_SCHEMA_VERSION = 1;
export const browserClocks = {
    mono: () => performance.now(),
    wall: () => Date.now()
};
/** Fields the log adds to every event; an event must not carry its own. */
export const ENVELOPE_KEYS = ["seq", "ts", "wall", "stage", "attempt", "src"];
const round3 = (x) => Math.round(x * 1000) / 1000;
export class SessionLog {
    clocks;
    events;
    listeners = [];
    mono0;
    /** Session seconds at mono0. */
    base;
    stage;
    attempt;
    constructor(clocks = browserClocks, restored) {
        this.clocks = clocks;
        this.mono0 = clocks.mono();
        this.events = restored ? [...restored.events] : [];
        this.stage = restored?.stage ?? "start";
        this.attempt = restored?.attempt ?? 1;
        const last = this.events.at(-1);
        // After a reload performance.now() starts again from zero, so carry on from the last
        // stamp plus the wall-clock time that passed (never negative: ts stays monotonic).
        this.base = last ? last.ts + Math.max(0, (clocks.wall() - Date.parse(last.wall)) / 1000) : 0;
    }
    /** Session seconds (monotonic). */
    now() {
        const ts = round3(this.base + (this.clocks.mono() - this.mono0) / 1000);
        const last = this.events.at(-1);
        return last && ts < last.ts ? last.ts : ts;
    }
    envelope(src) {
        return {
            seq: (this.events.at(-1)?.seq ?? 0) + 1,
            ts: this.now(),
            wall: new Date(this.clocks.wall()).toISOString(),
            stage: this.stage,
            attempt: this.attempt,
            src
        };
    }
    push(e) {
        this.events.push(e);
        for (const fn of this.listeners)
            fn(e);
        return e;
    }
    /** Records a shell event (t defaults to the session time). */
    record(event) {
        for (const k of ENVELOPE_KEYS)
            if (k in event)
                throw new Error(`event field "${k}" clashes with the session-log envelope (${event.type})`);
        const env = this.envelope("shell");
        return this.push({ ...env, ...event, t: event.t ?? env.ts });
    }
    /**
     * Forwards every event the engine records from now on, as it is recorded.
     * The engine's event keeps its own fields (including `t`, simulation seconds);
     * a field name clash with the envelope is a programming error.
     */
    attachEngine(logger) {
        return logger.subscribe((e) => this.recordSim(e));
    }
    /** Adds one simulation event (attachEngine does this for every event; also used after a replay). */
    recordSim(e) {
        for (const k of ENVELOPE_KEYS)
            if (k in e)
                throw new Error(`simulation event field "${k}" clashes with the session-log envelope`);
        return this.push({ ...this.envelope("sim"), ...e });
    }
    /** Events recorded from now on are stamped with this stage and attempt. */
    setStage(stage, attempt) {
        this.stage = stage;
        this.attempt = attempt;
    }
    onRecord(fn) {
        this.listeners.push(fn);
    }
    all() {
        return this.events;
    }
    toJSONL() {
        return this.events.map((e) => JSON.stringify(e)).join("\n");
    }
    serialize() {
        return { events: [...this.events], stage: this.stage, attempt: this.attempt };
    }
}
/** The simulation events of one stage attempt, without the envelope: what the engine itself logged. */
export function simEventsOf(events, stage, attempt) {
    return events
        .filter((e) => e.src === "sim" && e.stage === stage && (attempt === undefined || e.attempt === attempt))
        .map(({ seq: _s, ts: _t, wall: _w, stage: _st, attempt: _a, src: _src, ...rest }) => rest);
}
