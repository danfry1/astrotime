import { describe, expect, it } from 'vitest'

import {
  absDuration,
  addDurations,
  compareDurations,
  duration,
  durationComponents,
  durationFromMillis,
  durationFromNanos,
  durationFromSeconds,
  durationsEqual,
  durationToMillis,
  durationToNanos,
  durationToSeconds,
  formatDuration,
  isNegativeDuration,
  negateDuration,
  parseDuration,
  scaleDuration,
  subtractDurations,
  TimeParseError,
  unwrap,
  ZERO_DURATION,
} from '../src/index.js'

describe('duration construction', () => {
  it('sums components exactly in nanoseconds', () => {
    const d = duration({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      millis: 5,
      micros: 6,
      nanos: 7,
    })
    expect(durationToNanos(d)).toBe(93_784_005_006_007n)
  })

  it('rounds fractional components to the nearest nanosecond', () => {
    expect(durationToNanos(duration({ seconds: 0.1 }))).toBe(100_000_000n)
    expect(durationToNanos(duration({ hours: 1.5 }))).toBe(5_400_000_000_000n)
    expect(durationToNanos(duration({ nanos: 1.6 }))).toBe(2n)
    expect(durationToNanos(duration({ nanos: 5n }))).toBe(5n)
  })

  it('rejects non-finite components', () => {
    expect(() => duration({ seconds: Number.NaN })).toThrow(RangeError)
  })

  it('converts to seconds and millis', () => {
    expect(durationToSeconds(durationFromSeconds(1.25))).toBe(1.25)
    expect(durationToMillis(durationFromMillis(-2.5))).toBe(-2.5)
    expect(durationToNanos(ZERO_DURATION)).toBe(0n)
  })

  it('decomposes into components with sign', () => {
    expect(durationComponents(durationFromNanos(-93_784_005_006_007n))).toStrictEqual({
      sign: -1,
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      nanos: 5_006_007,
    })
    expect(durationComponents(ZERO_DURATION).sign).toBe(1)
  })

  it('supports arithmetic and comparison', () => {
    const a = durationFromSeconds(3)
    const b = durationFromSeconds(5)
    expect(durationToSeconds(addDurations(a, b))).toBe(8)
    expect(durationToSeconds(subtractDurations(a, b))).toBe(-2)
    expect(durationToSeconds(negateDuration(a))).toBe(-3)
    expect(durationToSeconds(absDuration(negateDuration(a)))).toBe(3)
    expect(durationToSeconds(scaleDuration(a, 2))).toBe(6)
    expect(durationToSeconds(scaleDuration(a, 0.5))).toBe(1.5)
    expect(() => scaleDuration(a, Number.NaN)).toThrow(RangeError)
    expect(compareDurations(a, b)).toBe(-1)
    expect(compareDurations(b, a)).toBe(1)
    expect(compareDurations(a, durationFromSeconds(3))).toBe(0)
    expect(durationsEqual(a, durationFromSeconds(3))).toBe(true)
    expect(isNegativeDuration(negateDuration(a))).toBe(true)
  })
})

describe('parseDuration', () => {
  it.each([
    ['P1DT2H3M4.5S', 93_784_500_000_000n],
    ['PT90M', 5_400_000_000_000n],
    ['P2W', 1_209_600_000_000_000n],
    ['PT0.000000001S', 1n],
    ['PT1,5S', 1_500_000_000n],
    ['-PT1H', -3_600_000_000_000n],
    ['+P1D', 86_400_000_000_000n],
    ['PT0S', 0n],
    ['PT1.5H', 5_400_000_000_000n],
    ['02:03:04.005', 7_384_005_000_000n],
    ['36:00:00', 129_600_000_000_000n],
    ['1T02:03:04', 93_784_000_000_000n],
    ['1 02:03:04', 93_784_000_000_000n],
    ['-1T12:00:00', -129_600_000_000_000n],
    ['12:30', 45_000_000_000_000n],
    ['00:00:00.123456789', 123_456_789n],
  ])('parses %s', (text, nanos) => {
    expect(durationToNanos(unwrap(parseDuration(text)))).toBe(nanos)
  })

  it.each([
    ['P', 'at least one component is required'],
    ['P1Y', 'year and month designators are not supported (not fixed-length)'],
    ['P1M', 'year and month designators are not supported (not fixed-length)'],
    ['PT', 'malformed ISO 8601 duration'],
    ['P1DT', 'malformed ISO 8601 duration'],
    ['12:60', 'minutes must be 0–59'],
    ['12:00:60', 'seconds must be 0–59'],
    ['abc', 'expected ISO 8601 (P…T…) or clock (HH:mm:ss) duration'],
    ['', 'expected ISO 8601 (P…T…) or clock (HH:mm:ss) duration'],
  ])('rejects %s', (text, reason) => {
    const result = parseDuration(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeParseError)
      expect(result.error.reason).toBe(reason)
      expect(result.error.input).toBe(text)
      expect(result.error.toJSON()).toStrictEqual({
        code: 'TIME_PARSE',
        input: text,
        reason,
        format: 'duration',
      })
    }
  })
})

describe('formatDuration', () => {
  it.each([
    [93_784_500_000_000n, 'P1DT2H3M4.5S'],
    [0n, 'PT0S'],
    [-3_600_000_000_000n, '-PT1H'],
    [86_400_000_000_000n, 'P1D'],
    [1n, 'PT0.000000001S'],
    [60_000_000_000n, 'PT1M'],
  ])('formats %s as ISO', (nanos, expected) => {
    expect(formatDuration(durationFromNanos(nanos))).toBe(expected)
  })

  it('lets the largest unit absorb higher units in token patterns', () => {
    const d = duration({ days: 1, hours: 12, minutes: 5, seconds: 9, millis: 250 })
    expect(formatDuration(d, 'HH:mm:ss')).toBe('36:05:09')
    expect(formatDuration(d, 'D[d] HH:mm:ss.SSS')).toBe('1d 12:05:09.250')
    expect(formatDuration(d, 'DDD[d] HH:mm:ss')).toBe('001d 12:05:09')
    expect(formatDuration(d, 'mm:ss')).toBe('2165:09')
    expect(formatDuration(d, 's.SSSSSSSSS')).toBe('129909.250000000')
    expect(formatDuration(d, 'H[h]')).toBe('36h')
  })

  it('prefixes negative durations', () => {
    expect(formatDuration(duration({ minutes: -90 }), 'HH:mm:ss')).toBe('-01:30:00')
  })

  it('keeps unknown letters literal', () => {
    expect(formatDuration(duration({ seconds: 5 }), 'ss [seconds] x')).toBe('05 seconds x')
  })
})
