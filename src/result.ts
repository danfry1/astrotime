/** Successful outcome carrying a value. */
export type Ok<T> = { readonly ok: true; readonly value: T }
/** Failed outcome carrying a typed error. */
export type Err<E extends Error> = { readonly ok: false; readonly error: E }
/**
 * Expected-failure return type used by every parser/validator in astrotime.
 * `E` is constrained to `Error`, so `unwrap` can always throw the error it
 * carries rather than wrapping an arbitrary value.
 */
export type Result<T, E extends Error> = Ok<T> | Err<E>

/** Wraps a value in an `Ok`. */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
/** Wraps an error in an `Err`. */
export const err = <E extends Error>(error: E): Err<E> => ({ ok: false, error })

/** Returns the value of an `Ok`, or throws the contained error. */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw result.error
}

/** Returns the value of an `Ok`, or `fallback` for an `Err`. */
export const unwrapOr = <T, E extends Error>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback
