// Word counts and Flesch-Kincaid grade for the C3/C4 matching checks (brief
// section 7: word count within 5%, FK grade within one level). A standard
// vowel-group syllable heuristic; the same function scores both modules, so
// any bias cancels in the comparison.
export function words(text) {
    return text.match(/[A-Za-z][A-Za-z'-]*|\d+/g) ?? [];
}
export function wordCount(text) {
    return words(text).length;
}
export function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length <= 3)
        return 1;
    const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = trimmed.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
}
export function sentenceCount(text) {
    const parts = text.split(/[.!?]+(?:\s|$)|\n/).filter((p) => /[A-Za-z]/.test(p));
    return Math.max(1, parts.length);
}
/** Flesch-Kincaid grade level. */
export function fleschKincaidGrade(text) {
    const ws = words(text);
    if (ws.length === 0)
        return 0;
    const syl = ws.reduce((n, w) => n + syllables(w), 0);
    return 0.39 * (ws.length / sentenceCount(text)) + 11.8 * (syl / ws.length) - 15.59;
}
