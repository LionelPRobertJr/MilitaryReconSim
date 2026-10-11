// UI for the periodic self-report check (SimConfig.sart*; see engine/sart.ts
// and simulation.ts's triggerSart/handleSartSubmit). A full-screen overlay
// (same CSS group as #resource-guide-overlay in style.css), not a small
// docked panel like resource-id-panel.ts's - this form has more content (a
// free-text box plus three rating sliders) than fits comfortably in a
// corner, and unlike the resource-ID photo, there's no map content the
// operator needs to keep half an eye on while filling it in. Per
// resource-guide-overlay's own precedent, covering the screen does NOT pause
// the session clock (see updateSartPanel's caller in main.ts) - filling this
// in costs real session time, same as consulting the field guide does.
//
// Known limitation: because this is triggered purely by simulation time
// (triggerSart runs every tick regardless of what else is on screen), a
// check can in principle pop up while the assignment/fault menu overlay is
// also open, and the two full-screen overlays would stack. Left unhandled
// for now (same category of edge case as the DRT ping already tolerates
// firing over the docked resource-ID panel) rather than adding overlay
// arbitration no one has asked for yet.
const DIMENSIONS = [
    {
        key: "demand",
        label: "Demand",
        hint: "How much is the situation demanding of your attention right now? 1 = very low demand, 7 = very high demand."
    },
    {
        key: "supply",
        label: "Supply",
        hint: "How much spare attentional capacity do you have available to meet that demand? 1 = very low supply, 7 = very high supply."
    },
    {
        key: "understanding",
        label: "Understanding",
        hint: "How well do you understand what is currently happening across the fleet? 1 = very low understanding, 7 = very high understanding."
    }
];
/** Builds the three 3D-SART rating sliders once at startup - parallel to workload.ts's buildWorkloadForm, just a 1-7 scale instead of 0-100 (the literature's standard SART range) and three dimensions instead of six. */
export function buildSartForm(container) {
    container.innerHTML = "";
    const inputs = {};
    for (const { key, label, hint } of DIMENSIONS) {
        const row = document.createElement("div");
        row.className = "workload-slider-row";
        const labelEl = document.createElement("label");
        labelEl.title = hint;
        const valueSpan = document.createElement("span");
        valueSpan.textContent = "4";
        labelEl.innerHTML = `<span>${label}</span>`;
        labelEl.appendChild(valueSpan);
        row.appendChild(labelEl);
        const input = document.createElement("input");
        input.type = "range";
        input.min = "1";
        input.max = "7";
        input.step = "1";
        input.value = "4";
        input.addEventListener("input", () => {
            valueSpan.textContent = input.value;
        });
        row.appendChild(input);
        container.appendChild(row);
        inputs[key] = input;
    }
    return inputs;
}
/** Resets the form back to its neutral starting point after a submission, so the next check (this is the same static DOM reused many times in one session, not rebuilt per check) doesn't start from whatever the operator last left it at. */
export function resetSartForm(statusReportInput, inputs) {
    statusReportInput.value = "";
    for (const input of Object.values(inputs)) {
        input.value = "4";
        input.dispatchEvent(new Event("input"));
    }
}
/**
 * Called once per frame from main.ts's render loop, same cadence as
 * updateResourceIdPanel - shows the overlay for exactly as long as
 * world.sart.activeCheckId is non-null, and force-hides it whenever
 * `enabled` is false (SimConfig.sartEnabled off, or the session has ended -
 * same "force-hidden once ended" convention frame() already applies to the
 * resource-ID panel, so a check active at the exact moment the timer hits
 * zero doesn't stay stuck on screen unanswerable).
 */
export function updateSartPanel(els, world, enabled) {
    if (!enabled || world.sart.activeCheckId === null) {
        els.overlay.classList.add("hidden");
        return;
    }
    els.overlay.classList.remove("hidden");
}
