import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  durationFromNanos,
  durationToNanos,
  formatDuration,
  formatInstant,
  formatIso,
  formatOrdinal,
  instantFromJulianDateParts,
  instantFromScaleNanos,
  instantFromTaiNanos,
  instantFromUnixNanos,
  instantFromUtc,
  instantToJulianDateParts,
  instantToScaleNanos,
  instantToTaiNanos,
  instantToUnixNanos,
  instantToUtc,
  isAstrotimeError,
  isLeapSecond,
  parseDuration,
  parseInstant,
  parseInstantOrThrow,
  parseLeapSecondsList,
  TIME_SCALES,
} from '../src/index.js'

// ±2^60 ns ≈ ±36 000 years around 1970 — well inside the calendar's range.
const taiNanos = fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n })
// 1972–2200, where leap seconds exist and are dense enough to be hit.
const modernTaiNanos = fc.bigInt({ min: 63_072_010_000_000_000n, max: 7_258_118_400_000_000_000n })
const RUNS = { numRuns: 2_000 }

describe('round-trip properties', () => {
  it('instant → UTC fields → instant is the identity', () => {
    fc.assert(
      fc.property(taiNanos, (n) => {
        const i = instantFromTaiNanos(n)
        const back = instantFromUtc(instantToUtc(i))
        expect(back.ok && instantToTaiNanos(back.value)).toBe(n)
      }),
      RUNS,
    )
  })

  it('ISO format at nanosecond precision parses back to the same instant (all scales)', () => {
    fc.assert(
      fc.property(taiNanos, fc.constantFrom(...TIME_SCALES), (n, scale) => {
        const i = instantFromTaiNanos(n)
        expect(
          instantToTaiNanos(parseInstantOrThrow(formatIso(i, { precision: 'nanos', scale }))),
        ).toBe(n)
        expect(
          instantToTaiNanos(
            parseInstantOrThrow(formatOrdinal(i, { precision: 'nanos', scale }), { scale }),
          ),
        ).toBe(n)
      }),
      RUNS,
    )
  })

  it('token-pattern format parses back to the same instant', () => {
    fc.assert(
      fc.property(taiNanos, (n) => {
        const i = instantFromTaiNanos(n)
        const pattern = 'YYYY-DDD[T]HH:mm:ss.SSSSSSSSS Z'
        expect(
          instantToTaiNanos(
            parseInstantOrThrow(formatInstant(i, pattern, { scale: 'tai' }), { format: pattern }),
          ),
        ).toBe(n)
      }),
      RUNS,
    )
  })

  it('Unix nanos round-trip outside inserted leap seconds', () => {
    fc.assert(
      fc.property(modernTaiNanos, (n) => {
        const i = instantFromTaiNanos(n)
        fc.pre(!isLeapSecond(i))
        expect(instantToTaiNanos(instantFromUnixNanos(instantToUnixNanos(i)))).toBe(n)
      }),
      RUNS,
    )
  })

  it('scale nanos round-trip exactly for every scale (TDB included)', () => {
    fc.assert(
      fc.property(taiNanos, fc.constantFrom(...TIME_SCALES), (n, scale) => {
        const i = instantFromTaiNanos(n)
        fc.pre(!(scale === 'utc' && isLeapSecond(i)))
        expect(instantToTaiNanos(instantFromScaleNanos(instantToScaleNanos(i, scale), scale))).toBe(
          n,
        )
      }),
      RUNS,
    )
  })

  it('two-part Julian dates round-trip to within 1 µs on every scale', () => {
    fc.assert(
      fc.property(modernTaiNanos, fc.constantFrom(...TIME_SCALES), (n, scale) => {
        const i = instantFromTaiNanos(n)
        const { jd1, jd2 } = instantToJulianDateParts(i, scale)
        expect(jd2 >= 0 && jd2 < 1).toBe(true)
        const back = instantToTaiNanos(instantFromJulianDateParts(jd1, jd2, scale))
        const error = back > n ? back - n : n - back
        expect(error <= 1_000n).toBe(true)
      }),
      RUNS,
    )
  })

  it('durations survive ISO and token formatting', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), (n) => {
        const d = durationFromNanos(n)
        const viaIso = parseDuration(formatDuration(d))
        expect(viaIso.ok && durationToNanos(viaIso.value)).toBe(n)
        const viaClock = parseDuration(formatDuration(d, 'D[T]HH:mm:ss.SSSSSSSSS'))
        expect(viaClock.ok && durationToNanos(viaClock.value)).toBe(n)
      }),
      RUNS,
    )
  })

  it('ordering is preserved by formatIso (lexicographic) within one era', () => {
    fc.assert(
      fc.property(modernTaiNanos, modernTaiNanos, (a, b) => {
        const sa = formatIso(instantFromTaiNanos(a), { precision: 'nanos' })
        const sb = formatIso(instantFromTaiNanos(b), { precision: 'nanos' })
        expect(sa < sb).toBe(a < b)
      }),
      RUNS,
    )
  })
})

describe('parsers never throw', () => {
  it('parseInstant / parseDuration / parseLeapSecondsList return Results for arbitrary text', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom('iso', 'ordinal', 'YYYY-MM-DD HH:mm:ss.SSS', 'YYYYDDD'),
        (text, format) => {
          const instant = parseInstant(text, { format })
          expect(instant.ok || isAstrotimeError(instant.error)).toBe(true)
          const dur = parseDuration(text)
          expect(dur.ok || isAstrotimeError(dur.error)).toBe(true)
          const table = parseLeapSecondsList(text)
          expect(table.ok || isAstrotimeError(table.error)).toBe(true)
        },
      ),
      { numRuns: 3_000 },
    )
  })
})
