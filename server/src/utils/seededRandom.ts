// Seeded PRNG for reproducible group-chat timing: each stream depends only on (seed, key).
// Samplers mirror the client's in conversations.ts, with Math.random() swapped for rng().

// xmur3-style string hash -> uint32
export function hashStringToUint32(s: string): number {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
}

// mulberry32: uint32 seed -> stream of [0,1)
export function mulberry32(a: number): () => number {
    let t = a >>> 0;
    return function () {
        t = (t + 0x6d2b79f5) >>> 0;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// Fresh deterministic stream keyed by (seed, key).
export function makeRng(seed: string | number, key: string): () => number {
    return mulberry32(hashStringToUint32(`${seed}::${key}`));
}

export function normalRandom(rng: () => number, mean: number, stdDev: number): number {
    // Box-Muller
    let u = 1 - rng(); // (0,1], avoids log(0)
    let v = rng();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + stdDev * z;
}

export function gammaRandom(rng: () => number, shape: number, scale: number): number {
    // Marsaglia-Tsang
    if (shape < 1) {
        shape += 1;
    }
    let d = shape - 1 / 3;
    let c = 1 / Math.sqrt(9 * d);
    let x, v;
    do {
        let u = rng();
        let n = normalRandom(rng, 0, 1);
        v = Math.pow(1 + c * n, 3);
        if (v > 0 && Math.log(u) < 0.5 * n * n + d * (1 - v + Math.log(v))) {
            x = d * v;
            break;
        }
    } while (true);
    return x * scale;
}

export function getResponseDelay(rng: () => number, nChar: number, nCharPrev: number): number {
    // Jones C.R. et al. 2024 stochastic delay formula
    let delay = (normalRandom(rng, 0.3, 0.03) * nChar
        + gammaRandom(rng, 2.5, 0.25)
        + normalRandom(rng, 0.03, 0.003) * nCharPrev);
    return delay; // seconds
}
