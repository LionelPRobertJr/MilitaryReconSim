// NASA-TLX, raw (six subscales, 0-100), per brief sections 3 and 10.
const SUBSCALES = [
    { key: "mentalDemand", label: "Mental demand" },
    { key: "physicalDemand", label: "Physical demand" },
    { key: "temporalDemand", label: "Temporal demand (time pressure)" },
    { key: "performance", label: "Performance (own success, self-rated)" },
    { key: "effort", label: "Effort" },
    { key: "frustration", label: "Frustration" }
];
export function buildWorkloadForm(container) {
    container.innerHTML = "";
    const inputs = {};
    for (const { key, label } of SUBSCALES) {
        const row = document.createElement("div");
        row.className = "workload-slider-row";
        const labelEl = document.createElement("label");
        const valueSpan = document.createElement("span");
        valueSpan.textContent = "50";
        labelEl.innerHTML = `<span>${label}</span>`;
        labelEl.appendChild(valueSpan);
        row.appendChild(labelEl);
        const input = document.createElement("input");
        input.type = "range";
        input.min = "0";
        input.max = "100";
        input.value = "50";
        input.addEventListener("input", () => {
            valueSpan.textContent = input.value;
        });
        row.appendChild(input);
        container.appendChild(row);
        inputs[key] = input;
    }
    return inputs;
}
export function wireWorkloadSubmit(overlay, submitBtn, inputs, sim, onSubmitted, feedback) {
    submitBtn.addEventListener("click", () => {
        sim.recordWorkloadRating({
            mentalDemand: Number(inputs.mentalDemand?.value ?? 50),
            physicalDemand: Number(inputs.physicalDemand?.value ?? 50),
            temporalDemand: Number(inputs.temporalDemand?.value ?? 50),
            performance: Number(inputs.performance?.value ?? 50),
            effort: Number(inputs.effort?.value ?? 50),
            frustration: Number(inputs.frustration?.value ?? 50)
        });
        // Blank/whitespace-only boxes are recorded as empty strings rather
        // than skipped - the survey is voluntary per question (index.html says
        // "answer as much or as little as you like"), and a present-but-empty
        // string is easier for a pilot-study reviewer to tell apart from "this
        // session predates the survey" (sessionFeedback === null, see
        // Simulation.summary()) than a missing field would be.
        sim.recordSessionFeedback({
            wentRight: feedback?.wentRight.value.trim() ?? "",
            wentWrong: feedback?.wentWrong.value.trim() ?? "",
            recommendations: feedback?.recommendations.value.trim() ?? ""
        });
        overlay.classList.add("hidden");
        onSubmitted();
    }, { once: true });
}
