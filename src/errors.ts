type ErrorCode = 'TIME_PARSE' | 'INVALID_TIME' | 'LEAP_SECOND_TABLE' | 'EARTH_ORIENTATION'

abstract class AstrotimeBaseError extends Error {
  abstract override readonly name: string
  abstract readonly code: ErrorCode

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    Object.setPrototypeOf(this, new.target.prototype)
  }

  protected baseJson(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
    }
    if (this.cause !== undefined)
      json['cause'] = this.cause instanceof Error ? this.cause.message : this.cause
    return json
  }
}

/** The input text did not match the requested format. */
export class TimeParseError extends AstrotimeBaseError {
  override readonly name = 'TimeParseError' as const
  override readonly code = 'TIME_PARSE' as const

  constructor(
    readonly input: string,
    readonly reason: string,
    readonly format: string,
    options?: { cause?: unknown },
  ) {
    super(`Cannot parse ${JSON.stringify(input)} as ${format}: ${reason}`, options)
  }

  toJSON(): Record<string, unknown> {
    return { ...this.baseJson(), input: this.input, reason: this.reason, format: this.format }
  }
}

/** A field was syntactically present but semantically invalid (e.g. month 13, or second 60 when no leap second occurs). */
export class InvalidTimeError extends AstrotimeBaseError {
  override readonly name = 'InvalidTimeError' as const
  override readonly code = 'INVALID_TIME' as const

  constructor(
    readonly field: string,
    readonly value: number,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid ${field} ${String(value)}: ${reason}`, options)
  }

  toJSON(): Record<string, unknown> {
    return {
      ...this.baseJson(),
      field: this.field,
      value: Number.isFinite(this.value) ? this.value : String(this.value),
      reason: this.reason,
    }
  }
}

/** A leap-second list could not be parsed. */
export class LeapSecondTableError extends AstrotimeBaseError {
  override readonly name = 'LeapSecondTableError' as const
  override readonly code = 'LEAP_SECOND_TABLE' as const

  constructor(
    readonly line: number,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid leap-second table at line ${String(line)}: ${reason}`, options)
  }

  toJSON(): Record<string, unknown> {
    return { ...this.baseJson(), line: this.line, reason: this.reason }
  }
}

/**
 * Earth-orientation data could not be parsed (`line` is set), or does not
 * cover the requested instant (`line` is `null`). Expected failures: EOP
 * tables are external data with a finite span, so callers handle the
 * `Result` rather than catching.
 */
export class EarthOrientationError extends AstrotimeBaseError {
  override readonly name = 'EarthOrientationError' as const
  override readonly code = 'EARTH_ORIENTATION' as const

  constructor(
    readonly line: number | null,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(
      line === null
        ? `Earth orientation unavailable: ${reason}`
        : `Invalid Earth-orientation data at line ${String(line)}: ${reason}`,
      options,
    )
  }

  toJSON(): Record<string, unknown> {
    return { ...this.baseJson(), line: this.line, reason: this.reason }
  }
}

export type AstrotimeError =
  | TimeParseError
  | InvalidTimeError
  | LeapSecondTableError
  | EarthOrientationError

/** Type guard for the union of all astrotime error classes. */
export const isAstrotimeError = (value: unknown): value is AstrotimeError =>
  value instanceof TimeParseError ||
  value instanceof InvalidTimeError ||
  value instanceof LeapSecondTableError ||
  value instanceof EarthOrientationError
