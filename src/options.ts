const describeUnknown = (value: unknown): string => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'symbol' ||
    typeof value === 'function' ||
    typeof value === 'undefined'
  ) {
    return String(value)
  }
  return Object.prototype.toString.call(value)
}

/** Internal runtime guard for JavaScript callers of options-bearing APIs. */
export function assertOptionsObject(options: unknown, what: string, scaleHint = false): void {
  if (
    options === null ||
    Array.isArray(options) ||
    (typeof options !== 'object' && typeof options !== 'undefined')
  ) {
    let shown: string
    try {
      const json = JSON.stringify(options)
      if (json === undefined) shown = describeUnknown(options)
      else shown = json
    } catch {
      shown = describeUnknown(options)
    }
    const hint = scaleHint ? ` Did you mean { scale: ${shown} }?` : ''
    throw new RangeError(`${what} options must be an object, got ${shown}.${hint}`)
  }
}
