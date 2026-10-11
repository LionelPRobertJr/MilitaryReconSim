import { LOG_SCHEMA_VERSION } from "../../../engine/events.js";
import { ENGINE_VERSION } from "../../../engine/engine.js";
import { attentionSummary, focusSummary, lastAttempts, metricsCsv, stageSummary } from "../../../shell/participant/export.js";
import { rawTlx } from "../../../shell/participant/instruments.js";
import { PARTICIPANT_LOG_SCHEMA_VERSION, simEventsOf } from "../../../shell/participant/session-log.js";
import { adaptivePerformance } from "../sim/adaptive.js";
import { RECON_PACK_VERSION } from "../sim/pack.js";
import { measuresSummary } from "../training/events.js";
import { TEAM_ADAPT_ITEMS, bonusFor } from "./content.js";
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function reconSessionSummary({ events, missionSummary, deployment }) {
    const open = events.find((e) => e.type === "session_open");
    const assignment = [...events].reverse().find((e) => e.type === "assignment");
    const counted = lastAttempts(events);
    const shell = counted.filter((e) => e.src === "shell");
    const lastOf = (type, pred = () => true) => [...shell].reverse().find((e) => e.type === type && pred(e)) ?? null;
    // A probe spans three pages; for each item the last answer counts (a reload during a probe asks again).
    const probe = (id) => {
        const pages = shell.filter((x) => x.type === "probe_response" && x.probe === id);
        if (!pages.length)
            return null;
        const items = {};
        for (const p of pages)
            for (const [k, v] of Object.entries(p.items))
                items[k] = Number(v);
        const sub = (s) => mean(TEAM_ADAPT_ITEMS.filter((i) => i.subscale === s && i.id in items).map((i) => items[i.id]));
        const ta = TEAM_ADAPT_ITEMS.filter((i) => i.id in items).map((i) => items[i.id]);
        return {
            adaptabilityMean: ta.length === TEAM_ADAPT_ITEMS.length ? mean(ta) : null,
            adaptabilityItems: ta.length,
            create: sub("create"),
            uncertain: sub("uncertain"),
            stress: sub("stress"),
            confidence: "confidence" in items ? items.confidence : null,
            items,
            seconds: Math.round(pages.reduce((n, p) => n + p.rtSeconds, 0) * 1000) / 1000
        };
    };
    const tlxE = lastOf("tlx_response");
    const tlxItems = tlxE ? Object.fromEntries(Object.entries(tlxE.items).map(([k, v]) => [k, Number(v)])) : null;
    const manip = lastOf("manipulation_response");
    const crit = lastOf("critical_report_response");
    const exp = lastOf("experience_response");
    const score = missionSummary ? missionSummary.score : null;
    const interrupted = events.some((e) => e.type === "mission_interrupted");
    // Adaptive performance: from the counted (latest) mission attempt's simulation events; null if the mission did not finish.
    const missionAttempt = Math.max(0, ...events.filter((e) => e.stage === "mission").map((e) => e.attempt));
    const adaptive = adaptivePerformance({ sim: simEventsOf(events, "mission", missionAttempt) });
    return {
        participantLogSchemaVersion: PARTICIPANT_LOG_SCHEMA_VERSION,
        engineLogSchemaVersion: LOG_SCHEMA_VERSION,
        domain: "military_recon",
        packVersion: RECON_PACK_VERSION,
        engineVersion: ENGINE_VERSION,
        deploymentVersion: deployment.deploymentVersion,
        phase: open?.phase ?? null,
        configVersion: open?.studyConfig?.configVersion ?? null,
        configFrozen: open?.studyConfig?.frozen ?? null,
        studyId: open?.studyId ?? null,
        participantId: open?.participantId ?? null,
        sessionId: open?.sessionId ?? null,
        condition: assignment?.condition ?? null,
        seed: assignment?.seed ?? null,
        assignmentSource: assignment?.source ?? null,
        complete: events.some((e) => e.type === "session_complete"),
        resumes: events.filter((e) => e.type === "session_resumed").length,
        stages: stageSummary(events),
        mission: missionSummary,
        missionInterrupted: interrupted,
        adaptive,
        training: measuresSummary(shell),
        probe1: probe("probe_1"),
        probe2: probe("probe_2"),
        tlx: tlxItems ? { ...tlxItems, raw: rawTlx(tlxItems) } : null,
        attention: attentionSummary(counted),
        experience: exp ? exp.items : null,
        manipulationCheck: manip ? { ruleRecall: manip.items.rule_recall, novelEvent: manip.items.novel_event } : null,
        criticalReport: crit ? crit.items.critical_report : null,
        focus: focusSummary(events),
        bonus: score === null ? null : { score, amount: bonusFor(score, deployment.payment), currency: deployment.payment.currency },
        deployment
    };
}
/** Keys left out of metrics.csv: free text, nested config, per-event detail (all still in summary.json). */
export const RECON_CSV_EXCLUDED = ["mission.config", "mission.criticalEvent", "manipulationCheck", "criticalReport", "deployment", "training.pageDwell"];
export function reconMetricsCsv(summary) {
    return metricsCsv(summary, RECON_CSV_EXCLUDED);
}
