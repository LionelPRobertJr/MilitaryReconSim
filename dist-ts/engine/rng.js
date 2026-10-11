// Deterministic seeded PRNG (mulberry32). Brief section 12 requires one seeded
// stream per concern so that cosmetic randomness never perturbs the
// experimental sequence. Each named stream is derived from the session seed
// plus a string tag, so callers never share a generator by accident.
function hashStringToSeed(str) {
    // xmur3-style string hash, good enough to decorrelate named streams.
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Creates a named, independent RNG stream from a single integer session seed.
 * Same sessionSeed + same tag => identical stream, always.
 */
export function createStream(sessionSeed, tag) {
    const combined = (sessionSeed >>> 0) ^ hashStringToSeed(tag);
    return mulberry32(combined >>> 0);
}
/** Integer in [min, max], inclusive, drawn from the given stream. */
export function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}
