import { describe, expect, it } from 'vitest'

import {
  durationBetween,
  durationToSeconds,
  instantToJ2000Seconds,
  parseInstantOrThrow,
} from '../src/index.js'
import spice from './fixtures/cspice-golden.json' with { type: 'json' }

type Row = { utc: string; et: number; taiSinceEt0: number }

const rows = spice.rows as Row[]
/** CSPICE uses a different truncated TDB model; the two agree within 30 µs. */
const SERIES_TOLERANCE_SECONDS = 3e-5
/** Float comparison slack for values ~1e9 s (double ULP ~1.2e-7 s). */
const DOUBLE_TOLERANCE_SECONDS = 1e-6

describe('NAIF CSPICE golden vectors (naif0012.tls)', () => {
  it.each(rows)('$utc matches SPICE ET within the TDB series tolerance', (row) => {
    const instant = parseInstantOrThrow(`${row.utc}Z`)
    expect(Math.abs(instantToJ2000Seconds(instant, 'tdb') - row.et)).toBeLessThanOrEqual(
      SERIES_TOLERANCE_SECONDS,
    )
  })

  it('matches SPICE elapsed TAI between every pair of epochs (pure leap-second arithmetic)', () => {
    // Differencing two epochs cancels the ET0 anchor (and with it any TDB
    // series disagreement), leaving exactly the leap-second bookkeeping —
    // ours must match NAIF's to double precision.
    for (let a = 0; a < rows.length; a += 1) {
      for (let b = a + 1; b < rows.length; b += 1) {
        const rowA = rows[a]
        const rowB = rows[b]
        if (rowA === undefined || rowB === undefined) throw new Error('unreachable: index in range')
        const ours = durationToSeconds(
          durationBetween(parseInstantOrThrow(`${rowA.utc}Z`), parseInstantOrThrow(`${rowB.utc}Z`)),
        )
        const spiceElapsed = rowB.taiSinceEt0 - rowA.taiSinceEt0
        expect(Math.abs(ours - spiceElapsed)).toBeLessThanOrEqual(DOUBLE_TOLERANCE_SECONDS)
      }
    }
  })
})
