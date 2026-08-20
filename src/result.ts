/** Successful outcome carrying a value. */
export type Ok<T> = { readonly ok: true; readonly value: T }
/** Failed outcome carrying a typed error. */
export type Err<E> = { readonly ok: false; readonly error: E }
/** Expected-failure return type used by every parser/validator in astrotime. */
export type Result<T, E> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

/** Returns the value of an `Ok`, or throws the contained error (wrapped in an `Error` if it is not one). */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  if (result.error instanceof Error) throw result.error
  throw new Error(String(result.error), { cause: result.error })
}

/** Returns the value of an `Ok`, or `fallback` for an `Err`. */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback
