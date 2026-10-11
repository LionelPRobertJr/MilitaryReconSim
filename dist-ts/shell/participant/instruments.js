// Shared questionnaire instruments, identical for every pack.
/**
 * NASA-TLX, raw (Hart & Staveland, 1988; NASA public-domain wording). Six
 * subscales, 0-100 in steps of 5; Performance runs from Perfect (0) to
 * Failure (100), so higher is always more workload. Raw TLX = the mean.
 */
export const TLX_ITEMS = [
    { kind: "tlx", id: "mental", text: "Mental demand", description: "How mentally demanding was the task?", low: "Very low", high: "Very high" },
    { kind: "tlx", id: "physical", text: "Physical demand", description: "How physically demanding was the task?", low: "Very low", high: "Very high" },
    { kind: "tlx", id: "temporal", text: "Temporal demand", description: "How hurried or rushed was the pace of the task?", low: "Very low", high: "Very high" },
    { kind: "tlx", id: "performance", text: "Performance", description: "How successful were you in accomplishing what you were asked to do?", low: "Perfect", high: "Failure" },
    { kind: "tlx", id: "effort", text: "Effort", description: "How hard did you have to work to accomplish your level of performance?", low: "Very low", high: "Very high" },
    { kind: "tlx", id: "frustration", text: "Frustration", description: "How insecure, discouraged, irritated, stressed, and annoyed were you?", low: "Very low", high: "Very high" }
];
export const TLX_IDS = TLX_ITEMS.map((i) => i.id);
/** Raw TLX: the unweighted mean of the six subscales. */
export function rawTlx(items) {
    const xs = TLX_IDS.map((id) => Number(items[id]));
    return xs.every((x) => Number.isFinite(x)) ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
