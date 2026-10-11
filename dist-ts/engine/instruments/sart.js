/**
 * Builds a full session's worth of fixed-interval onset times: one at
 * intervalSeconds, another at 2*intervalSeconds, and so on up to (not
 * including) sessionLengthSeconds. Deliberately a plain fixed cadence, not
 * jittered like buildDrtSchedule - see SimConfig.sartIntervalSeconds's doc
 * comment for why (this is a self-report instrument, not a reaction-time
 * probe, so there's no anticipation effect to guard against, and a fixed
 * cadence is easier for a researcher to document/reproduce). No rng
 * parameter as a result; still its own function/module rather than inlined
 * into simulation.ts; for the same reason drt.ts/resourceId.ts are:
 * independently testable, and parallel in shape to the schedules beside it.
 */
export function buildSartSchedule(sessionLengthSeconds, intervalSeconds) {
    const schedule = [];
    if (intervalSeconds <= 0)
        return schedule;
    let t = intervalSeconds;
    while (t < sessionLengthSeconds) {
        schedule.push({ t });
        t += intervalSeconds;
    }
    return schedule;
}
export function initialSartState() {
    return {
        activeCheckId: null,
        activeCheckOnsetAt: null,
        submittedCount: 0,
        lastSubmittedAt: null,
        lastDemand: null,
        lastSupply: null,
        lastUnderstanding: null,
        lastSituationAwarenessIndex: null
    };
}
const mean = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export class SartInstrument {
    host;
    schedule = [];
    scheduleIndex = 0;
    idCounter = 0;
    constructor(host) {
        this.host = host;
    }
    get world() {
        return this.host.world;
    }
    get config() {
        return this.host.config;
    }
    /** Startup step "sart.schedule": a plain fixed cadence, so no RNG stream. */
    buildSchedule() {
        this.schedule = this.config.sartEnabled ? buildSartSchedule(this.config.sessionLengthSeconds, this.config.sartIntervalSeconds) : [];
        this.host.record({ t: 0, type: "sart_schedule", onsets: this.schedule.map((s) => s.t) });
    }
    /** Tick phase "sart.trigger". No timeout: a check stays active until submitted, and the session clock keeps running. */
    trigger() {
        if (!this.config.sartEnabled)
            return;
        if (this.world.sart.activeCheckId !== null)
            return; // one at a time
        if (this.scheduleIndex >= this.schedule.length)
            return;
        const next = this.schedule[this.scheduleIndex];
        if (this.world.simTime < next.t)
            return;
        this.scheduleIndex += 1;
        this.idCounter += 1;
        const id = `sart-${this.idCounter}`;
        this.world.sart.activeCheckId = id;
        this.world.sart.activeCheckOnsetAt = this.world.simTime;
        this.host.record({ t: this.world.simTime, type: "sart_check_onset", checkId: id });
    }
    /** Clamps a rating to the instrument's 1-7 integer range, so a stray value can never corrupt the index or summary stats. */
    clampRating(value) {
        if (!Number.isFinite(value))
            return 1;
        return Math.min(7, Math.max(1, Math.round(value)));
    }
    /** Core command "sart_submit". A submit with no active check is ignored. */
    submit(statusReport, demand, supply, understanding) {
        const { activeCheckId, activeCheckOnsetAt } = this.world.sart;
        if (activeCheckId === null || activeCheckOnsetAt === null)
            return;
        const rt = this.world.simTime - activeCheckOnsetAt;
        const clampedDemand = this.clampRating(demand);
        const clampedSupply = this.clampRating(supply);
        const clampedUnderstanding = this.clampRating(understanding);
        // Standard 3D-SART combination rule: SA = Understanding - (Demand - Supply).
        const situationAwarenessIndex = clampedUnderstanding - (clampedDemand - clampedSupply);
        this.host.record({
            t: this.world.simTime,
            type: "sart_response",
            checkId: activeCheckId,
            rtSeconds: rt,
            statusReport,
            demand: clampedDemand,
            supply: clampedSupply,
            understanding: clampedUnderstanding,
            situationAwarenessIndex
        });
        this.world.sart.submittedCount += 1;
        this.world.sart.lastSubmittedAt = this.world.simTime;
        this.world.sart.lastDemand = clampedDemand;
        this.world.sart.lastSupply = clampedSupply;
        this.world.sart.lastUnderstanding = clampedUnderstanding;
        this.world.sart.lastSituationAwarenessIndex = situationAwarenessIndex;
        this.world.sart.activeCheckId = null;
        this.world.sart.activeCheckOnsetAt = null;
    }
    /** Summary metrics, in summary.json key order. sartChecksShown is 0 whenever sartEnabled was false. */
    metrics() {
        const events = this.host.allEvents();
        const sartChecksShown = events.filter((e) => e.type === "sart_check_onset").length;
        const responses = events.filter((e) => e.type === "sart_response");
        return {
            sartChecksShown,
            sartChecksSubmitted: responses.length,
            sartMeanResponseSeconds: mean(responses.map((e) => e.rtSeconds)),
            sartMeanDemand: mean(responses.map((e) => e.demand)),
            sartMeanSupply: mean(responses.map((e) => e.supply)),
            sartMeanUnderstanding: mean(responses.map((e) => e.understanding)),
            sartMeanIndex: mean(responses.map((e) => e.situationAwarenessIndex)),
            // Every submitted free-text report in full, so a researcher can read them from summary.json directly.
            sartStatusReports: responses.map((e) => ({ t: e.t, text: e.statusReport }))
        };
    }
}
