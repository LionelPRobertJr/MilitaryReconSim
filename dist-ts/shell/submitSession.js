import { buildSessionExport } from "../engine/export.js";
export async function autoSubmitSession(sim, filenamePrefix, onStatusChange) {
    onStatusChange("sending");
    try {
        const { eventsJsonl, summaryJson, metricsCsv } = buildSessionExport(sim);
        const res = await fetch("/api/submit-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filenamePrefix, eventsJsonl, summaryJson, metricsCsv })
        });
        if (!res.ok)
            throw new Error(`submit endpoint responded ${res.status}`);
        onStatusChange("sent");
    }
    catch (err) {
        // Expected/normal in local dev (no serverless function backs
        // /api/submit-session there) - logged at a low severity for that reason,
        // never surfaced as a page error. On a real deployment this is the
        // signal an operator or researcher should look at if "Sent" never shows.
        console.warn("[pilot] auto-submit did not complete - the manual download buttons below still have the full data:", err);
        onStatusChange("failed");
    }
}
const STATUS_TEXT = {
    sending: "Sending your data to the research team…",
    sent: "✓ Sent to the research team.",
    failed: "⚠ Couldn't send automatically — please also use the download buttons below so your data still reaches the research team."
};
export function renderSubmitStatus(el, status) {
    el.textContent = STATUS_TEXT[status];
    el.classList.remove("submit-status-sending", "submit-status-sent", "submit-status-failed");
    el.classList.add(`submit-status-${status}`);
}
