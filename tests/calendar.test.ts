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
    expect(daysInMonth(2023, 13)).toBe(0)
  })

  it('converts ordinal days', () => {
    expect(dayOfYear(2024, 12, 31)).toBe(366)
    expect(dayOfYear(2026, 8, 19)).toBe(231)
    expect(civilFromOrdinal(2026, 231)).toStrictEqual({ year: 2026, month: 8, day: 19 })
  })
})
