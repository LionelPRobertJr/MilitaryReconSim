// Recruitment-platform plumbing (Study 2 brief section 12, "Online
// deployment"): participant, study and session IDs from the URL, the
// completion redirect, and the desktop / window-size screen. The parameter
// names and completion URL come from the deployment config, so switching
// platforms (the brief leaves the platform open) is a config change.
export const DEFAULT_PLATFORM = {
    participantParams: ["PROLIFIC_PID", "participant_id", "pid"],
    studyParams: ["STUDY_ID", "study_id", "study"],
    sessionParams: ["SESSION_ID", "session_id", "session"],
    completionUrl: "",
    completionCode: "",
    noConsentUrl: "",
    noConsentCode: "",
    platformName: "the study website"
};
const first = (params, names) => {
    for (const n of names) {
        const v = params.get(n)?.trim();
        if (v)
            return { value: v, param: n };
    }
    return null;
};
/** Only these characters are kept from URL IDs (they become file names on the server). */
export const cleanId = (s) => s.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
export function readIds(params, cfg, defaults, newId) {
    const p = first(params, cfg.participantParams);
    if (!p || !cleanId(p.value))
        return null;
    const s = first(params, cfg.studyParams);
    const sess = first(params, cfg.sessionParams);
    return {
        participantId: cleanId(p.value),
        studyId: cleanId(s?.value ?? "") || defaults.studyId,
        sessionId: cleanId(sess?.value ?? "") || newId(),
        sources: { participantId: p.param, studyId: s?.param ?? "default", sessionId: sess?.param ?? "generated" }
    };
}
export function completionHref(template, code) {
    if (!template)
        return null;
    return template.replace("{code}", encodeURIComponent(code));
}
export function deviceInfo(nav, win) {
    const ua = nav.userAgent;
    const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
    const browser = /Edg\//.test(ua) ? "edge" : /Firefox\//.test(ua) ? "firefox" : /Chrome\//.test(ua) ? "chrome" : /Safari\//.test(ua) ? "safari" : "other";
    return { mobile, windowWidth: win.innerWidth, windowHeight: win.innerHeight, screenWidth: win.screen.width, screenHeight: win.screen.height, browser };
}
