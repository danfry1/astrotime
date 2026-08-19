type ErrorCode = 'TIME_PARSE' | 'INVALID_TIME' | 'LEAP_SECOND_TABLE'

abstract class AstrotimeBaseError extends Error {
  abstract readonly code: ErrorCode

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** The input text did not match the requested format. */
export class TimeParseError extends AstrotimeBaseError {
  override readonly code = 'TIME_PARSE' as const

  constructor(
    readonly input: string,
    readonly reason: string,
    readonly format: string,
  ) {
    super(`Cannot parse ${JSON.stringify(input)} as ${format}: ${reason}`)
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, input: this.input, reason: this.reason, format: this.format }
  }
}

/** A field was syntactically present but semantically invalid (e.g. month 13, or second 60 when no leap second occurs). */
export class InvalidTimeError extends AstrotimeBaseError {
  override readonly code = 'INVALID_TIME' as const

  constructor(
    readonly field: string,
    readonly value: number,
    readonly reason: string,
  ) {
    super(`Invalid ${field} ${String(value)}: ${reason}`)
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, field: this.field, value: this.value, reason: this.reason }
  }
}

/** A leap-second list could not be parsed. */
export class LeapSecondTableError extends AstrotimeBaseError {
  override readonly code = 'LEAP_SECOND_TABLE' as const

  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(`Invalid leap-second table at line ${String(line)}: ${reason}`)
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, line: this.line, reason: this.reason }
  }
}

export type AstrotimeError = TimeParseError | InvalidTimeError | LeapSecondTableError

export const isAstrotimeError = (value: unknown): value is AstrotimeError =>
  value instanceof TimeParseError ||
  value instanceof InvalidTimeError ||
  value instanceof LeapSecondTableError
