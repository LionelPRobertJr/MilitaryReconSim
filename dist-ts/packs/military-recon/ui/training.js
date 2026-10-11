import { sceneKindById } from "../sim/event-definitions.js";
import { VERDICT_LABEL } from "../training/content.js";
import { trainingImageSvg } from "./scenes.js";
import { studioImage } from "./three/studio.js";
let webgl = true;
/** A training picture: rendered in 3D like the live views (three/studio.ts), or the drawn version without WebGL. */
function picture(im, geometry) {
    if (webgl && new URLSearchParams(location.search).get("view") !== "2d") {
        try {
            return `<img class="t-img" src="${studioImage(im.sceneId, im.view)}" alt="" width="800" height="500" />`;
        }
        catch (err) {
            console.warn("3D training pictures unavailable, using drawn ones", err);
            webgl = false;
        }
    }
    return trainingImageSvg(im, geometry);
}
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** "Robot handles it. Rest..." -> bold verdict, plain rest. */
const verdictHtml = (t) => {
    const i = t.indexOf(". ");
    return i < 0 ? esc(t) : `<b>${esc(t.slice(0, i + 1))}</b> ${esc(t.slice(i + 2))}`;
};
function imagePair(images) {
    const geometry = sceneKindById(images[0].sceneId).geometry;
    const caption = (v) => (v === "camera" ? "Camera view" : v === "height_map" ? "Robot's view (height map)" : "Second camera angle");
    return `<div class="t-pair">${images.map((im) => `<figure>${picture(im, geometry)}<figcaption>${caption(im.view)}</figcaption></figure>`).join("")}</div>`;
}
export class TrainingPlayer {
    overlay;
    sheet;
    log;
    constructor(overlay, sheet, log) {
        this.overlay = overlay;
        this.sheet = sheet;
        this.log = log;
    }
    visits = new Map();
    show(html) {
        this.sheet.innerHTML = html;
        this.overlay.hidden = false;
        this.overlay.scrollTop = 0;
        // Focus the main button only when it can be used; otherwise the sheet itself, so no answer button
        // looks pre-selected by its focus ring.
        const primary = this.sheet.querySelector("button.primary:not(:disabled)");
        if (primary)
            primary.focus({ preventScroll: true });
        else {
            this.sheet.tabIndex = -1;
            this.sheet.focus({ preventScroll: true });
        }
    }
    hide() {
        this.overlay.hidden = true;
    }
    click(selector) {
        return new Promise((resolve) => {
            for (const el of this.sheet.querySelectorAll(selector))
                el.addEventListener("click", () => resolve(el), { once: true });
        });
    }
    pageHtml(page, index, total, nav) {
        const examples = page.examples
            .map((e) => `<div class="t-example">${imagePair(e.images)}<p class="t-verdict t-${e.verdict}">${verdictHtml(e.text)}</p></div>`)
            .join("");
        return `<p class="t-progress">Training, page ${index + 1} of ${total}</p>
      <h1>${esc(page.title)}</h1>
      ${page.paragraphs.map((p, i) => paragraphHtml(p, page.id === "principles" && i === page.paragraphs.length - 1)).join("")}
      ${examples}
      <div class="buttons">${nav.back ? '<button data-nav="back">Back</button>' : ""}<button class="primary" data-nav="next">${nav.nextLabel}</button></div>`;
    }
    /** Records dwell time for a page view. */
    async timedPage(pageId, html, selector) {
        const start = this.log.now();
        const visit = (this.visits.get(pageId) ?? 0) + 1;
        this.visits.set(pageId, visit);
        this.show(html);
        const el = await this.click(selector);
        this.log.record({ type: "training_page", pageId, visit, dwellSeconds: Math.round((this.log.now() - start) * 1000) / 1000 });
        return el;
    }
    /** The whole module: pages in order (Back allowed), the practice set on its page. */
    async runModule(m) {
        const pages = m.pages;
        let i = 0;
        while (i < pages.length) {
            const page = pages[i];
            if (page.id === "practice") {
                await this.timedPage(page.id, this.pageHtml(page, i, pages.length, { back: i > 0, nextLabel: "Start practice" }), "[data-nav]").then(async (el) => {
                    if (el.dataset.nav === "back") {
                        i--;
                        return;
                    }
                    await this.runPractice(m);
                    i++;
                });
                continue;
            }
            const el = await this.timedPage(page.id, this.pageHtml(page, i, pages.length, { back: i > 0, nextLabel: i === pages.length - 1 ? "Finish training" : "Next" }), "[data-nav]");
            i += el.dataset.nav === "back" ? -1 : 1;
        }
    }
    async runPractice(m) {
        const { items, criterion, maxRounds, prompt, labels } = m.practice;
        for (let round = 1; round <= maxRounds; round++) {
            let correctCount = 0;
            for (let k = 0; k < items.length; k++) {
                const item = items[k];
                const t0 = this.log.now();
                this.show(`<p class="t-progress">Practice round ${round}: scene ${k + 1} of ${items.length}</p>
          ${imagePair(item.images)}
          <p class="t-question">${esc(prompt)}</p>
          <div class="buttons t-answer"><button data-answer="handles">${labels.handles}</button><button data-answer="needs_you">${labels.needs_you}</button></div>`);
                const el = await this.click("[data-answer]");
                const answer = el.dataset.answer;
                const correct = answer === item.answer;
                if (correct)
                    correctCount++;
                this.log.record({ type: "practice_response", round, itemId: item.id, kindId: item.kindId, answer, correct, rtSeconds: Math.round((this.log.now() - t0) * 1000) / 1000 });
                this.show(`<p class="t-progress">Practice round ${round}: scene ${k + 1} of ${items.length}</p>
          ${imagePair(item.images)}
          <p class="t-feedback ${correct ? "t-right" : "t-wrong"}"><b>${correct ? "Correct." : "Not quite."}</b> ${verdictHtml(item.feedback)}</p>
          <div class="buttons"><button class="primary" data-nav="next">Next</button></div>`);
                await this.click("[data-nav]");
            }
            const passed = correctCount >= criterion;
            this.log.record({ type: "practice_round", round, correctCount, passed });
            const last = passed || round === maxRounds;
            this.show(`<h1>${passed ? "Practice complete" : last ? "Practice finished" : "Let's go through the set again"}</h1>
        <p class="t-text">You got ${correctCount} of ${items.length} right.${passed || last ? "" : ` You need ${criterion} of ${items.length}; the same scenes come again.`}</p>
        <div class="buttons"><button class="primary" data-nav="next">${passed || last ? "Continue" : "Practise again"}</button></div>`);
            await this.click("[data-nav]");
            if (last)
                return;
        }
    }
    /** The 16 capability-judgment cards, no feedback, with a confidence rating (brief section 10). */
    async runJudgments(deck, phase) {
        this.show(`<h1>${phase === "pre" ? "Before the mission" : "After the mission"}: what would the UGV do?</h1>
      <p class="t-text">You will see ${deck.length} scenes a UGV might meet${phase === "post" ? " (the scenes from before the mission in a new order, mixed with some you met for the first time in the mission)" : ""}. For each, say whether the UGV handles it by itself or needs you, and how sure you are. There is no feedback; answer from what you now believe.</p>
      <div class="buttons"><button class="primary" data-nav="next">Begin</button></div>`);
        await this.click("[data-nav]");
        for (let k = 0; k < deck.length; k++) {
            const card = deck[k];
            const t0 = this.log.now();
            const geometry = sceneKindById(card.sceneId).geometry;
            this.show(`<p class="t-progress">Scene ${k + 1} of ${deck.length}</p>
        <div class="t-card"><figure>${picture({ sceneId: card.sceneId, view: "camera" }, geometry)}</figure><p class="t-text">${esc(card.text)}</p></div>
        <p class="t-question">Does the UGV handle this itself, or does it need you?</p>
        <div class="buttons t-answer" role="radiogroup" aria-label="Answer"><button data-choice="handles" aria-pressed="false">${VERDICT_LABEL.handles}</button><button data-choice="needs_you" aria-pressed="false">${VERDICT_LABEL.needs_you}</button></div>
        <p class="t-question">How sure are you?</p>
        <div class="t-scale" role="radiogroup" aria-label="Confidence">${[1, 2, 3, 4, 5].map((n) => `<button data-conf="${n}" aria-pressed="false">${n}</button>`).join("")}<span>1 = guessing, 5 = certain</span></div>
        <div class="buttons"><button class="primary" data-nav="next" disabled>Next</button></div>`);
            let answer = null;
            let confidence = null;
            const next = this.sheet.querySelector("[data-nav=next]");
            // A short settle time after each new card, so a double click on Next can never skip a card.
            let settled = false;
            window.setTimeout(() => {
                settled = true;
                update();
            }, 400);
            const update = () => (next.disabled = !settled || answer === null || confidence === null);
            for (const b of this.sheet.querySelectorAll("[data-choice]")) {
                b.addEventListener("click", () => {
                    answer = b.dataset.choice;
                    for (const o of this.sheet.querySelectorAll("[data-choice]"))
                        o.setAttribute("aria-pressed", String(o === b));
                    update();
                });
            }
            for (const b of this.sheet.querySelectorAll("[data-conf]")) {
                b.addEventListener("click", () => {
                    confidence = Number(b.dataset.conf);
                    for (const o of this.sheet.querySelectorAll("[data-conf]"))
                        o.setAttribute("aria-pressed", String(o === b));
                    update();
                });
            }
            await this.click("[data-nav=next]");
            this.log.record({
                type: "judgment_response",
                cardId: card.id,
                kindId: card.kindId,
                transfer: card.transfer,
                phase,
                answer: answer,
                confidence: confidence,
                correct: answer === card.answer,
                rtSeconds: Math.round((this.log.now() - t0) * 1000) / 1000
            });
        }
    }
    /**
     * Three condition-specific questions. A wrong answer shows the related
     * module page once and asks the missed questions again; a second failure is
     * logged, not excluded (brief section 3).
     */
    async runComprehension(m) {
        let pending = m.comprehension;
        let allCorrect = false;
        for (let attempt = 1; attempt <= 2 && pending.length > 0; attempt++) {
            this.show(`<h1>Quick check</h1>
        <form class="t-quiz">${pending
                .map((q) => `<fieldset><legend>${esc(q.prompt)}</legend>${q.options
                .map((o) => `<label><input type="radio" name="${q.id}" value="${o.id}" required /> ${esc(o.text)}</label>`)
                .join("")}</fieldset>`)
                .join("")}
        <div class="buttons"><button class="primary" type="submit">Check answers</button></div></form>`);
            const form = this.sheet.querySelector("form");
            await new Promise((resolve) => form.addEventListener("submit", (e) => (e.preventDefault(), resolve()), { once: true }));
            const data = new FormData(form);
            const wrong = [];
            for (const q of pending) {
                const answer = String(data.get(q.id));
                const correct = answer === q.correct;
                this.log.record({ type: "comprehension_response", questionId: q.id, answerRound: attempt, answer, correct });
                if (!correct)
                    wrong.push(q);
            }
            if (wrong.length === 0) {
                allCorrect = true;
                break;
            }
            if (attempt === 1) {
                const page = m.pages.find((p) => p.id === wrong[0].relatedPageId);
                await this.timedPage(page.id, `<h1>Let's look at this again</h1>${page.paragraphs.map((p) => `<p class="t-text">${esc(p)}</p>`).join("")}<div class="buttons"><button class="primary" data-nav="next">Try the question${wrong.length > 1 ? "s" : ""} again</button></div>`, "[data-nav]");
                pending = wrong;
            }
            else {
                this.log.record({ type: "comprehension_review", pageId: wrong[0].relatedPageId, failedAgain: true });
            }
            if (attempt === 1)
                this.log.record({ type: "comprehension_review", pageId: wrong[0].relatedPageId, failedAgain: false });
        }
        // Feedback, so the check does not end silently (a second miss is logged, not excluded, and not dwelt on).
        await this.message("Quick check", allCorrect ? "All answers correct. Well done." : "Thank you. That is the end of the training.", "Continue");
    }
    /** A short interstitial with one button. */
    async message(title, text, button) {
        this.show(`<h1>${esc(title)}</h1><p class="t-text">${esc(text)}</p><div class="buttons"><button class="primary" data-nav="next">${esc(button)}</button></div>`);
        await this.click("[data-nav]");
    }
}
/**
 * A module paragraph. Numbered points ("1. ...") get their number set apart and their first sentence in bold; the
 * principles page's closing paragraph (the two questions) is set in a box. The same for every condition.
 */
function paragraphHtml(p, key) {
    const m = /^(\d)\. ([^.?]+[.?])(.*)$/s.exec(p);
    if (m)
        return `<p class="t-text t-point"><span class="t-num">${m[1]}</span><span><b>${esc(m[2])}</b>${esc(m[3])}</span></p>`;
    if (key) {
        // The two questions, one per line, each question in bold (the same treatment in every condition).
        const html = esc(p)
            .replace(/ ((?:Is|Which|And is|Does) [^?]+\?)/g, "<br><b>$1</b>")
            .replace(/ (If both answers|Compare what you see)/, "<br>$1");
        return `<p class="t-text t-key">${html}</p>`;
    }
    return `<p class="t-text">${esc(p)}</p>`;
}
