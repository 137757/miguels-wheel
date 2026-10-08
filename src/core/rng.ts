/**
 * Cryptographically secure randomness.
 *
 * `Math.random()` is never used for the live prize draw. Every draw goes through
 * `randomUint32` so a determined customer running devtools cannot predict or
 * replay the sequence.
 */

const webCrypto: Crypto | undefined =
  typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined

const scratch = new Uint32Array(1)

/** Test seam. When set, replaces the platform CSPRNG (simulation tests only). */
let source: (() => number) | null = null

/** Uniform 32-bit unsigned integer in [0, 2^32). */
export function randomUint32(): number {
  if (source) return source() >>> 0
  if (!webCrypto?.getRandomValues) {
    throw new Error('window.crypto.getRandomValues is unavailable — refusing to draw a prize')
  }
  webCrypto.getRandomValues(scratch)
  return scratch[0]!
}

/**
 * Uniform integer in [min, max] inclusive, without modulo bias.
 * Rejection sampling against the 32-bit stream.
 */
export function randomInt(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new Error('randomInt requires integer bounds')
  }
  if (min > max) throw new Error('randomInt requires min <= max')
  const span = max - min + 1
  if (span === 1) return min

  const limit = Math.floor(0x1_0000_0000 / span) * span
  let value = randomUint32()
  while (value >= limit) value = randomUint32()
  return min + (value % span)
}

/** Uniform float in [0, 1) built from two 32-bit words for 53 bits of entropy. */
export function randomFloat(): number {
  // 27 high bits from one word, 26 from the next, over a 2^54 denominator.
  const hi = randomUint32() >>> 5 // [0, 2^27)
  const lo = randomUint32() >>> 6 // [0, 2^26)
  return (hi * 2 ** 27 + lo) / 2 ** 54
}

/** Uniform float in [min, max). */
export function randomRange(min: number, max: number): number {
  return min + randomFloat() * (max - min)
}

/** True when a real Web Crypto source is present. */
export function hasSecureRandom(): boolean {
  return Boolean(webCrypto?.getRandomValues)
}

/** Test seam: install a deterministic source. Pass null to restore the real CSPRNG. */
export function __setRandomSource(fn: (() => number) | null): void {
  source = fn
}
