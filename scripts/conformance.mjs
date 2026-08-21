/**
 * Cross-engine conformance: computes a canonical digest over a deterministic
 * sweep of the built library's outputs. Run under different JavaScript
 * engines — identical digests prove bit-identical behavior of the shipped
 * artifact.
 *
 *   bun run build && node scripts/conformance.mjs && bun scripts/conformance.mjs
 */
import {
  duration,
  durationToComponents,
  formatDuration,
  formatIso,
  formatOrdinal,
  instantFromJulianDateParts,
  instantFromTaiNanos,
  instantToGpsWeek,
  instantToJ2000Nanos,
  instantToJulianDateParts,
  instantToTaiNanos,
  instantToUnixNanos,
  instantToUtc,
  TIME_SCALES,
} from '../dist/index.mjs'

// Deterministic 64-bit LCG (no Math.random — reproducible everywhere).
let state = 0x9e3779b97f4a7c15n
function nextTaiNanos() {
  state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn
  // Map into ±10^19 ns (±317 years) so every scale and both leap eras are hit.
  return (state % (2n * 10n ** 19n)) - 10n ** 19n
}

// FNV-1a 64-bit over UTF-16 code units — dependency-free and engine-agnostic.
let hash = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn
function absorb(text) {
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * FNV_PRIME) & MASK
  }
  hash = ((hash ^ 10n) * FNV_PRIME) & MASK // newline separator
}

let count = 0
for (let i = 0; i < 5000; i += 1) {
  const n = nextTaiNanos()
  const instant = instantFromTaiNanos(n)
  for (const scale of TIME_SCALES) {
    absorb(formatIso(instant, { scale, precision: 'nanos' }))
    const { jd1, jd2 } = instantToJulianDateParts(instant, scale)
    absorb(`${jd1}|${jd2}`)
    absorb(String(instantToTaiNanos(instantFromJulianDateParts(jd1, jd2, scale))))
    absorb(String(instantToJ2000Nanos(instant, scale)))
    count += 4
  }
  absorb(formatOrdinal(instant, { precision: 'nanos' }))
  const civil = instantToUtc(instant)
  absorb(`${civil.dayOfYear}:${civil.second}:${civil.nanosecond}`)
  absorb(String(instantToUnixNanos(instant)))
  const week = instantToGpsWeek(instant)
  absorb(`${week.week}|${week.secondsOfWeek}`)
  const d = duration({ nanos: n / 1000n })
  absorb(formatDuration(d))
  absorb(formatDuration(d, 'D[T]HH:mm:ss.SSSSSSSSS'))
  const c = durationToComponents(d)
  absorb(`${c.sign}|${c.days}|${c.nanos}`)
  count += 7
}

console.log(`astrotime-conformance-v2 ${count} ${hash.toString(16).padStart(16, '0')}`)
