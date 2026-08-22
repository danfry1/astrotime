import type { Result } from '../src/index.js'

/** Narrows a `Result` to its error, failing loudly if it is `Ok` (avoids `if (!r.ok)` around assertions). */
export function expectErr<T, E extends Error>(result: Result<T, E>): E {
  if (result.ok) throw new Error(`expected an Err but got Ok(${String(result.value)})`)
  return result.error
}

/** Narrows a value to an instance of `ctor`, failing loudly otherwise (avoids `instanceof` guards around assertions). */
export function expectInstanceOf<T>(value: unknown, ctor: abstract new (...args: never[]) => T): T {
  if (!(value instanceof ctor)) {
    throw new Error(`expected an instance of ${ctor.name} but got ${String(value)}`)
  }
  return value
}
