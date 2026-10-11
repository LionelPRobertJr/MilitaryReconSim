import { LOG_SCHEMA_VERSION } from "../../../engine/events.js";
import { ENGINE_VERSION } from "../../../engine/engine.js";
import { downloadTextFile } from "../../../shell/download.js";
import { FocusTracker } from "../../../shell/participant/focus.js";
import { PageRunner } from "../../../shell/participant/forms.js";
import { completionHref, deviceInfo, readIds } from "../../../shell/participant/platform.js";
import { PARTICIPANT_LOG_SCHEMA_VERSION, SessionLog, simEventsOf, browserClocks } from "../../../shell/participant/session-log.js";
import { SessionStore } from "../../../shell/participant/store.js";
import { Uploader } from "../../../shell/participant/upload.js";
import { INSTRUCTION_SETS, RECON_STUDY_SEEDS } from "../sim/config.js";
import { RECON_PACK_VERSION } from "../sim/pack.js";
import { replayAndVerify } from "../sim/replay.js";
import { ReconSimulation } from "../sim/simulation.js";
import { CONSENT_HTML, CRITICAL_REPORT_PAGE, DECLINE_HTML, DEMOGRAPHICS, EXPERIENCE, MANIPULATION_PAGE, MOBILE_HTML, NO_ID_HTML, CONFIDENCE_IS_PLACEHOLDER, TLX_PAGE, bonusFor, bonusRulesText, debriefHtml, scoreBreakdownText, probePages } from "../shell/content.js";
import { loadDeployment } from "../shell/deployment.js";
import { checkStudyConfig, computeHashes, loadStudyConfig } from "../shell/study-config.js";
import { reconMetricsCsv, reconSessionSummary } from "../shell/summary.js";
import { buildModule, judgmentDeck } from "../training/content.js";
import { ConsoleSession } from "./console.js";
import { TrainingPlayer } from "./training.js";
// Study 2 participant flow (brief section 3), on the shared participant shell
// (src/shell/participant): device check -> consent -> setup (window check,
// server assignment, demographics, experience + attention check 1) ->
// overview with bonus rules -> interface tutorial -> training module ->
// capability judgments (pre) -> comprehension check -> mission with probes
// 1 and 2 -> NASA-TLX (+ attention check 2) -> capability judgments (post) ->
// manipulation check -> critical-event report -> debrief, score, bonus,
// completion code and redirect.
// One session log holds everything; it is saved in the browser as it grows and
// uploaded, whole, at the end of every stage and at each probe. A reload resumes
// the same session: a questionnaire or training stage restarts (its first attempt
// stays in the log), the mission is rebuilt by replaying its log and continues.
const $ = (id) => document.getElementById(id);
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const params = new URLSearchParams(location.search);
/** ?researcher=1: condition / seed / alert-mode overrides from the URL, ?stage= to jump ahead, ?speed=N, ?reset=1, data downloads at the end. */
const RESEARCHER = params.has("researcher");
/**
 * Demo build for co-authors (Oct 11, 2026; demo.html sets window.__RECON_DEMO): runs without the study server.
 * The condition and the starting point come from the URL hash (#C3, #C3-overview, #C3-mission); the seed is drawn
 * at random; nothing is uploaded; a reload starts a new session.
 */
