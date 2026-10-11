/**
 * Builds a full session's worth of stimulus onset times from a single seeded
 * stream (same reproducibility contract as buildFaultSchedule in
 * simulation.ts: identical sessionSeed => identical schedule, independent of
 * robotCount or anything else about the run). Onsets are jittered uniformly
 * within [minIntervalSeconds, maxIntervalSeconds] rather than a fixed
 * cadence - a predictable stimulus could be anticipated, which would defeat
 * the point of using it to measure spare attentional capacity.
 *
 * @param firstStimulusMinDelaySeconds Floor applied to the first onset only
 * (see SimConfig.drtFirstStimulusMinDelaySeconds's doc comment for why) -
 * every subsequent onset is untouched, still just the plain jittered draw
 * above. Only ever pushes the first onset later than the natural draw, never
 * earlier, so passing 0 reproduces the original unconditional-jitter
 * behavior exactly.
 */
export function buildDrtSchedule(rng, sessionLengthSeconds, minIntervalSeconds, maxIntervalSeconds, firstStimulusMinDelaySeconds = 0) {
    const schedule = [];
    const span = Math.max(0, maxIntervalSeconds - minIntervalSeconds);
    let t = 0;
    let first = true;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        t += minIntervalSeconds + rng() * span;
        if (first) {
            t = Math.max(t, firstStimulusMinDelaySeconds);
            first = false;
        }
        if (t >= sessionLengthSeconds)
            break;
        schedule.push({ t });
    }
    return schedule;
}
export function initialDrtState() {
    return {
        activeStimulusId: null,
        activeStimulusOnsetAt: null,
        hits: 0,
        misses: 0,
        lastResponseSeconds: null,
        lastResponseAt: null,
        lastMissedAt: null,
        consecutiveMisses: 0,
        powerLoss: false,
        powerLossSince: null,
        powerLossRecoveryUntil: null,
        lastResponseWasRecovery: false,
        lastRestoredAt: null
    };
}
const mean = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export class DrtInstrument {
    host;
    onPowerRestored;
    schedule = [];
    scheduleIndex = 0;
    idCounter = 0;
    constructor(host, onPowerRestored) {
        this.host = host;
        this.onPowerRestored = onPowerRestored;
    }
    get world() {
        return this.host.world;
    }
    get config() {
        return this.host.config;
    }
    /** Startup step "drt.schedule": a single session-wide schedule keyed only by the session seed. */
    buildSchedule() {
        this.schedule = this.config.drtEnabled
            ? buildDrtSchedule(this.host.stream("drt-onset"), this.config.sessionLengthSeconds, this.config.drtMinIntervalSeconds, this.config.drtMaxIntervalSeconds, this.config.drtFirstStimulusMinDelaySeconds)
            : [];
        this.host.record({ t: 0, type: "drt_schedule", onsets: this.schedule.map((s) => s.t) });
    }
    // Deliberately simple: one stimulus can be active at a time, session-wide
    // (not per-robot), and there is exactly one valid response ("drt_respond",
    // the operator noticed it). Runs only while the engine's step() runs, so it
    // pauses automatically once the session has ended.
    /** Tick phase "drt.trigger". */
    trigger() {
        if (!this.config.drtEnabled)
            return;
        if (this.world.drt.activeStimulusId !== null)
            return; // one at a time
        if (this.world.drt.powerLoss) {
            // Already acknowledged - the operator is just waiting out the
            // drtPowerLossRecoveryDelaySeconds penalty (checkPowerLossRecovery
            // below), so there's nothing new to respond to yet.
            if (this.world.drt.powerLossRecoveryUntil !== null)
                return;
            // Fleet is down: keep offering an immediate recovery ping rather than
            // waiting for the next scheduled slot, which could be arbitrarily far
            // off - the whole point of the lockout is that the operator can clear
            // it right away by responding.
            this.beginStimulus(true);
            return;
        }
        if (this.scheduleIndex >= this.schedule.length)
            return;
        const next = this.schedule[this.scheduleIndex];
        if (this.world.simTime < next.t)
            return;
        this.scheduleIndex += 1;
        this.beginStimulus(false);
    }
    beginStimulus(recovery) {
        this.idCounter += 1;
        const id = `drt-${this.idCounter}`;
        this.world.drt.activeStimulusId = id;
        this.world.drt.activeStimulusOnsetAt = this.world.simTime;
        this.host.record({ t: this.world.simTime, type: "drt_stimulus_onset", stimulusId: id, recovery });
    }
    /** Tick phase "drt.timeout". Looks ahead by dt (the tick's end time), so a window that closes mid-tick is caught on the tick it actually closes. */
    checkTimeout(dt) {
        const { activeStimulusId, activeStimulusOnsetAt } = this.world.drt;
        if (activeStimulusId === null || activeStimulusOnsetAt === null)
            return;
        if (this.world.simTime + dt < activeStimulusOnsetAt + this.config.drtResponseWindowSeconds)
            return;
        this.host.record({ t: this.world.simTime, type: "drt_missed", stimulusId: activeStimulusId, recovery: this.world.drt.powerLoss });
        this.world.drt.misses += 1;
        this.world.drt.lastMissedAt = this.world.simTime;
        this.world.drt.activeStimulusId = null;
        this.world.drt.activeStimulusOnsetAt = null;
        this.world.drt.consecutiveMisses += 1;
        if (!this.world.drt.powerLoss &&
            this.config.drtPowerLossEnabled &&
            this.world.drt.consecutiveMisses >= this.config.drtPowerLossMissThreshold) {
            this.world.drt.powerLoss = true;
            this.world.drt.powerLossSince = this.world.simTime;
            this.host.record({ t: this.world.simTime, type: "power_loss_started", consecutiveMisses: this.world.drt.consecutiveMisses });
        }
    }
    /** Core command "drt_respond". A response with no active stimulus (too late, or an extra press) is ignored, not penalized. */
    respond() {
        const { activeStimulusId, activeStimulusOnsetAt } = this.world.drt;
        if (activeStimulusId === null || activeStimulusOnsetAt === null)
            return;
        const rt = this.world.simTime - activeStimulusOnsetAt;
        const wasPowerLoss = this.world.drt.powerLoss;
        this.host.record({ t: this.world.simTime, type: "drt_response", stimulusId: activeStimulusId, rtSeconds: rt, recovery: wasPowerLoss });
        this.world.drt.hits += 1;
        this.world.drt.consecutiveMisses = 0;
        this.world.drt.lastResponseSeconds = rt;
        this.world.drt.lastResponseAt = this.world.simTime;
        this.world.drt.lastResponseWasRecovery = wasPowerLoss;
        this.world.drt.activeStimulusId = null;
        this.world.drt.activeStimulusOnsetAt = null;
        if (wasPowerLoss) {
            // Landing the recovery hit doesn't clear the outage instantly - it
            // starts a drtPowerLossRecoveryDelaySeconds countdown that
            // checkPowerLossRecovery resolves once it elapses. powerLoss stays true
            // for that whole window.
            this.world.drt.powerLossRecoveryUntil = this.world.simTime + this.config.drtPowerLossRecoveryDelaySeconds;
        }
    }
    /** Tick phase "drt.powerLossRecovery". Same tick's-end-time lookahead as checkTimeout. */
    checkPowerLossRecovery(dt) {
        const until = this.world.drt.powerLossRecoveryUntil;
        if (until === null)
            return;
        if (this.world.simTime + dt < until)
            return;
        const downtimeSeconds = this.world.simTime - (this.world.drt.powerLossSince ?? this.world.simTime);
        this.world.drt.powerLoss = false;
        this.world.drt.powerLossSince = null;
        this.world.drt.powerLossRecoveryUntil = null;
        this.world.drt.lastRestoredAt = this.world.simTime;
        // The pack decides what the outage meant for its robots (Moon Base shifts
        // every in-progress task's phaseStartedAt by downtimeSeconds, so frozen
        // robots resume as if no time passed). downtimeSeconds spans the whole
        // outage, acknowledgment delay included.
        this.onPowerRestored(downtimeSeconds);
        this.host.record({ t: this.world.simTime, type: "power_loss_restored", downtimeSeconds });
    }
    /**
     * Summary metrics, in summary.json key order. drtStimuliCount is 0 whenever
     * drtEnabled was false, which is how "didn't run" is told apart from "ran
     * with a 0% miss rate"; same for the power-loss counts.
     */
    metrics() {
        const events = this.host.allEvents();
        const drtStimuliCount = events.filter((e) => e.type === "drt_stimulus_onset").length;
        const responses = events.filter((e) => e.type === "drt_response");
        const drtHits = responses.length;
        const drtMisses = events.filter((e) => e.type === "drt_missed").length;
        const powerLossCount = events.filter((e) => e.type === "power_loss_started").length;
        let totalPowerLossSeconds = 0;
        for (const e of events)
            if (e.type === "power_loss_restored")
                totalPowerLossSeconds += e.downtimeSeconds;
        return {
            drtStimuliCount,
            drtHits,
            drtMisses,
            drtMissRate: drtStimuliCount > 0 ? drtMisses / drtStimuliCount : 0,
            drtMeanResponseSeconds: mean(responses.map((e) => e.rtSeconds)),
            powerLossCount,
            totalPowerLossSeconds
        };
    }
}
