import { hashConfig, mergeConfig } from "../../../engine/config.js";
import { INSTRUCTION_SETS, RECON_DEFAULT_CONFIG, RECON_STUDY_SEEDS } from "../sim/config.js";
import { buildModule, judgmentCards, moduleText } from "../training/content.js";
/** Set per participant or per stage by the app, never by the config file. */
export const PER_SESSION_KEYS = ["domain", "seed", "instructionSet", "tutorial", "probesEnabled"];
/** The study's reference mission config (C3, first seed): seed and condition only change those two fields, so one hash covers all 16 cells. */
export function referenceMissionConfig(overrides) {
    return mergeConfig(RECON_DEFAULT_CONFIG, { ...overrides, seed: RECON_STUDY_SEEDS[0], instructionSet: "C3", tutorial: false, probesEnabled: true });
}
export function trainingContentHash() {
    return hashConfig({
        modules: INSTRUCTION_SETS.map((s) => {
            const m = buildModule(s);
            return { text: moduleText(m), comprehension: m.comprehension, practice: m.practice.items.map((i) => [i.kindId, i.answer, i.feedback]) };
        }),
        cards: judgmentCards().map((c) => [c.id, c.kindId, c.text, c.answer, c.transfer])
    });
}
export function computeHashes(file) {
    return { missionConfigHash: hashConfig(referenceMissionConfig(file.overrides)), trainingContentHash: trainingContentHash() };
}
/** Problems with a config file (empty = usable). */
export function checkStudyConfig(file) {
    const problems = [];
    if (!file || typeof file !== "object")
        return ["not a config object"];
    if (!file.configVersion)
        problems.push("configVersion missing");
    const defaults = RECON_DEFAULT_CONFIG;
    for (const [k, v] of Object.entries(file.overrides ?? {})) {
        if (PER_SESSION_KEYS.includes(k))
            problems.push(`"${k}" is set per session by the app, not by the config file`);
        else if (!(k in defaults))
            problems.push(`unknown setting "${k}"`);
        else if (typeof v !== typeof defaults[k])
            problems.push(`"${k}" should be a ${typeof defaults[k]}`);
        else if (v && typeof v === "object") {
            for (const [k2, v2] of Object.entries(v)) {
                const d2 = defaults[k][k2];
                if (d2 === undefined)
                    problems.push(`unknown setting "${k}.${k2}"`);
                else if (typeof v2 !== typeof d2)
                    problems.push(`"${k}.${k2}" should be a ${typeof d2}`);
            }
        }
    }
    if (file.frozen) {
        if (!file.hashes)
            problems.push("frozen config without hashes");
        else {
            const now = computeHashes(file);
            if (now.missionConfigHash !== file.hashes.missionConfigHash)
                problems.push(`mission config hash ${now.missionConfigHash} differs from the frozen ${file.hashes.missionConfigHash} (simulation defaults or the file changed)`);
            if (now.trainingContentHash !== file.hashes.trainingContentHash)
                problems.push(`training content hash ${now.trainingContentHash} differs from the frozen ${file.hashes.trainingContentHash} (training wording changed)`);
        }
    }
    return problems;
}
export async function loadStudyConfig(url) {
    try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
}
