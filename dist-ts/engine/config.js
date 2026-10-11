// Shared engine configuration (Study 2 brief section 12): the fields every
// scenario pack shares because they affect timing, logging or measurement -
// session length, seed, communication delay, and the two shared measurement
// instruments (DRT, SART). A pack's own config interface extends this one
// (see packs/moon-base/sim/config.ts) and its default-config object fixes the
// key order, which is what hashConfig() hashes. Every value is a starting
// value for pilot tuning, not a validated parameter.
/** Engine-field defaults (except `domain`, which each pack sets). Packs reference these when building their own full default config. */
export const ENGINE_DEFAULTS = {
    sessionLengthSeconds: 1200,
    seed: 1001,
    commandDelaySeconds: 0,
    videoDelaySeconds: 0,
    drtEnabled: true,
    drtMinIntervalSeconds: 15,
    drtMaxIntervalSeconds: 32,
    drtFirstStimulusMinDelaySeconds: 40,
    drtResponseWindowSeconds: 2.5,
    drtStimulusVisibleSeconds: 1.1,
    drtPowerLossEnabled: true,
    drtPowerLossMissThreshold: 3,
    drtPowerLossRecoveryDelaySeconds: 5,
    sartEnabled: false,
    sartIntervalSeconds: 180
};
/**
 * Merges caller overrides onto a pack's default config. Top-level keys are
 * shallow-merged; any key whose default is a plain object (e.g. a pack's
 * scoring weights) is merged one level deep, so overriding one weight keeps
 * the others. Key order follows the defaults object (new keys appended),
 * which keeps hashConfig() stable.
 */
export function mergeConfig(defaults, overrides) {
    const merged = { ...defaults, ...overrides };
    for (const [key, value] of Object.entries(defaults)) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            merged[key] = { ...value, ...overrides?.[key] };
        }
    }
    return merged;
}
/** Deterministic small hash of the config, for embedding in exports (brief 8, 9). */
export function hashConfig(config) {
    // Plain JSON.stringify (no key-array replacer): a replacer array filters
    // keys at every nesting level, which would silently drop the nested
    // `scoring` fields since their names aren't in the top-level key list.
    // Config objects are always assembled through the same code path
    // (a pack default config + mergeConfig overrides), so key order is stable here.
    const json = JSON.stringify(config);
    let h = 2166136261;
    for (let i = 0; i < json.length; i++) {
        h ^= json.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
