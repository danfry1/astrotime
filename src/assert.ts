/** Exhaustiveness guard: unreachable if every union member is handled. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`)
}
