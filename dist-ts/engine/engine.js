import { hashConfig, mergeConfig } from "./config.js";
import { createStream } from "./rng.js";
import { EventLogger, LOG_SCHEMA_VERSION } from "./events.js";
import { isCoreCommand } from "./commands.js";
import { DrtInstrument } from "./instruments/drt.js";
import { SartInstrument } from "./instruments/sart.js";
import { INSTRUMENT_STARTUP_STEPS, INSTRUMENT_TICK_PHASES } from "./pack.js";
/** Version of the shared engine; logged in every session_start and summary.json. Bump on any engine change that could affect timing, logging or measurement. */
export const ENGINE_VERSION = "1.0.0";
/** Summary keys that hold nested or free-text data and so never go into metrics.csv, for every pack. */
export const CORE_CSV_EXCLUDED_KEYS = ["config", "scoreBreakdown", "workloadRating", "sessionFeedback", "sartStatusReports"];
/**
 * The shared, deterministic, headless simulation engine (Study 2 brief
 * section 12: "Simulation core", "Command layer", "Config", "Logger"). No
 * rendering or DOM access happens here, and nothing here knows which
 * scenario pack is running.
 *
 * Given the same pack, config/seed and the same sequence of enqueueCommand
 * calls at the same simulation times, step() produces byte-identical event
 * logs regardless of how often step() itself is called.
 */
