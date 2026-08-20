import { describe, expect, it } from 'vitest'

import {
  absDuration,
  addDurations,
  compareDurations,
  duration,
  durationFromDays,
  durationFromHours,
  durationFromMillis,
  durationFromMinutes,
  durationFromNanos,
  durationFromSeconds,
  durationsEqual,
  durationToComponents,
  durationToDays,
  durationToHours,
  durationToMillis,
  durationToMinutes,
  durationToNanos,
  durationToSeconds,
  formatDuration,
  isDuration,
  isNegativeDuration,
  negateDuration,
  parseDuration,
  parseDurationOrThrow,
  scaleDuration,
  subtractDurations,
  TimeParseError,
  ZERO_DURATION,
} from '../src/index.js'
import { expectErr } from './helpers.js'

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

  it('rounds fractional components half away from zero', () => {
    expect(durationToNanos(duration({ seconds: 0.1 }))).toBe(100_000_000n)
    expect(durationToNanos(duration({ hours: 1.5 }))).toBe(5_400_000_000_000n)
    expect(durationToNanos(duration({ nanos: 1.6 }))).toBe(2n)
    expect(durationToNanos(duration({ nanos: 5n }))).toBe(5n)
    expect(durationToNanos(duration({ seconds: 1.5e-9 }))).toBe(2n)
    expect(durationToNanos(duration({ seconds: -1.5e-9 }))).toBe(-2n)
    expect(durationToNanos(duration({ days: 1e15 }))).toBe(86_400_000_000_000_000_000_000_000_000n)
  })

  it('rejects non-finite components with a RangeError', () => {
    expect(() => duration({ seconds: Number.NaN })).toThrow(
      new RangeError('Duration seconds must be a finite number, got NaN'),
    )
    expect(() => durationFromDays(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('converts to and from units', () => {
    expect(durationToSeconds(durationFromSeconds(1.25))).toBe(1.25)
    expect(durationToMillis(durationFromMillis(-2.5))).toBe(-2.5)
    expect(durationToMinutes(durationFromMinutes(90))).toBe(90)
    expect(durationToHours(durationFromHours(1.5))).toBe(1.5)
    expect(durationToDays(durationFromDays(2))).toBe(2)
    expect(durationToNanos(ZERO_DURATION)).toBe(0n)
    expect(durationToSeconds(durationFromNanos(-1n))).toBe(-1e-9)
  })

  it('throws RangeError when the day count cannot be a safe integer', () => {
    const huge = durationFromNanos(2n ** 105n)
    expect(() => durationToComponents(huge)).toThrow(
      new RangeError('Duration too large to decompose into safe-integer components'),
    )
    expect(() => formatDuration(huge)).toThrow(RangeError)
  })

  it('decomposes into components with sign', () => {
    expect(durationToComponents(durationFromNanos(-93_784_005_006_007n))).toStrictEqual({
      sign: -1,
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      nanos: 5_006_007,
    })
    expect(durationToComponents(ZERO_DURATION).sign).toBe(1)
  })

  it('supports arithmetic and comparison', () => {
    const a = durationFromSeconds(3)
    const b = durationFromSeconds(5)
    expect(durationToSeconds(addDurations(a, b))).toBe(8)
    expect(durationToSeconds(subtractDurations(a, b))).toBe(-2)
    expect(durationToSeconds(negateDuration(a))).toBe(-3)
    expect(durationToSeconds(absDuration(negateDuration(a)))).toBe(3)
    expect(absDuration(a)).toBe(a)
    expect(compareDurations(a, b)).toBe(-1)
    expect(compareDurations(b, a)).toBe(1)
    expect(compareDurations(a, durationFromSeconds(3))).toBe(0)
    expect(durationsEqual(a, durationFromSeconds(3))).toBe(true)
    expect(isNegativeDuration(negateDuration(a))).toBe(true)
  })

  it('scales exactly, including huge values and non-integer factors', () => {
    const a = durationFromSeconds(3)
    expect(durationToSeconds(scaleDuration(a, 2))).toBe(6)
    expect(durationToSeconds(scaleDuration(a, 0.5))).toBe(1.5)
    expect(durationToNanos(scaleDuration(duration({ days: 365, nanos: 1n }), 1.5))).toBe(
      47_304_000_000_000_002n,
    )
    expect(
      durationToNanos(scaleDuration(durationFromNanos(123_456_789_012_345_678_901n), 0.5)),
    ).toBe(61_728_394_506_172_839_451n)
    expect(durationToNanos(scaleDuration(durationFromNanos(5n), 0.5))).toBe(3n)
    expect(durationToNanos(scaleDuration(durationFromNanos(-5n), 0.5))).toBe(-3n)
    expect(durationToNanos(scaleDuration(durationFromNanos(7n), 0.1))).toBe(1n)
    expect(() => scaleDuration(a, Number.NaN)).toThrow(
      new RangeError('Duration factor must be a finite number, got NaN'),
    )
  })

  it('values are frozen, branded and serialisable', () => {
    const d = duration({ hours: 1, seconds: 0.5 })
    expect(Object.isFrozen(d)).toBe(true)
    expect(isDuration(d)).toBe(true)
    expect(isDuration({ nanos: 1n })).toBe(false)
    expect(JSON.stringify({ d })).toBe('{"d":"PT1H0.5S"}')
    expect(String(d)).toBe('PT1H0.5S')
    expect(durationsEqual(parseDurationOrThrow(String(d)), d)).toBe(true)
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
    ['P999999999999999D', 86_399_999_999_999_913_600_000_000_000n],
    ['02:03:04.005', 7_384_005_000_000n],
    ['36:00:00', 129_600_000_000_000n],
    ['1T02:03:04', 93_784_000_000_000n],
    ['1 02:03:04', 93_784_000_000_000n],
    ['-1T12:00:00', -129_600_000_000_000n],
    ['12:30', 45_000_000_000_000n],
    ['00:00:00.123456789', 123_456_789n],
  ])('parses %s', (text, nanos) => {
    expect(durationToNanos(parseDurationOrThrow(text))).toBe(nanos)
  })

  it.each([
    ['P', 'at least one component is required'],
    ['P1Y', 'year and month designators are not supported (not fixed-length)'],
    ['P1M', 'year and month designators are not supported (not fixed-length)'],
    ['PT', 'malformed ISO 8601 duration'],
    ['P1DT', 'malformed ISO 8601 duration'],
    ['P-1D', 'malformed ISO 8601 duration'],
    ['P99999999999999999999D', 'malformed ISO 8601 duration'],
    ['P1W2D', 'a week component cannot be combined with other components'],
    ['P1.5DT1H', 'only the last component may have a fraction'],
    ['PT1.5H30M', 'only the last component may have a fraction'],
    ['12:60', 'minutes must be 0–59'],
    ['12:00:60', 'seconds must be 0–59'],
    ['abc', 'expected ISO 8601 (P…T…) or clock (HH:mm:ss) duration'],
    ['', 'expected ISO 8601 (P…T…) or clock (HH:mm:ss) duration'],
  ])('rejects %j', (text, reason) => {
    const error = expectErr(parseDuration(text))
    expect(error).toBeInstanceOf(TimeParseError)
    expect(error.toJSON()).toStrictEqual({
      name: 'TimeParseError',
      code: 'TIME_PARSE',
      message: `Cannot parse ${JSON.stringify(text)} as duration: ${reason}`,
      input: text,
      reason,
      format: 'duration',
    })
    expect(() => parseDurationOrThrow(text)).toThrow(TimeParseError)
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
    expect(formatDuration(d, 'clock')).toBe('36:05:09')
    expect(formatDuration(d, 'HH:mm:ss')).toBe('36:05:09')
    expect(formatDuration(d, 'D[d] HH:mm:ss.SSS')).toBe('1d 12:05:09.250')
    expect(formatDuration(d, 'DDD[d] HH:mm:ss')).toBe('001d 12:05:09')
    expect(formatDuration(d, 'mm:ss')).toBe('2165:09')
    expect(formatDuration(d, 's.SSSSSSSSS')).toBe('129909.250000000')
    expect(formatDuration(d, 'H[h]')).toBe('36h')
    expect(formatDuration(duration({ days: 1234 }), 'DD')).toBe('1234')
  })

  it('prefixes negative durations', () => {
    expect(formatDuration(duration({ minutes: -90 }), 'HH:mm:ss')).toBe('-01:30:00')
    expect(formatDuration(duration({ minutes: -90 }), 'clock')).toBe('-01:30:00')
  })

  it('keeps unknown letters and unterminated brackets literal', () => {
    expect(formatDuration(duration({ seconds: 5 }), 'ss [seconds] x')).toBe('05 seconds x')
    expect(formatDuration(duration({ seconds: 5 }), 'ss [open')).toBe('05 open')
  })
})
