# API stability

As of v0.6.0 the public surface (every named export of the package root) is
**frozen-additive**: new exports and new optional fields may be added in
minor releases, but no export will be renamed, removed, or change behavior
before 1.0 except to fix a demonstrated correctness defect (which will be a
breaking minor with a changelog entry, as in 0.2–0.5).

Deliberately open questions, to be settled at 1.0 with real-usage evidence:

1. **Result-by-default vs throw-by-default naming** (`parseInstant` returns
   `Result`; `parseInstantOrThrow` throws). The safe-default choice is
   documented in the README; a zod-style rename (`parse`/`safeParse`) would
   only happen at 1.0 if adopters demonstrably stumble.
2. **A bound-context constructor.** `UtcOptions` carries four orthogonal
   policies (`leapSeconds`, `before1972`, `tableValidity`, `leapGap`), with
   documented display-oriented defaults and fail-closed opt-ins. If a fifth
   policy ever appears, an additive `createTimeContext(options)` returning
   pre-bound functions will be added rather than growing per-call option
   plumbing further.
3. **Sub-path exports** (`astrotime/instant`, `astrotime/leap-data`).
   Additive if a consumer (e.g. a leap-table-only user) asks.

Out of scope permanently (see README): time zones and locales (`Intl`),
UT1/ΔT, SCLK/SPICE kernels, calendar (month/year) arithmetic.
