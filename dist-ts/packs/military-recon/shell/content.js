import { TLX_ITEMS } from "../../../shell/participant/instruments.js";
// Participant-shell wording for Study 2 (brief section 3). Every condition
// sees exactly these words; nothing here depends on the training condition.
// Items marked PLACEHOLDER must be replaced before the pilot (see README).
/** IRB-approved consent text goes here (HTML). PLACEHOLDER. */
export const CONSENT_HTML = `
  <p class="placeholder"><b>Placeholder:</b> the IRB-approved consent form goes here, word for word.</p>
  <p class="t-text">In this study you supervise two simulated robot vehicles on a reconnaissance mission, after a short tutorial and training module. It takes about 45 minutes. You can stop at any time by closing this window.</p>
  <p class="t-text">We record what you do in the task and your answers to the questions. We do not collect your name or contact details; your data are linked only to your participant ID.</p>`;
export const MOBILE_HTML = `<p class="t-text">This study needs a desktop or laptop computer with a mouse or trackpad. It cannot be completed on a phone or tablet.</p>
  <p class="t-text">If you can, please open the study link again on a computer. Otherwise, you can close this window; no data have been recorded.</p>`;
export const NO_ID_HTML = `<p class="t-text">This link is missing your participant ID, so the study cannot start. Please go back to the study page and use the link provided there.</p>`;
export const DECLINE_HTML = `<p class="t-text">You have chosen not to take part. Thank you for your time. You can close this window.</p>`;
export const DEMOGRAPHICS = {
    id: "demographics",
    title: "About you",
    intro: ["These two answers are stored separately from your task data."],
    eventType: "demographics_response",
    privateAnswers: true,
    submitLabel: "Continue",
    items: [
        { kind: "number", id: "age", text: "Your age in years", min: 18, max: 100 },
        {
            kind: "choice",
            id: "gender",
            text: "Your gender",
            options: [
                { value: "woman", label: "Woman" },
                { value: "man", label: "Man" },
                { value: "another", label: "Another gender" },
                { value: "prefer_not", label: "Prefer not to say" }
            ]
        }
    ]
};
const GAMING_OPTIONS = [
    { value: "never", label: "Never" },
    { value: "lt_month", label: "Less than once a month" },
    { value: "few_month", label: "A few times a month" },
    { value: "few_week", label: "A few times a week" },
    { value: "daily", label: "Every day or almost every day" }
];
export const EXPERIENCE = {
    id: "experience",
    title: "Your experience",
    eventType: "experience_response",
    submitLabel: "Continue",
    items: [
        { kind: "choice", id: "gaming", text: "How often do you play video games?", options: GAMING_OPTIONS },
        { kind: "choice", id: "attention_setup", text: "To show that you are reading each question, please select “A few times a month” here.", options: GAMING_OPTIONS, attention: { checkId: "attention_setup", expected: "few_month" } },
        {
            kind: "choice",
            id: "robots",
            text: "How much experience do you have operating or supervising robots, drones or remote-controlled vehicles?",
            options: [
                { value: "none", label: "None" },
                { value: "little", label: "A little (tried it a few times)" },
                { value: "some", label: "Some (used them regularly for a while)" },
                { value: "lot", label: "A lot (part of my work or a long-standing hobby)" }
            ]
        }
    ]
};
/**
 * Perceived team adaptability (Marques-Quinteiro et al., 2013): the 9 items
 * used in Study 1, verbatim from the research team's "TeamAdapt-1" document
 * (Oct 9, 2026), in its order and on its three pages (Create, Uncertain,
 * Stress), with its fully labelled 7-point scale. Item IDs are the document's.
 */
