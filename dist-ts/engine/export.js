/** Builds the three per-session export files (events.jsonl, summary.json, metrics.csv). */
export function buildSessionExport(sim) {
    const summary = sim.summary();
    const eventsJsonl = sim.logger.toJSONL();
    const summaryJson = JSON.stringify(summary, null, 2);
    // sessionFeedback (free text) is deliberately excluded from the flat CSV
    // the same way workloadRating is - it's qualitative, multi-line, and can
    // contain commas/quotes, so it doesn't belong crammed into a single CSV
    // cell alongside the quantitative metrics. It's still fully present in
    // summaryJson/eventsJsonl above; a pilot-study reviewer reads the survey
    // text there rather than in the spreadsheet of per-trial numbers.
    // sartStatusReports (an array of {t, text}, potentially many per session)
    // is excluded for the same reason - the quantitative SART fields
    // (sartMeanDemand/Supply/Understanding/Index, sartChecksShown/Submitted,
    // sartMeanResponseSeconds) are plain numbers, so they stay in flatKeys and
    // do land in the CSV same as any other metric.
    // Which keys are excluded is decided by the engine (shared keys) plus the
    // pack (e.g. Moon Base's perRobotTimeTotals) - see Engine.csvExcludedKeys().
    const excluded = new Set(sim.csvExcludedKeys());
    const flatKeys = Object.keys(summary).filter((k) => !excluded.has(k));
    // Score-breakdown columns follow the pack's own scoreBreakdown key order.
    const breakdown = (summary.scoreBreakdown ?? {});
    const breakdownKeys = Object.keys(breakdown);
    const header = [...flatKeys, ...breakdownKeys, "workloadMean", "feedbackProvided"];
    const workloadRating = summary.workloadRating;
    const sessionFeedback = summary.sessionFeedback;
    const row = [
        ...flatKeys.map((k) => JSON.stringify(summary[k])),
        ...breakdownKeys.map((k) => breakdown[k]),
        workloadRating ? workloadRating.mean : "",
        sessionFeedback ? "true" : "false"
    ];
    const metricsCsv = `${header.join(",")}\n${row.join(",")}`;
    return { eventsJsonl, summaryJson, metricsCsv };
}
