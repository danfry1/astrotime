/** Exhaustiveness guard: unreachable if every union member is handled. */
export function assertNever(value: never): never {
  throw new RangeError(`Unhandled case: ${String(value)}`)
}