export const TEAM_ADAPT_LABELS = ["Extremely bad", "Moderately bad", "Slightly bad", "Neither good nor bad", "Slightly good", "Moderately good", "Extremely good"];
export const TEAM_ADAPT_ITEMS = [
    { id: "Create-1-1", subscale: "create", text: "Rate how well your team did in solving problems for which there were no easy or straightforward answers" },
    { id: "Create-1-2", subscale: "create", text: "Rate how well your team did in using new ideas to overcome any challenges" },
    { id: "Create-1-3", subscale: "create", text: "Rate how well your team did in finding innovative ways to deal with unexpected events" },
    { id: "Uncertain-1-1", subscale: "uncertain", text: "Rate how well your team did in dealing with delays in the delivery of fundamental information for finishing the mission" },
    { id: "Uncertain-1-2", subscale: "uncertain", text: "Rate how well your team did in devising alternative plans in a very short time as a way to cope with new task demands" },
    { id: "Uncertain-1-3", subscale: "uncertain", text: "Rate how well your team did in trying to overcome the obstacles that emerged during task performance" },
    { id: "Stress-1-1", subscale: "stress", text: "Rate how well your team did in remaining calm and behaving positively under highly stressful events" },
    { id: "Stress-1-2", subscale: "stress", text: "Rate how well your team did in performing tasks for which they consider to have had less time than the time necessary to performance such tasks in a proper way" },
    { id: "Stress-1-3", subscale: "stress", text: "Rate how well your team did in maintaining focus when dealing with multiple situations and responsibilities" }
];
const teamAdaptItem = (it) => ({
    kind: "likert",
    id: it.id,
    text: it.text,
    points: 7,
    anchors: [TEAM_ADAPT_LABELS[0], TEAM_ADAPT_LABELS[6]],
    labels: TEAM_ADAPT_LABELS
});
/** The brief's one confidence item per probe. PLACEHOLDER: wording and scale not yet supplied. */
export const PROBE_CONFIDENCE = {
    kind: "likert",
    id: "confidence",
    text: "[Placeholder] Confidence item: wording to be supplied.",
    points: 7,
    anchors: ["Not at all confident", "Completely confident"]
};
export const CONFIDENCE_IS_PLACEHOLDER = true;
/** One probe = three pages, as in the TeamAdapt-1 document; the confidence item ends the last page. */
export function probePages(probe) {
    const parts = ["create", "uncertain", "stress"];
    return parts.map((part, i) => ({
        id: `${probe}_${part}`,
        kicker: `Mission paused · mission time is not running · page ${i + 1} of 3`,
        title: probe === "probe_1" ? "Check-in after Section A" : "Check-in after Section B",
        // "Team" = the participant and both UGVs, on every page (research team decision, Oct 10, 2026: playtesters
        // were unsure whether the robots count as part of the team).
        intro: [i === 0 ? "In these questions, “your team” means you and your two robots, UGV #1 and UGV #2, working together. Think about how your team has done so far." : "As before, “your team” means you and your two robots, UGV #1 and UGV #2."],
        eventType: "probe_response",
        logFields: { probe, part },
        submitLabel: i < 2 ? "Next" : "Continue the mission",
        items: [...TEAM_ADAPT_ITEMS.filter((x) => x.subscale === part).map(teamAdaptItem), ...(i === 2 ? [PROBE_CONFIDENCE] : [])]
    }));
}
/** NASA-TLX (raw) with the second attention check placed among the scales. */
export const TLX_PAGE = {
    id: "tlx",
    title: "How demanding was the mission?",
    intro: ["Think about the mission you just completed (not the training). For each scale, click the box that best describes your experience.", "Note: on the Performance scale the left end is <b>Perfect</b> and the right end is <b>Failure</b>."],
    eventType: "tlx_response",
    submitLabel: "Continue",
    items: [
        ...TLX_ITEMS.slice(0, 3),
        { kind: "tlx", id: "attention_post", text: "Reading check", description: "To show that you are reading, please click the box at the far left (Very low) of this scale.", low: "Very low", high: "Very high", attention: { checkId: "attention_post", expected: "0" } },
        ...TLX_ITEMS.slice(3)
    ]
};
/** Manipulation check (brief section 10): free recall of the rule, plus the novel-situation question. Coded blind to condition. */
export const MANIPULATION_PAGE = {
    id: "manipulation_check",
    title: "Your training",
    eventType: "manipulation_response",
    submitLabel: "Continue",
    items: [
        { kind: "text", id: "rule_recall", text: "In your own words, what did your training tell you about when to take over from a UGV?", rows: 4 },
        { kind: "text", id: "novel_event", text: "What would you do if a UGV met something your training didn't mention?", rows: 4 }
    ]
};
/** Open response on the critical event (brief section 10). */
export const CRITICAL_REPORT_PAGE = {
    id: "critical_report",
    title: "The bridge in Section B",
    intro: ["In Section B, UGV1 came to a narrow timber bridge."],
    eventType: "critical_report_response",
    submitLabel: "Finish",
    items: [{ kind: "text", id: "critical_report", text: "Describe what happened at the bridge, and why you acted as you did.", rows: 6 }]
};
const money = (p, x) => `${p.currency}${x.toFixed(2)}`;
/** Bonus rules, identical words in every condition (brief section 8), shown before the mission. */
export function bonusRulesText(p) {
    return `Besides the payment for taking part (${p.basePayment}), you earn a bonus from your mission score: ${money(p, p.bonusPerPoint * 100)} for every 100 points, up to ${money(p, p.bonusCap)}. The score counts only mission outcomes, the same way for everyone.`;
}
export function bonusFor(score, p) {
    return Math.round(Math.min(p.bonusCap, Math.max(0, score * p.bonusPerPoint)) * 100) / 100;
}
/** "400 for reaching the objective, 512 for time left, 85 from the Spot Report, −100 penalties" (how a score was made up). */
export function scoreBreakdownText(b) {
    const parts = [`${b.objective} for reaching the objective`, `${b.timeBonus} for time left`, `${b.spotReport} from the Spot Report`];
    if (b.penalties)
        parts.push(`${b.penalties < 0 ? "−" : ""}${Math.abs(b.penalties)} for stops, getting stuck and unneeded take-overs`);
    return parts.join(", ");
}
export function debriefHtml(opts) {
    return `<p class="t-text">Thank you for taking part. Your mission score was <b>${opts.score}</b>${opts.breakdown ? ` (${opts.breakdown})` : ""}, which earns a bonus of <b>${opts.bonus}</b>.</p>
  <h2>About this study</h2>
  <p class="t-text">We are studying how people decide when to take over from robots they supervise. Different participants received different training about when the vehicles need help.</p>
  <p class="t-text">Several obstacles in the mission were deliberately left out of everyone's training: the muddy flooded dips, the tall reeds, the smoke, the low mounds, the thin fallen saplings, the stream crossing and the damaged timber bridge in Section B. Some of them the vehicles could get through by themselves and some they could not judge. We wanted to see how people handle obstacles their training did not cover, so they were not mentioned before. Whatever you did there is useful to us; there was no trick to spot.</p>
  <p class="t-text">Please do not tell anyone who might take part about these obstacles, since that would change their results.</p>
  <p class="placeholder"><b>Placeholder:</b> IRB-approved debriefing text and research-team contact details go here.</p>
  ${opts.code ? `<p class="t-text">Your completion code: <b class="t-code">${opts.code}</b></p>` : ""}`;
}
