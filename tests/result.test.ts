import { describe, expect, it } from 'vitest'

import {
  InvalidTimeError,
  TimeParseError,
  instantFromUtc,
  parseInstant,
  unwrap,
  unwrapOr,
  UNIX_EPOCH_INSTANT,
} from '../src/index.js'

/**
 * The Result contract is the other half of the library's error policy:
 * expected failures return a Result, bugs throw. These helpers are the
 * documented way to cross back into exception-land, so both sides of both
 * are exercised here rather than incidentally through other suites.
 */
describe('Result helpers', () => {
  const okResult = parseInstant('2026-08-19T12:34:56Z')
  const errResult = parseInstant('not a date')

  it('unwrap returns the value of an Ok', () => {
    expect(unwrap(okResult)).toStrictEqual(okResult.ok ? okResult.value : undefined)
  })

  it('unwrap throws the error an Err carries, not a wrapper around it', () => {
    // The error is rethrown by identity: a caller can catch it and read its
    // typed fields, which is the point of carrying a typed error at all.
    expect(() => unwrap(errResult)).toThrow()
    const carried = errResult.ok ? null : errResult.error
    try {
      unwrap(errResult)
      expect.unreachable('unwrap should have thrown')
    } catch (thrown) {
      expect(thrown).toBe(carried)
    }
  })

  it('unwrap rethrows an InvalidTimeError with its fields intact', () => {
    const invalid = instantFromUtc({ year: 2026, month: 13, day: 1 })
    try {
      unwrap(invalid)
      expect.unreachable('unwrap should have thrown')
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(InvalidTimeError)
      expect((thrown as InvalidTimeError).field).toBe('month')
    }
  })

  it('unwrapOr returns the value of an Ok', () => {
    expect(unwrapOr(okResult, UNIX_EPOCH_INSTANT)).toStrictEqual(
      okResult.ok ? okResult.value : undefined,
    )
  })

  it('unwrapOr returns the fallback for an Err, without throwing', () => {
    expect(unwrapOr(errResult, UNIX_EPOCH_INSTANT)).toBe(UNIX_EPOCH_INSTANT)
  })
})

/**
 * `cause` is part of the serialized error contract but nothing inside the
 * library sets one, so these paths are only reachable through the exported
 * error classes. They are exported, so the contract still has to hold.
 */
describe('error serialization with a cause', () => {
  it('omits cause entirely when there is none', () => {
    const e = new TimeParseError('nope', 'unparseable', 'iso')
    expect('cause' in e.toJSON()).toBe(false)
  })

  it('serializes an Error cause as its message, not the object', () => {
    const root = new RangeError('underlying failure')
    const e = new TimeParseError('nope', 'unparseable', 'iso', { cause: root })
    expect(e.toJSON()).toMatchObject({ name: 'TimeParseError', cause: 'underlying failure' })
  })

  it('passes a non-Error cause through unchanged', () => {
    const e = new TimeParseError('nope', 'unparseable', 'iso', { cause: 'a bare string' })
    expect(e.toJSON()).toMatchObject({ cause: 'a bare string' })
  })

  it('keeps the cause reachable on the error itself, not only in JSON', () => {
    const root = new RangeError('underlying failure')
    const e = new TimeParseError('nope', 'unparseable', 'iso', { cause: root })
    expect(e.cause).toBe(root)
  })
})