const DEMO = window.__RECON_DEMO === true;
const DEMO_CHOICE = (() => {
    const m = /^#(C[1-4])(?:-(overview|training|mission))?$/.exec(location.hash);
    return { condition: (m?.[1] ?? "C3"), start: (m?.[2] ?? "full") };
})();
const SPEED = RESEARCHER ? Math.min(20, Math.max(1, Number(params.get("speed")) || 1)) : 1;
const STAGES = ["setup", "overview", "tutorial", "training", "judgments_pre", "comprehension", "mission", "tlx", "judgments_post", "manipulation_check", "critical_report", "debrief"];
const overlay = $("training-overlay");
const sheet = $("training-sheet");
function newId() {
    try {
        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }
    catch {
        return Math.random().toString(36).slice(2, 14);
    }
}
function speedBadge() {
    if (SPEED === 1 || document.querySelector(".speed-badge"))
        return;
    const badge = document.createElement("span");
    badge.className = "speed-badge";
    badge.textContent = `Test speed ×${SPEED}`;
    $("topbar").insertBefore(badge, $("sections"));
}
class ParticipantFlow {
    dep;
    ids;
    studyConfig;
    pages = new PageRunner(overlay, sheet, { now: () => this.log.now(), record: (e) => void this.log.record(e) });
    player = new TrainingPlayer(overlay, sheet, { now: () => this.log.now(), record: (e) => void this.log.record(e) });
    uploader;
    store;
    log;
    state;
    console = null;
    missionSim = null;
    missionSummaryCache = null;
    persistTimer = 0;
    windowOk = true;
    constructor(dep, ids, studyConfig) {
        this.dep = dep;
        this.ids = ids;
        this.studyConfig = studyConfig;
        this.uploader = new Uploader({ endpoint: dep.uploadEndpoint, attempts: 3, backoffMs: [1500, 4000] });
        this.store = new SessionStore(`recon:${ids.studyId}:${ids.participantId}:${ids.sessionId}`);
    }
    get stage() {
        return STAGES[Math.min(this.state.stageIndex, STAGES.length - 1)];
    }
    // --- persistence and upload -------------------------------------------------
    persist() {
        window.clearTimeout(this.persistTimer);
        this.store.save({ ...this.state, log: this.log.serialize() });
    }
    persistSoon() {
        window.clearTimeout(this.persistTimer);
        this.persistTimer = window.setTimeout(() => this.persist(), 400);
    }
    missionOptions() {
        const a = this.state.assignment;
        return {
            config: {
                ...this.studyConfig.overrides,
                seed: a.seed,
                instructionSet: a.condition,
                tutorial: false,
                probesEnabled: true
            },
            participantId: this.ids.participantId
        };
    }
    /** The engine's mission summary: from the live mission, or rebuilt by replaying the logged mission (after a reload). */
    missionSummary() {
        if (this.missionSim)
            return this.missionSim.summary();
        if (this.missionSummaryCache)
            return this.missionSummaryCache;
        const attempt = this.state.attempts.mission;
        if (!attempt || !this.state.assignment)
            return null;
        const ev = simEventsOf(this.log.all(), "mission", attempt);
        if (!ev.some((e) => e.type === "session_end"))
            return null;
        const r = replayAndVerify(this.missionOptions(), ev);
        if (!r.ok)
            return null;
        this.missionSummaryCache = r.sim.summary();
        return this.missionSummaryCache;
    }
    files() {
        const summary = reconSessionSummary({ events: this.log.all(), missionSummary: this.missionSummary(), deployment: this.dep });
        return { summary, files: { eventsJsonl: this.log.toJSONL(), summaryJson: JSON.stringify(summary, null, 2), metricsCsv: reconMetricsCsv(summary) } };
    }
    uploadChain = Promise.resolve();
    /** Uploads in order, without making the participant wait. */
    queueUpload(stage) {
        const p = this.uploadChain.then(() => this.upload(stage));
        this.uploadChain = p.catch(() => false);
        return p;
    }
    async upload(stage, final = false) {
        if (DEMO)
            return true; // the demo sends nothing anywhere
        const uploadSeq = ++this.state.uploadSeq;
        this.persist();
        const { files } = this.files();
        const r = await this.uploader.send({ kind: "session", domain: "military_recon", ...this.idsOnly(), stage, uploadSeq, final, files });
        this.log.record({ type: "upload_result", uploadSeq, uploadStage: stage, final, ok: r.ok, attempts: r.attempts, status: r.status, error: r.error });
        this.persist();
        return r.ok;
    }
    idsOnly() {
        return { studyId: this.ids.studyId, participantId: this.ids.participantId, sessionId: this.ids.sessionId };
    }
    async sendDemographics() {
        const answers = this.state.demographicsPending;
        if (!answers)
            return;
        if (DEMO) {
            this.state.demographicsPending = null;
            return;
        }
        const r = await this.uploader.send({ kind: "demographics", domain: "military_recon", ...this.idsOnly(), answers });
        this.log.record({ type: "demographics_upload", ok: r.ok, attempts: r.attempts, error: r.error });
        if (r.ok)
            this.state.demographicsPending = null;
        this.persist();
    }
    // --- start, resume ------------------------------------------------------------
    async begin(device) {
        if ((RESEARCHER && params.has("reset")) || DEMO)
            this.store.clear();
        const stored = this.store.load();
        if (stored) {
            this.state = stored;
            this.log = new SessionLog(browserClocks, stored.log);
            this.wireLog();
            this.log.record({ type: "session_resumed", atStage: this.stage, device });
            void this.sendDemographics();
            await this.run(true);
            return;
        }
        // Consent comes before anything is recorded or sent.
        this.log = new SessionLog(browserClocks);
        const choice = DEMO
            ? await this.pages.info("Route reconnaissance: demo", DEMO_HTML(DEMO_CHOICE.condition, DEMO_CHOICE.start), [{ label: "Start", choice: "yes", primary: true }])
            : await this.pages.info("Consent to take part", CONSENT_HTML, [
                { label: "I do not agree", choice: "no" },
                { label: "I agree to take part", choice: "yes", primary: true }
            ]);
        if (choice !== "yes") {
            const href = completionHref(this.dep.platform.noConsentUrl, this.dep.platform.noConsentCode);
            await this.pages.info("Thank you", DECLINE_HTML + (href ? `<p class="t-text"><a href="${esc(href)}">Return to ${esc(this.dep.platform.platformName)}</a></p>` : ""), []);
            return;
        }
        this.state = { version: 1, stageIndex: 0, attempts: {}, uploadSeq: 0, assignment: null, log: this.log.serialize(), demographicsPending: null, extra: {} };
        this.wireLog();
        this.log.setStage("consent", 1);
        this.log.record({
            type: "session_open",
            participantLogSchemaVersion: PARTICIPANT_LOG_SCHEMA_VERSION,
            engineLogSchemaVersion: LOG_SCHEMA_VERSION,
            domain: "military_recon",
            packVersion: RECON_PACK_VERSION,
            engineVersion: ENGINE_VERSION,
            ...this.idsOnly(),
            idSources: this.ids.sources,
            deployment: this.dep,
            phase: this.dep.phase,
            studyConfig: { configVersion: this.studyConfig.configVersion, frozen: this.studyConfig.frozen, hashes: computeHashes(this.studyConfig), overrides: this.studyConfig.overrides },
            device,
            researcher: RESEARCHER,
            speed: SPEED,
            probeConfidenceItemPlaceholder: CONFIDENCE_IS_PLACEHOLDER
        });
        this.log.record({ type: "consent", agreed: true });
        const skipTo = RESEARCHER ? STAGES.indexOf(params.get("stage")) : DEMO && DEMO_CHOICE.start !== "full" ? STAGES.indexOf(DEMO_CHOICE.start) : -1;
        this.persist();
        void this.queueUpload("consent");
        if (skipTo > 0 && DEMO) {
            // Demo shortcut: no setup forms; just an assignment.
            this.state.assignment = await this.assign();
            this.state.stageIndex = skipTo;
            this.log.record({ type: "demo_skip", toStage: STAGES[skipTo] });
        }
        else if (skipTo > 0) {
            // Researcher shortcut: assignment and setup are still needed to run anything after them.
            await this.runStage("setup", false);
            this.state.stageIndex = skipTo;
            this.log.record({ type: "researcher_skip", toStage: STAGES[skipTo] });
        }
        await this.run(false);
    }
    wireLog() {
        this.log.onRecord((e) => {
            if (e.src === "shell")
                this.persistSoon();
        });
        const focus = new FocusTracker(this.log, () => {
            const sim = this.missionSim;
            if (this.stage !== "mission" || !sim)
                return {};
            const w = sim.snapshot();
            return { section: w.section, simTime: w.simTime };
        });
        focus.start();
        window.setInterval(() => {
            if (this.missionSim && !this.missionSim.isEnded())
                this.persist();
        }, 5000);
        window.addEventListener("pagehide", () => this.persist());
        const checkWindow = () => {
            const ok = DEMO || (window.innerWidth >= this.dep.minWindow.width && window.innerHeight >= this.dep.minWindow.height);
            $("too-small").hidden = ok;
            if (ok !== this.windowOk) {
                this.windowOk = ok;
                this.log.record({ type: "window_size", ok, width: window.innerWidth, height: window.innerHeight });
            }
        };
        window.addEventListener("resize", checkWindow);
        checkWindow();
    }
    // --- the stage loop -----------------------------------------------------------
    async run(resuming) {
        let resumed = resuming;
        while (this.state.stageIndex < STAGES.length) {
            const stage = this.stage;
            const missionContinues = resumed && stage === "mission" && this.missionHasStarted();
            const attempt = missionContinues ? this.state.attempts.mission : (this.state.attempts[stage] ?? 0) + 1;
            this.state.attempts[stage] = attempt;
            this.log.setStage(stage, attempt);
            const t0 = this.log.now();
            this.log.record({ type: missionContinues ? "stage_resume" : "stage_start" }); // stage and attempt are in the envelope
            this.persist();
            await this.runStage(stage, missionContinues);
            this.log.record({ type: "stage_end", seconds: Math.round((this.log.now() - t0) * 1000) / 1000 });
            this.state.stageIndex++;
            this.persist();
            if (stage !== "debrief")
                void this.queueUpload(stage);
            resumed = false;
        }
    }
    missionHasStarted() {
        const attempt = this.state.attempts.mission;
        return !!attempt && simEventsOf(this.log.all(), "mission", attempt).length > 0;
    }
    async runStage(stage, continuing) {
        const condition = () => this.state.assignment.condition;
        switch (stage) {
            case "setup":
                await this.windowGate();
                if (!this.state.assignment)
                    this.state.assignment = await this.assign();
                await this.pages.page(DEMOGRAPHICS).then((a) => {
                    this.state.demographicsPending = a;
                    this.persist();
                });
                void this.sendDemographics();
                await this.pages.page(EXPERIENCE);
                return;
            case "overview":
                return this.overview();
            case "tutorial":
                return this.tutorial();
            case "training":
                return this.player.runModule(buildModule(condition()));
            case "judgments_pre":
                return this.player.runJudgments(judgmentDeck("pre"), "pre");
            case "comprehension":
                return this.player.runComprehension(buildModule(condition()));
            case "mission":
                return this.mission(continuing);
            case "tlx":
                await this.pages.page(TLX_PAGE);
                return;
            case "judgments_post":
                return this.player.runJudgments(judgmentDeck("post"), "post");
            case "manipulation_check":
                await this.pages.page(MANIPULATION_PAGE);
                return;
            case "critical_report":
                await this.pages.page(CRITICAL_REPORT_PAGE);
                return;
            case "debrief":
                return this.debrief();
        }
    }
    async windowGate() {
        if (DEMO)
            return;
        const ok = () => window.innerWidth >= this.dep.minWindow.width && window.innerHeight >= this.dep.minWindow.height;
        if (ok())
            return;
        const { width, height } = this.dep.minWindow;
        this.pages.show(`<h1>Please make the window larger</h1><p class="t-text">This study needs a browser window of at least ${width} × ${height} pixels. Yours is <b id="win-size"></b>. Maximise the window, or zoom out (Ctrl and minus, or ⌘ and minus on a Mac), until the button below turns on.</p><div class="buttons"><button class="primary" id="win-ok" disabled>Continue</button></div>`);
        await new Promise((resolve) => {
            const update = () => {
                const sz = $("win-size");
                if (sz)
                    sz.textContent = `${window.innerWidth} × ${window.innerHeight}`;
                const b = $("win-ok");
                if (b)
                    b.disabled = !ok();
            };
            update();
            window.addEventListener("resize", update);
            $("win-ok").addEventListener("click", () => {
                window.removeEventListener("resize", update);
                resolve();
            });
        });
    }
    async assign() {
        if (DEMO) {
            const a = { condition: DEMO_CHOICE.condition, seed: RECON_STUDY_SEEDS[Math.floor(Math.random() * RECON_STUDY_SEEDS.length)], source: "demo", index: null, block: null };
            this.log.record({ type: "assignment", ...a });
            return a;
        }
        const override = RESEARCHER && params.get("condition") && params.get("seed");
        if (override) {
            const condition = params.get("condition");
            const seed = Number(params.get("seed"));
            if (!INSTRUCTION_SETS.includes(condition) || !RECON_STUDY_SEEDS.includes(seed))
                throw new Error("researcher override: bad condition or seed");
            const a = { condition, seed, source: "researcher", index: null, block: null };
            this.log.record({ type: "assignment", ...a });
            return a;
        }
        for (;;) {
            try {
                const q = new URLSearchParams({ domain: "military_recon", study: this.ids.studyId, pid: this.ids.participantId, session: this.ids.sessionId });
                const res = await fetch(`${this.dep.assignEndpoint}?${q}`, { cache: "no-store" });
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
                const j = (await res.json());
                if (!INSTRUCTION_SETS.includes(j.condition) || !RECON_STUDY_SEEDS.includes(j.seed))
                    throw new Error("bad assignment");
                const a = { condition: j.condition, seed: j.seed, source: "server", index: j.index, block: j.block };
                this.log.record({ type: "assignment", ...a });
                return a;
            }
            catch (err) {
                this.log.record({ type: "assignment_failed", error: String(err) });
                await this.pages.info("Connecting to the study server", `<p class="t-text">We could not reach the study server. Please check your internet connection and try again.</p>`, [{ label: "Try again", choice: "retry", primary: true }]);
            }
        }
    }
    async overview() {
        this.pages.hide();
        $("bonus-rules").textContent = bonusRulesText(this.dep.payment);
        $("start-overlay").hidden = false;
        await new Promise((r) => $("btn-tutorial").addEventListener("click", () => r(), { once: true }));
        $("start-overlay").hidden = true;
    }
    runConsole(sim, tutorial) {
        this.pages.hide();
        $("app").hidden = false;
        speedBadge();
        return new Promise((resolve) => {
            this.console = new ConsoleSession({
                sim,
                tutorial,
                speed: SPEED,
                onEnd: (s) => {
                    this.console = null;
                    resolve(s);
                },
                onNote: (kind, detail) => void this.log.record({ type: "ui_note", kind, ...detail }),
                onPause: async (reason) => {
                    if (reason !== "probe_1" && reason !== "probe_2")
                        return;
                    this.persist(); // the mission up to the pause is saved, so a reload comes back to this probe
                    for (const spec of probePages(reason))
                        await this.pages.page(spec);
                    this.pages.hide();
                    void this.queueUpload(`mission:${reason}`);
                }
            });
        });
    }
    newSim(options) {
        const sim = new ReconSimulation(options);
        for (const e of sim.logger.all())
            this.log.recordSim(e);
        sim.logger.subscribe((e) => this.log.recordSim(e));
        return sim;
    }
    async tutorial() {
        const a = this.state.assignment;
        const sim = this.newSim({ config: { ...this.studyConfig.overrides, seed: a.seed, instructionSet: a.condition, tutorial: true, probesEnabled: false }, participantId: this.ids.participantId });
        const done = this.runConsole(sim, true);
        const finished = await done;
        const tookOver = finished.logger.all().some((e) => e.type === "operator_action" && e.accepted && e.action === "reroute");
        $("tutorial-done-text").textContent =
            `You have seen how the vehicles and their status lights behave${tookOver ? ", and taken over a vehicle by clicking its waypoints" : ""}. ` +
                (tookOver ? "" : "In the mission, you take over by clicking one of the waypoints beside an obstacle in a vehicle's camera view. ") +
                "Remember that Stop halts a vehicle while you look, and Continue lets it drive on. " +
                `Your practice score was ${finished.snapshot().score} (${scoreBreakdownText(finished.snapshot().scoreBreakdown)}); it does not count towards your bonus. ` +
                "Next comes a short training module about when to take over, then the mission itself, which works the same way on longer routes.";
        $("tutorial-done-overlay").hidden = false;
        await new Promise((r) => $("btn-start-mission").addEventListener("click", () => r(), { once: true }));
        $("tutorial-done-overlay").hidden = true;
        $("app").hidden = true;
    }
    async mission(continuing) {
        let sim;
        if (continuing) {
            const logged = simEventsOf(this.log.all(), "mission", this.state.attempts.mission);
            const r = replayAndVerify(this.missionOptions(), logged);
            if (!r.ok) {
                this.log.record({ type: "mission_interrupted", reason: "replay_mismatch", index: r.index });
                await this.pages.info("The mission was interrupted", `<p class="t-text">The mission could not be restored after the page was reloaded. Please continue with the last few questions.</p>`, [{ label: "Continue", choice: "ok", primary: true }]);
                return;
            }
            sim = r.sim;
            for (const e of sim.logger.all().slice(logged.length))
                this.log.recordSim(e);
            sim.logger.subscribe((e) => this.log.recordSim(e));
            const w = sim.snapshot();
            this.log.record({ type: "mission_restored", simTime: w.simTime, replayedEvents: logged.length });
            if (!sim.isEnded()) {
                await this.pages.info("Continue the mission", `<p class="t-text">The page was reloaded. The mission continues from where it stopped, at mission time ${Math.floor(w.simTime / 60)}:${String(Math.floor(w.simTime % 60)).padStart(2, "0")}.</p>`, [{ label: "Continue the mission", choice: "go", primary: true }]);
            }
        }
        else {
            await this.pages.info("Ready for the mission", `<p class="t-text">The mission has three sections and pauses for a short check-in after Sections A and B. It ends at 24:00 even if a vehicle has not reached the objective.</p><p class="t-text">You can act on a vehicle at any time, as soon as you see something on its camera; you do not have to wait for it to ask for help.</p><p class="t-text">${esc(bonusRulesText(this.dep.payment))}</p>`, [{ label: "Start the mission", choice: "go", primary: true }]);
            sim = this.newSim(this.missionOptions());
        }
        this.missionSim = sim;
        if (sim.isEnded()) {
            this.missionSummaryCache = sim.summary();
        }
        else {
            await this.runConsole(sim, false);
            this.missionSummaryCache = sim.summary();
        }
        this.missionSim = null;
        // A clear end to the mission before the questions (no score yet: brief section 3, scores come after the measures).
        const done = sim.snapshot().missionComplete;
        await this.pages.info("The mission is over", `<p class="t-text">${done ? "Both vehicles reached the objective." : "The mission time is up."} Next come a few questions about the mission. Your score and bonus are shown at the end.</p>`, [{ label: "Continue", choice: "go", primary: true }]);
        $("app").hidden = true;
    }
    async debrief() {
        const mission = this.missionSummary();
        const score = mission ? mission.score : 0;
        if (DEMO) {
            const m = mission ?? {};
            const pct = (v) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "–");
            const html = `<p class="t-text">That is the end of the demo (condition <b>${this.state.assignment?.condition ?? ""}</b>, route seed ${this.state.assignment?.seed ?? ""}).</p>
        <p class="t-text">Mission score <b>${score}</b>${m.scoreBreakdown ? ` (${esc(scoreBreakdownText(m.scoreBreakdown))})` : ""}.</p>
        <ul><li>Obstacles from training handled correctly: ${pct(m.trainedDecisionAccuracy)}</li><li>New obstacles (held back from training) handled correctly: ${pct(m.heldBackDecisionAccuracy)}</li><li>Times a vehicle got stuck: ${m.immobilisations ?? "–"}; take-overs it did not need: ${m.unnecessaryReroutes ?? "–"}</li></ul>
        <p class="t-text">Nothing was sent anywhere. To try another condition, go back to the demo's start page.</p>`;
            await this.pages.info("Demo complete", html, history.length > 1 ? [{ label: "Back to the start page", choice: "back", primary: true }] : []);
            history.back();
            return;
        }
        const amount = bonusFor(score, this.dep.payment);
        if (!this.log.all().some((e) => e.type === "session_complete"))
            this.log.record({ type: "session_complete", score, bonus: amount });
        this.pages.show(`<h1>Thank you</h1><p class="t-text">Saving your responses…</p>`);
        await this.uploadChain;
        let ok = await this.upload("debrief", true);
        const code = this.dep.platform.completionCode || null;
        const href = completionHref(this.dep.platform.completionUrl, this.dep.platform.completionCode);
        for (;;) {
            const status = ok ? "" : `<p class="t-warn">Your responses could not be sent yet (connection problem). They are kept in this browser. Please press “Try again”; if it keeps failing, contact the research team before closing this window.</p>`;
            const research = RESEARCHER ? `<div class="buttons researcher-dl"><button data-dl="events">events.jsonl</button><button data-dl="summary">summary.json</button><button data-dl="metrics">metrics.csv</button></div>` : "";
            const buttons = [
                ...(ok ? [] : [{ label: "Try again", choice: "retry" }]),
                ...(href ? [{ label: `Return to ${this.dep.platform.platformName}`, choice: "return", primary: true }] : [])
            ];
            const shown = this.pages.info("Thank you", debriefHtml({ score, bonus: `${this.dep.payment.currency}${amount.toFixed(2)}`, code, platform: this.dep.platform.platformName, breakdown: mission?.scoreBreakdown ? scoreBreakdownText(mission.scoreBreakdown) : undefined }) + status + research + (href ? "" : `<p class="t-text">You can now close this window.</p>`), buttons);
            for (const b of sheet.querySelectorAll("[data-dl]")) {
                b.onclick = () => {
                    const { files } = this.files();
                    const prefix = `recon_${this.ids.participantId}_${this.ids.sessionId}_`;
                    const k = b.dataset.dl;
                    if (k === "events")
                        downloadTextFile(`${prefix}events.jsonl`, files.eventsJsonl, "application/x-ndjson");
                    if (k === "summary")
                        downloadTextFile(`${prefix}summary.json`, files.summaryJson, "application/json");
                    if (k === "metrics")
                        downloadTextFile(`${prefix}metrics.csv`, files.metricsCsv, "text/csv");
                };
            }
            const choice = await shown;
            if (choice === "retry") {
                ok = await this.upload("debrief", true);
                continue;
            }
            if (choice === "return" && href) {
                this.log.record({ type: "redirect", to: "completion" });
                await Promise.race([this.upload("redirect", true), new Promise((r) => setTimeout(r, 3000))]);
                location.href = href;
                return;
            }
        }
    }
}
function DEMO_HTML(condition, start) {
    const names = { C1: "C1: rule, listed cases", C2: "C2: rule, any obstacle", C3: "C3: case list", C4: "C4: capability model" };
    const from = { full: "the full session, from the first questions to the end (about 45–60 minutes)", overview: "the overview, the practice drive and the training, then the mission and the questions after it", training: "the training module, then the mission and the questions after it", mission: "the mission itself (about 20 minutes)" };
    return `<p class="t-text">This is a demo of the Study 2 simulation for the research team. It runs entirely in your browser: nothing you do is sent or stored anywhere, and reloading the page starts again.</p>
    <p class="t-text">Condition: <b>${names[condition]}</b>. You will go through ${from[start] ?? from.full}.</p>
    <p class="t-text">For the best experience use a laptop or desktop with the browser window maximised (at least 1280 × 720).</p>`;
}
async function main() {
    for (const el of document.querySelectorAll("[data-researcher]"))
        el.hidden = !RESEARCHER;
    const dep = await loadDeployment();
    const device = deviceInfo(navigator, window);
    const pages = new PageRunner(overlay, sheet, { now: () => 0, record: () => { } });
    if (device.mobile && !RESEARCHER) {
        await pages.info("Please use a computer", MOBILE_HTML, []);
        return;
    }
    let ids = readIds(params, dep.platform, { studyId: dep.studyId }, newId);
    if (!ids && (RESEARCHER || DEMO))
        ids = readIds(new URLSearchParams({ pid: `researcher-${newId().slice(0, 6)}` }), dep.platform, { studyId: dep.studyId }, newId);
    if (!ids) {
        await pages.info("This link is incomplete", NO_ID_HTML, []);
        return;
    }
    // No session ID from the platform: keep the generated one for this participant, so a reload resumes.
    if (ids.sources.sessionId === "generated") {
        const key = `recon-session:${ids.studyId}:${ids.participantId}`;
        try {
            const prev = localStorage.getItem(key);
            if (prev && !(RESEARCHER && params.has("reset")))
                ids = { ...ids, sessionId: prev };
            else
                localStorage.setItem(key, ids.sessionId);
        }
        catch {
            /* no storage: no resume */
        }
    }
    // The versioned study config: must load and check out, and be frozen for confirmatory data collection.
    const studyConfig = await loadStudyConfig(dep.configFile);
    const problems = studyConfig ? checkStudyConfig(studyConfig) : [`could not load ${dep.configFile}`];
    if (dep.phase === "confirmatory" && studyConfig && !studyConfig.frozen)
        problems.push("confirmatory phase needs a frozen config");
    if (problems.length) {
        console.error("[study config]", problems);
        if (!RESEARCHER && !DEMO) {
            await pages.info("This study is not available right now", `<p class="t-text">Please try again later. If this message stays, contact the research team.</p>`, []);
            return;
        }
        await pages.info("Study config problems (researcher view)", `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul><p class="t-text">Participants would see "not available". Continue anyway for testing?</p>`, [{ label: "Continue anyway", choice: "go", primary: true }]);
    }
    const flow = new ParticipantFlow(dep, ids, studyConfig ?? { configVersion: "none", frozen: false, overrides: {} });
    window.__participant = {
        stage: () => flow.stage,
        events: () => flow.log?.all() ?? [],
        ids: () => flow.ids,
        assignment: () => flow.state?.assignment ?? null,
        files: () => flow.files().files
    };
    window.__recon = () => flow.console?.sim ?? null;
    /** Test seam: the screen position of the middle waypoint shown in a UGV's view, or null when none is shown. */
    window.__reconWaypoint = (robotId) => {
        const el = document.querySelector(`#panel-${robotId} [data-waypoint="2"]`);
        if (!el)
            return null;
        const r = el.getBoundingClientRect();
        return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    };
    await flow.begin(device);
}
void main();
