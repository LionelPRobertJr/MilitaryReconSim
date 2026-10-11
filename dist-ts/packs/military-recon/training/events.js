/** Summary of the measures log (brief section 10's operator-model measures). */
export function measuresSummary(events) {
    const pages = events.filter((e) => e.type === "training_page");
    const rounds = events.filter((e) => e.type === "practice_round");
    const judg = events.filter((e) => e.type === "judgment_response");
    const acc = (phase, transfer) => {
        const xs = judg.filter((e) => e.phase === phase && (transfer ? e.transfer === transfer : e.transfer !== "far"));
        return xs.length ? xs.filter((e) => e.correct).length / xs.length : null;
    };
    const meanConf = (phase) => {
        const xs = judg.filter((e) => e.phase === phase);
        return xs.length ? xs.reduce((n, e) => n + e.confidence, 0) / xs.length : null;
    };
    const comp = events.filter((e) => e.type === "comprehension_response");
    const reviews = events.filter((e) => e.type === "comprehension_review");
    return {
        moduleSeconds: pages.reduce((n, e) => n + e.dwellSeconds, 0),
        pageDwell: Object.fromEntries([...new Set(pages.map((p) => p.pageId))].map((id) => [id, pages.filter((p) => p.pageId === id).reduce((n, e) => n + e.dwellSeconds, 0)])),
        practiceRounds: rounds.length,
        practicePassed: rounds.some((r) => r.passed),
        practiceFinalCorrect: rounds.at(-1)?.correctCount ?? null,
        judgmentAccuracyPre: acc("pre"),
        judgmentAccuracyPreTrained: acc("pre", "trained"),
        judgmentAccuracyPreNear: acc("pre", "near"),
        judgmentMeanConfidencePre: meanConf("pre"),
        /** Post-mission accuracy on the same 12 cards as before the mission (trained + near). */
        judgmentAccuracyPost: acc("post"),
        judgmentAccuracyPostTrained: acc("post", "trained"),
        judgmentAccuracyPostNear: acc("post", "near"),
        /** Post-mission only: the held-back mission kinds (far transfer). */
        judgmentAccuracyPostFar: acc("post", "far"),
        judgmentMeanConfidencePost: meanConf("post"),
        comprehensionFirstAttemptCorrect: comp.filter((e) => e.answerRound === 1 && e.correct).length,
        comprehensionReviewed: reviews.length > 0,
        comprehensionFailedTwice: reviews.some((r) => r.failedAgain)
    };
}
