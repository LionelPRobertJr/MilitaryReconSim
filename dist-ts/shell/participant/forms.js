const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** TLX: 21 marks from 0 to 100 in steps of 5 (the paper-and-pencil scale). */
export const TLX_STEPS = Array.from({ length: 21 }, (_, i) => i * 5);
function itemHtml(item, n) {
    const req = item.required === false ? "" : " required";
    const q = `<legend><span class="q-n">${n}.</span> ${esc(item.text)}</legend>`;
    switch (item.kind) {
        case "likert":
            return `<fieldset class="q-item q-likert" data-item="${item.id}">${q}
        <div class="q-scale${item.labels ? " q-labelled" : ""}" style="--points:${item.points}">${Array.from({ length: item.points }, (_, i) => `<label><input type="radio" name="${item.id}" value="${i + 1}"${req} /><span>${i + 1}</span>${item.labels ? `<small>${esc(item.labels[i] ?? "")}</small>` : ""}</label>`).join("")}</div>
        ${item.labels ? "" : `<div class="q-anchors"><span>${esc(item.anchors[0])}</span><span>${esc(item.anchors[1])}</span></div>`}</fieldset>`;
        case "choice":
            return `<fieldset class="q-item q-choice" data-item="${item.id}">${q}${item.options.map((o) => `<label><input type="radio" name="${item.id}" value="${esc(o.value)}"${req} /> ${esc(o.label)}</label>`).join("")}</fieldset>`;
        case "tlx":
            return `<fieldset class="q-item q-tlx" data-item="${item.id}">${q}${item.description ? `<p class="q-desc">${esc(item.description)}</p>` : ""}
        <div class="q-tlx-scale">${TLX_STEPS.map((v) => `<label title="${v}"><input type="radio" name="${item.id}" value="${v}"${req} /><span></span></label>`).join("")}</div>
        <div class="q-anchors"><span>${esc(item.low)}</span><span>${esc(item.high)}</span></div></fieldset>`;
        case "number":
            return `<fieldset class="q-item q-number" data-item="${item.id}">${q}<input type="number" name="${item.id}" min="${item.min}" max="${item.max}" step="1" inputmode="numeric"${req} /></fieldset>`;
        case "text":
            return `<fieldset class="q-item q-text" data-item="${item.id}">${q}<textarea name="${item.id}" rows="${item.rows ?? 4}"${req}></textarea></fieldset>`;
    }
}
export class PageRunner {
    overlay;
    sheet;
    log;
    constructor(overlay, sheet, log) {
        this.overlay = overlay;
        this.sheet = sheet;
        this.log = log;
    }
    show(html) {
        this.sheet.innerHTML = html;
        this.overlay.hidden = false;
        this.overlay.scrollTop = 0;
    }
    hide() {
        this.overlay.hidden = true;
    }
    /** A page of text with buttons; resolves with the data-choice of the button pressed. */
    async info(title, html, buttons, kicker) {
        this.show(`${kicker ? `<p class="t-progress">${esc(kicker)}</p>` : ""}<h1>${esc(title)}</h1>${html}
      <div class="buttons">${buttons.map((b) => `<button data-choice="${b.choice}"${b.primary ? ' class="primary"' : ""}>${esc(b.label)}</button>`).join("")}</div>`);
        this.sheet.querySelector("button.primary")?.focus({ preventScroll: true });
        return new Promise((resolve) => {
            for (const b of this.sheet.querySelectorAll("[data-choice]"))
                b.addEventListener("click", () => resolve(b.dataset.choice), { once: true });
        });
    }
    /** One questionnaire page. Resolves with the answers (strings; "" for a skipped optional item). */
    async page(spec) {
        this.show(`${spec.kicker ? `<p class="t-progress">${esc(spec.kicker)}</p>` : ""}<h1>${esc(spec.title)}</h1>
      ${(spec.intro ?? []).map((p) => `<p class="t-text">${p}</p>`).join("")}
      <form class="q-form" novalidate>${spec.items.map((it, i) => itemHtml(it, i + 1)).join("")}
        <p class="q-missing" hidden>Please answer the highlighted question(s).</p>
        <div class="buttons"><button class="primary" type="submit">${esc(spec.submitLabel)}</button></div></form>`);
        const form = this.sheet.querySelector("form");
        const t0 = this.log.now();
        const answers = await new Promise((resolve) => {
            form.addEventListener("submit", (e) => {
                e.preventDefault();
                const data = new FormData(form);
                const out = {};
                const missing = [];
                for (const it of spec.items) {
                    const v = String(data.get(it.id) ?? "").trim();
                    out[it.id] = v;
                    const bad = it.kind === "number" && v !== "" && (!Number.isInteger(Number(v)) || Number(v) < it.min || Number(v) > it.max);
                    if ((it.required !== false && v === "") || bad)
                        missing.push(it.id);
                }
                for (const fs of form.querySelectorAll("[data-item]"))
                    fs.classList.toggle("q-bad", missing.includes(fs.dataset.item));
                form.querySelector(".q-missing").hidden = missing.length === 0;
                if (missing.length) {
                    form.querySelector(`[data-item="${missing[0]}"]`)?.scrollIntoView({ block: "center" });
                    return;
                }
                resolve(out);
            });
        });
        const rtSeconds = Math.round((this.log.now() - t0) * 1000) / 1000;
        const items = {};
        for (const it of spec.items) {
            if (it.kind === "likert" || it.kind === "choice" || it.kind === "tlx") {
                if (it.attention) {
                    this.log.record({ type: "attention_check", checkId: it.attention.checkId, page: spec.id, answer: answers[it.id], passed: answers[it.id] === it.attention.expected });
                    continue;
                }
            }
            items[it.id] = answers[it.id];
        }
        if (spec.privateAnswers)
            this.log.record({ type: spec.eventType, page: spec.id, answered: Object.keys(items).filter((k) => items[k] !== ""), rtSeconds, ...(spec.logFields ?? {}) });
        else
            this.log.record({ type: spec.eventType, page: spec.id, items, rtSeconds, ...(spec.logFields ?? {}) });
        return answers;
    }
}
