import { describe, expect, it } from 'vitest'

import {
  civilFromDays,
  civilFromOrdinal,
  dayOfYear,
  daysFromCivil,
  daysInMonth,
  daysInYear,
  isLeapYear,
} from '../src/index.js'

describe('calendar', () => {
  it.each([
    [1970, 1, 1, 0],
    [1969, 12, 31, -1],
    [2000, 3, 1, 11_017],
    [2026, 8, 19, 20_684],
    [1600, 1, 1, -135_140],
    [-1, 1, 1, -719_893],
    [9999, 12, 31, 2_932_896],
  ])('daysFromCivil(%i, %i, %i) = %i and back', (y, m, d, days) => {
    expect(daysFromCivil(y, m, d)).toBe(days)
    expect(civilFromDays(days)).toStrictEqual({ year: y, month: m, day: d })
  })

  it('knows leap years', () => {
    expect([1900, 2000, 2024, 2100, 2023].map(isLeapYear)).toStrictEqual([
      false,
      true,
      true,
      false,
      false,
    ])
    expect(daysInYear(2024)).toBe(366)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
  })

  it('converts ordinal days', () => {
    expect(dayOfYear(2024, 12, 31)).toBe(366)
    expect(dayOfYear(2026, 8, 19)).toBe(231)
    expect(civilFromOrdinal(2026, 231)).toStrictEqual({ year: 2026, month: 8, day: 19 })
  })

  it('rejects impossible dates, ordinals and unsafe numeric inputs', () => {
    expect(() => daysFromCivil(2023, 2, 29)).toThrow(RangeError)
    expect(() => daysFromCivil(2024, 13, 1)).toThrow(RangeError)
    expect(() => daysFromCivil(Number.MAX_SAFE_INTEGER, 1, 1)).toThrow(RangeError)
    expect(() => civilFromOrdinal(2023, 366)).toThrow(RangeError)
    expect(() => civilFromOrdinal(2024, 0)).toThrow(RangeError)
    expect(() => civilFromDays(Number.MAX_VALUE)).toThrow(RangeError)
    expect(() => daysInMonth(2023, 13)).toThrow(RangeError)
    expect(() => daysInMonth(2023, 1.5)).toThrow(RangeError)
    expect(() => daysInYear(Number.NaN)).toThrow(RangeError)
    expect(() => isLeapYear(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
  })

  it('round-trips every day in positive and negative Gregorian 400-year eras', () => {
    for (const eraStart of [-800, 0, 1600]) {
      const first = daysFromCivil(eraStart, 1, 1)
      const end = daysFromCivil(eraStart + 400, 1, 1)
      expect(end - first).toBe(146_097)
      // Asserting per day would cost ~876,000 expect() calls across the three
      // eras, which ran within a few hundred milliseconds of the default 5s
      // timeout and tipped over on slower runners. Compare in a plain loop and
      // report the first day that fails to round-trip.
      let mismatch: string | null = null
      for (let days = first; days < end; days += 1) {
        const civil = civilFromDays(days)
        if (daysFromCivil(civil.year, civil.month, civil.day) !== days) {
          mismatch = `day ${String(days)} -> ${String(civil.year)}-${String(civil.month)}-${String(civil.day)}`
          break
        }
      }
      expect(mismatch).toBeNull()
    }
  })
})
