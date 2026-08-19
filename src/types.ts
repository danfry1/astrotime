/** A `string` that keeps literal-union members visible in editor completions. */
export type StringWithHints<Literals extends string> = Literals | (string & Record<never, never>)
