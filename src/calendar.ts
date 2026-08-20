/**
 * Proleptic Gregorian calendar arithmetic using only integers.
 * Algorithms from Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms".
 */

const DAYS_PER_ERA = 146_097
const YEARS_PER_ERA = 400
const DAYS_TO_UNIX_EPOCH = 719_468 // days from 0000-03-01 to 1970-01-01

export type CivilDate = { readonly year: number; readonly month: number; readonly day: number }

export const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29
  return DAYS_IN_MONTH[month - 1] ?? 0
}

export const daysInYear = (year: number): 365 | 366 => (isLeapYear(year) ? 366 : 365)

/** Days since 1970-01-01 for a civil date. Valid for all integer years. */
const assertIntegers = (values: readonly number[], what: string): void => {
  for (const value of values) {
    if (!Number.isInteger(value))
      throw new RangeError(`${what} arguments must be integers, got ${String(value)}`)
  }
}

export function daysFromCivil(year: number, month: number, day: number): number {
  assertIntegers([year, month, day], 'daysFromCivil')
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / YEARS_PER_ERA)
  const yoe = y - era * YEARS_PER_ERA
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * DAYS_PER_ERA + doe - DAYS_TO_UNIX_EPOCH
}

/** Civil date for a count of days since 1970-01-01. */
export function civilFromDays(days: number): CivilDate {
  assertIntegers([days], 'civilFromDays')
  const z = days + DAYS_TO_UNIX_EPOCH
  const era = Math.floor(z / DAYS_PER_ERA)
  const doe = z - era * DAYS_PER_ERA
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * YEARS_PER_ERA + (month <= 2 ? 1 : 0)
  return { year, month, day }
}

/** 1-based ordinal day of the year (1–366). */
export const dayOfYear = (year: number, month: number, day: number): number =>
  daysFromCivil(year, month, day) - daysFromCivil(year, 1, 1) + 1

/** Civil date for a 1-based ordinal day of the given year. */
export const civilFromOrdinal = (year: number, ordinal: number): CivilDate =>
  civilFromDays(daysFromCivil(year, 1, 1) + ordinal - 1)
