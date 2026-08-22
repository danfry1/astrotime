import { describe, expect, it } from 'vitest'

import { sha1Hex } from '../src/sha1.js'

describe('sha1 (FIPS 180 vectors)', () => {
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['a', '86f7e437faa5a7fce15d1ddcb9eaeaea377667b8'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    ],
    ['a'.repeat(1_000_000), '34aa973cd4c4daa4f61eeb2bdbad27316534016f'],
  ])(
    'hashes %#',
    (input, digest) => {
      expect(sha1Hex(input)).toBe(digest)
    },
    // Instrumenting the million-byte FIPS vector under eight Stryker workers
    // can exceed Vitest's 5 s default on a busy host; the assertion is unchanged.
    15_000,
  )

  it('handles multi-block boundary lengths (55, 56, 63, 64, 65 bytes)', () => {
    // Known digests for '0'.repeat(n) around the padding boundary.
    const known: Record<number, string> = {
      55: '8fffd3df3d041baf53b27f42ec802cfb362710bd',
      56: '2a04b5125ba4030ef13232ecf1b72849f6ec9e97',
      63: '70bc07198e6bcb86643b20d7fe3a75d6d19b8439',
      64: '0114498021cb8c4f1519f96bdf58dd806f3adb63',
      65: '99991a46f79e031e016f6b02b28cf8f62167dfca',
    }
    for (const [n, digest] of Object.entries(known)) {
      expect(sha1Hex('0'.repeat(Number(n)))).toBe(digest)
    }
  })
})

/**
 * Padding boundaries. A SHA-1 message is padded with 0x80, then zeroes, then
 * an eight-byte length. When the message length mod 64 reaches 56 there is no
 * longer room for that length in the final block and a whole extra block is
 * required — the single most common place a hand-written implementation is
 * wrong, and the one that matters here because this digest is what verifies
 * the `#h` integrity record on a leap-second table.
 *
 * Expected digests generated with node:crypto, not written by hand.
 */
describe('sha1 padding boundaries', () => {
  it.each([
    [54, 'b05d71c64979cb95fa74a33cdb31a40d258ae02e'],
    [55, 'c1c8bbdc22796e28c0e15163d20899b65621d65a'],
    [56, 'c2db330f6083854c99d4b5bfb6e8f29f201be699'],
    [57, 'f08f24908d682555111be7ff6f004e78283d989a'],
    [63, '03f09f5b158a7a8cdad920bddc29b81c18a551f5'],
    [64, '0098ba824b5c16427bd7a1122a5a442a25ec644d'],
    [65, '11655326c708d70319be2610e8a57d9a5b959d3b'],
    [119, 'ee971065aaa017e0632a8ca6c77bb3bf8b1dfc56'],
    [120, 'f34c1488385346a55709ba056ddd08280dd4c6d6'],
    [127, '89d95fa32ed44a7c610b7ee38517ddf57e0bb975'],
    [128, 'ad5b3fdbcb526778c2839d2f151ea753995e26a0'],
  ])('hashes a %i-byte message', (length, expected) => {
    expect(sha1Hex('a'.repeat(length))).toBe(expected)
  })
})
