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
  ])('hashes %#', (input, digest) => {
    expect(sha1Hex(input)).toBe(digest)
  })

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