export class Engine {
    /**
     * The simulation always advances in ticks of this size, regardless of the
     * render/animation frame rate ("Simulation time advances by fixed steps;
     * the renderer interpolates"). UI code should call advanceRealTime() every
     * animation frame, never step() with a variable dt, or determinism across
     * frame rates is lost.
     */
    static FIXED_DT = 0.1;
    config;
    logger = new EventLogger();
    cosmeticRng;
    pack;
    world;
    session;
    drt;
    sart;
    /** Commands wait here until their executeAt (config.commandDelaySeconds) arrives - see enqueueCommand/drainCommands. */
    pendingCommands = [];
    /**
     * Periodic deep clones of world, kept only while config.videoDelaySeconds
     * is set, so displayedSnapshot() can hand the UI a state from
     * videoDelaySeconds in the past (simulated downlink delay). Appended once
     * per tick in step(), trimmed back to just enough history to answer the
     * oldest lookup that could still be asked for. Empty (and untouched)
     * whenever videoDelaySeconds is 0.
     */
    videoHistory = [];
    ended = false;
    /** Non-null while a pack-requested pause (e.g. an in-mission probe questionnaire) is in effect. Simulation time does not advance, so paused time is excluded from mission timing by construction. */
    pausedFor = null;
    accumulator = 0;
    /** Echoed into summary()/exports so a summary.json is self-contained. */
    participantId;
    condition;
    constructor(pack, options = {}) {
        this.pack = pack;
        this.config = mergeConfig(pack.defaultConfig, options.config);
        if (this.config.domain !== pack.id) {
            throw new Error(`config.domain "${this.config.domain}" does not match scenario pack "${pack.id}"`);
        }
        this.participantId = options.participantId ?? "unknown";
        this.condition = options.condition ?? pack.defaultCondition(this.config);
        this.cosmeticRng = createStream(this.config.seed, "cosmetic");
        this.world = pack.createWorld(this.config);
        const host = {
            config: this.config,
            world: this.world,
            record: (e) => this.logger.record(e),
            allEvents: () => this.logger.all(),
            stream: (tag) => createStream(this.config.seed, tag)
        };
        this.drt = new DrtInstrument(host, (downtime) => this.session.onPowerRestored?.(downtime));
        this.sart = new SartInstrument(host);
        const ctx = {
            config: this.config,
            world: this.world,
            logger: this.logger,
            stream: host.stream,
            endSession: (reason) => this.endSession(reason),
            isEnded: () => this.ended,
            requestPause: (reason) => this.requestPause(reason),
            drt: this.drt,
            sart: this.sart
        };
        this.session = pack.createSession(ctx);
        validateSteps(pack.id, this.session);
        this.logger.record({
            t: 0,
            type: "session_start",
            schemaVersion: LOG_SCHEMA_VERSION,
            domain: this.pack.id,
            packVersion: this.pack.version,
            engineVersion: ENGINE_VERSION,
            configHash: hashConfig(this.config),
            seed: this.config.seed,
            ...this.session.sessionStartFields(),
            participantId: this.participantId,
            condition: this.condition
        });
        for (const step of this.session.startup) {
            if (step === "drt.schedule")
                this.drt.buildSchedule();
            else if (step === "sart.schedule")
                this.sart.buildSchedule();
            else
                step();
        }
    }
    /** Read-only snapshot of world state, safe for the UI to hold across frames. */
    snapshot() {
        return structuredClone(this.world);
    }
    /**
     * Read-only snapshot of world state AS THE OPERATOR WOULD CURRENTLY SEE IT
     * - lagged behind the true state by config.videoDelaySeconds (simulated
     * downlink delay). Identical to snapshot() whenever videoDelaySeconds is 0.
     */
    displayedSnapshot() {
        if (this.config.videoDelaySeconds <= 0 || this.videoHistory.length === 0) {
            return this.snapshot();
        }
        const targetT = Math.max(0, this.world.simTime - this.config.videoDelaySeconds);
        // videoHistory is append-only and time-ordered (oldest first); walk
        // forward for the freshest entry that is still old enough. During the
        // first videoDelaySeconds of a session every entry is newer than
        // targetT, so fall back to the oldest one we have.
        let chosen = this.videoHistory[0];
        for (const entry of this.videoHistory) {
            if (entry.t > targetT)
                break;
            chosen = entry;
        }
        return structuredClone(chosen.world);
    }
    isEnded() {
        return this.ended;
    }
    /**
     * Queues a command for the next tick. Robot-directed pack commands
     * (ScenarioSession.isDelayedCommand) are held for config.commandDelaySeconds
     * first, simulating uplink transit; core commands (drt_respond, sart_submit,
     * end_session) are never delayed - they are the operator's own console-side
     * actions, and delaying the DRT would confound the workload probe with the
     * manipulation.
     */
    enqueueCommand(cmd) {
        const delay = !isCoreCommand(cmd) && this.session.isDelayedCommand(cmd) ? this.config.commandDelaySeconds : 0;
        const executeAt = this.world.simTime + delay;
        this.pendingCommands.push({ cmd, executeAt });
        if (delay > 0 && "robotId" in cmd) {
            this.logger.record({ t: this.world.simTime, type: "command_queued", kind: cmd.kind, robotId: String(cmd.robotId), executeAt });
        }
    }
    /** UI-originated events that the engine does not itself generate (camera, menus, reference panels). */
    logPlayerAction(action, detail) {
        this.logger.record({ t: this.world.simTime, type: "player_action", action, detail });
    }
    /**
     * Records the post-session NASA-TLX workload rating. Deliberately NOT
     * routed through enqueueCommand()/step(): it is collected after the session
     * has ended, when step() no longer runs and would never drain a queued
     * command. Writes straight to the log instead.
     */
    recordWorkloadRating(ratings) {
        const { mentalDemand, physicalDemand, temporalDemand, performance, effort, frustration } = ratings;
        const mean = (mentalDemand + physicalDemand + temporalDemand + performance + effort + frustration) / 6;
        this.logger.record({ t: this.world.simTime, type: "workload_rating", mentalDemand, physicalDemand, temporalDemand, performance, effort, frustration, mean });
    }
    /** Records the free-text post-session feedback; not a command, for the same reason as recordWorkloadRating. */
    recordSessionFeedback(feedback) {
        const { wentRight, wentWrong, recommendations } = feedback;
        this.logger.record({ t: this.world.simTime, type: "session_feedback", wentRight, wentWrong, recommendations });
    }
    /**
     * Accumulator-driven real-time entry point: call once per animation frame
     * with the actual elapsed wall-clock seconds. Always advances in FIXED_DT
     * ticks, so the number of ticks per call varies with the frame rate but
     * every individual tick is identical.
     */
    advanceRealTime(realDtSeconds) {
        if (this.ended || this.pausedFor !== null)
            return;
        this.accumulator += realDtSeconds;
        while (this.accumulator >= Engine.FIXED_DT) {
            this.step(Engine.FIXED_DT);
            this.accumulator -= Engine.FIXED_DT;
            if (this.ended)
                break;
            if (this.pausedFor !== null) {
                // Drop the rest of this frame's time: nothing that happens in real
                // time while paused (or in the frame that triggered it) counts.
                this.accumulator = 0;
                break;
            }
        }
    }
    /** Why the simulation is paused (e.g. "probe_1"), or null when running. */
    pausedReason() {
        return this.pausedFor;
    }
    /**
     * Starts a pause. Called by a pack (via EngineContext.requestPause) from
     * inside a tick - e.g. Recon's probe after a section line - so the current
     * tick finishes and no further tick runs until resume(). Ignored if
     * already paused or ended.
     */
    requestPause(reason) {
        if (this.pausedFor !== null || this.ended)
            return;
        this.pausedFor = reason;
        this.logger.record({ t: this.world.simTime, type: "pause_start", reason });
    }
    /** Ends the current pause (the UI calls this when the probe is submitted). No-op when not paused. */
    resume() {
        if (this.pausedFor === null)
            return;
        const reason = this.pausedFor;
        this.pausedFor = null;
        this.accumulator = 0;
        this.logger.record({ t: this.world.simTime, type: "pause_end", reason });
    }
    /** Advances the simulation by exactly one tick. Prefer advanceRealTime() from UI code. */
    step(dtSeconds) {
        if (this.ended || this.pausedFor !== null)
            return;
        this.drainCommands();
        // The pack's systems and the engine's instrument phases, in the order the
        // pack declared (validated in the constructor). If a system ends the
        // session mid-tick, the rest of the tick still runs, as it always has.
        for (const system of this.session.tick) {
            switch (system) {
                case "drt.trigger":
                    this.drt.trigger();
                    break;
                case "drt.timeout":
                    this.drt.checkTimeout(dtSeconds);
                    break;
                case "drt.powerLossRecovery":
                    this.drt.checkPowerLossRecovery(dtSeconds);
                    break;
                case "sart.trigger":
                    this.sart.trigger();
                    break;
                default:
                    system(dtSeconds);
            }
        }
        this.world.simTime += dtSeconds;
        if (this.config.videoDelaySeconds > 0) {
            this.pushVideoHistory();
        }
        if (this.world.simTime >= this.config.sessionLengthSeconds && this.world.phase === "running") {
            this.endSession("timer_expired");
        }
    }
    pushVideoHistory() {
        this.videoHistory.push({ t: this.world.simTime, world: structuredClone(this.world) });
        // Keep one entry at-or-before the oldest timestamp displayedSnapshot()
        // could still be asked for, plus everything newer.
        const cutoff = this.world.simTime - this.config.videoDelaySeconds - Engine.FIXED_DT;
        while (this.videoHistory.length > 1 && this.videoHistory[1].t <= cutoff) {
            this.videoHistory.shift();
        }
    }
    /**
     * Applies only commands whose executeAt has arrived, in their existing
     * queue order, leaving the rest for a later tick.
     */
    drainCommands() {
        const ready = [];
        const stillPending = [];
        for (const pending of this.pendingCommands) {
            if (pending.executeAt <= this.world.simTime)
                ready.push(pending.cmd);
            else
                stillPending.push(pending);
        }
        this.pendingCommands = stillPending;
        for (const cmd of ready) {
            this.applyCommand(cmd);
        }
    }
    applyCommand(cmd) {
        if (this.world.phase !== "running")
            return;
        if (isCoreCommand(cmd)) {
            switch (cmd.kind) {
                case "end_session":
                    this.endSession(cmd.reason);
                    break;
                case "drt_respond":
                    this.drt.respond();
                    break;
                case "sart_submit":
                    this.sart.submit(cmd.statusReport, cmd.demand, cmd.supply, cmd.understanding);
                    break;
            }
            return;
        }
        this.session.applyCommand(cmd);
    }
    endSession(reason) {
        if (this.ended)
            return;
        this.ended = true;
        this.world.phase = "ended";
        this.logger.record({ t: this.world.simTime, type: "session_end", reason });
    }
    /** Per-session summary (summary.json); the pack decides key placement of the shared parts. */
    summary() {
        const events = this.logger.all();
        const workloadEvent = [...events].reverse().find((e) => e.type === "workload_rating");
        const feedbackEvent = [...events].reverse().find((e) => e.type === "session_feedback");
        const core = {
            header: {
                schemaVersion: LOG_SCHEMA_VERSION,
                domain: this.pack.id,
                packVersion: this.pack.version,
                engineVersion: ENGINE_VERSION,
                configHash: hashConfig(this.config),
                config: this.config,
                participantId: this.participantId,
                condition: this.condition
            },
            drt: this.drt.metrics(),
            // At most one of each per session (last one wins); null if never collected.
            questionnaires: {
                workloadRating: workloadEvent && workloadEvent.type === "workload_rating"
                    ? {
                        mentalDemand: workloadEvent.mentalDemand,
                        physicalDemand: workloadEvent.physicalDemand,
                        temporalDemand: workloadEvent.temporalDemand,
                        performance: workloadEvent.performance,
                        effort: workloadEvent.effort,
                        frustration: workloadEvent.frustration,
                        mean: workloadEvent.mean
                    }
                    : null,
                sessionFeedback: feedbackEvent && feedbackEvent.type === "session_feedback"
                    ? { wentRight: feedbackEvent.wentRight, wentWrong: feedbackEvent.wentWrong, recommendations: feedbackEvent.recommendations }
                    : null
            },
            sart: this.sart.metrics()
        };
        return this.session.summary(core);
    }
    /** Summary keys left out of metrics.csv for this session (core + pack). */
    csvExcludedKeys() {
        return [...CORE_CSV_EXCLUDED_KEYS, ...(this.session.csvExcludedKeys ?? [])];
    }
}
function validateSteps(packId, session) {
    for (const phase of INSTRUMENT_TICK_PHASES) {
        const n = session.tick.filter((s) => s === phase).length;
        if (n !== 1)
            throw new Error(`pack "${packId}": tick list must contain instrument phase "${phase}" exactly once (found ${n})`);
    }
    for (const step of INSTRUMENT_STARTUP_STEPS) {
        const n = session.startup.filter((s) => s === step).length;
        if (n !== 1)
            throw new Error(`pack "${packId}": startup list must contain "${step}" exactly once (found ${n})`);
    }
}
