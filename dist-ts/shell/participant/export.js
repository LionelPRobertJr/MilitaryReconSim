// Pack-independent pieces of the participant-session summary, all computed
// from the session log alone (so an analyst can recompute them from
// events.jsonl), plus the one-row metrics.csv.
/** Keeps, for every stage, only the events of its latest attempt (a reload restarts a stage; the restarted run counts). */
export function lastAttempts(events) {
    const latest = new Map();
    for (const e of events)
        latest.set(e.stage, Math.max(latest.get(e.stage) ?? 0, e.attempt));
    return events.filter((e) => e.attempt === latest.get(e.stage));
}
const r3 = (x) => Math.round(x * 1000) / 1000;
/** Per stage: attempts, and the seconds the counted (last) attempt took. */
export function stageSummary(events) {
    const out = {};
    for (const e of events) {
        if (e.type !== "stage_start")
            continue;
        const s = (out[e.stage] ??= { attempts: 0, seconds: null, completed: false });
        s.attempts = Math.max(s.attempts, e.attempt);
    }
    for (const [stage, s] of Object.entries(out)) {
        const start = events.find((e) => e.type === "stage_start" && e.stage === stage && e.attempt === s.attempts);
        const end = events.find((e) => e.type === "stage_end" && e.stage === stage && e.attempt === s.attempts);
        s.completed = !!end;
        s.seconds = start && end ? r3(end.ts - start.ts) : null;
    }
    return out;
}
/** Out-of-focus time from the focus_change events: union of hidden and blurred spells, attributed to where each spell began. */
export function focusSummary(events, endTs) {
    const spells = [];
    let hidden = null;
    let blurred = null;
    let changes = 0;
    const end = endTs ?? events.at(-1)?.ts ?? 0;
    for (const e of events) {
        if (e.type !== "focus_change")
            continue;
        changes++;
        if (e.to === "hidden")
            hidden = e;
        else if (e.to === "blur")
            blurred = e;
        else if (e.to === "visible" && hidden) {
            spells.push({ start: hidden.ts, end: e.ts, stage: hidden.stage, section: hidden.section ?? null });
            hidden = null;
        }
        else if (e.to === "focus" && blurred) {
            spells.push({ start: blurred.ts, end: e.ts, stage: blurred.stage, section: blurred.section ?? null });
            blurred = null;
        }
    }
    for (const open of [hidden, blurred])
        if (open)
            spells.push({ start: open.ts, end, stage: open.stage, section: open.section ?? null });
    // Union of overlapping spells (a tab switch both hides the page and blurs the window); each merged spell keeps where it began.
    spells.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const s of spells) {
        const last = merged.at(-1);
        if (last && s.start <= last.end)
            last.end = Math.max(last.end, s.end);
        else
            merged.push({ ...s });
    }
    const byStage = {};
    const bySection = {};
    let total = 0;
    let longest = 0;
    for (const s of merged) {
        const d = s.end - s.start;
        total += d;
        longest = Math.max(longest, d);
        byStage[s.stage] = r3((byStage[s.stage] ?? 0) + d);
        if (s.section)
            bySection[s.section] = r3((bySection[s.section] ?? 0) + d);
    }
    return { changes, awaySecondsTotal: r3(total), awaySecondsByStage: byStage, awaySecondsBySection: bySection, longestAwaySeconds: r3(longest) };
}
/** Attention checks: the last answer to each (a restarted stage asks again). */
export function attentionSummary(events) {
    const passed = {};
    for (const e of events)
        if (e.type === "attention_check")
            passed[e.checkId] = !!e.passed;
    const vals = Object.values(passed);
    return { passed, passedCount: vals.filter(Boolean).length, total: vals.length };
}
const csvCell = (v) => {
    if (v === null || v === undefined)
        return "";
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** One header + one row: every number, boolean, null and short string in the summary, as dotted keys. Arrays and the excluded keys are left out. */
export function metricsCsv(summary, excluded) {
    const cols = [];
    const walk = (obj, prefix) => {
        for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (excluded.includes(key))
                continue;
            if (Array.isArray(v))
                continue;
            if (v !== null && typeof v === "object")
                walk(v, key);
            else
                cols.push([key, v]);
        }
    };
    walk(summary, "");
    return `${cols.map(([k]) => csvCell(k)).join(",")}\n${cols.map(([, v]) => csvCell(v)).join(",")}`;
}
