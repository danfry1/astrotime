#!/usr/bin/env python3
"""Large-scale differential test: astrotime vs astropy (ERFA/SOFA).

Generates N pseudo-random TAI instants, computes UTC/TT/GPS/day-of-year with
both implementations, and reports any disagreement. Unlike the committed
fixtures this is a *sweep*, not a sample — run it locally or on a schedule.

  pip install astropy==6.0.1
  bun run build
  python3 scripts/differential.py [N]
"""
import json
import os
import random
import subprocess
import sys
import warnings

warnings.simplefilter("ignore")
from astropy.time import Time, TimeDelta  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100_000
NS = 1_000_000_000
random.seed(20260821)

# 1972-01-01 TAI .. 2100 (leap-second UTC era, where astropy and we both claim exactness)
LO = (63_072_000 + 10) * NS
HI = 4_102_444_800 * NS
cases = [random.randrange(LO, HI) for _ in range(N)]

script = """
import { readFileSync } from 'node:fs';
import { formatInstant, formatIso, instantFromTaiNanos, instantToGpsSeconds } from 'DIST_URL';
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = cases.map((s) => {
  const i = instantFromTaiNanos(BigInt(s));
  return [
    formatIso(i, { precision: 'nanos' }),
    formatIso(i, { scale: 'tt', precision: 'nanos', designator: 'none' }),
    instantToGpsSeconds(i),
    formatInstant(i, 'YYYY:DDD:HH:mm:ss.SSSSSSSSS'),
  ];
});
process.stdout.write(JSON.stringify(out));
"""
dist = "file://" + os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist", "index.mjs"))
with open("/tmp/astrotime-diff.mjs", "w") as f:
    f.write(script.replace("DIST_URL", dist))
with open("/tmp/astrotime-diff-input.json", "w") as f:
    json.dump([str(c) for c in cases], f)

print(f"computing {N} cases with astrotime...", file=sys.stderr)
proc = subprocess.run(
    ["node", "/tmp/astrotime-diff.mjs", "/tmp/astrotime-diff-input.json"],
    capture_output=True, text=True,
)
if proc.returncode != 0:
    print(proc.stderr[-2000:], file=sys.stderr)
    sys.exit(1)
ours = json.loads(proc.stdout)

print(f"computing {N} cases with astropy...", file=sys.stderr)
epoch = Time("1970-01-01T00:00:00", scale="tai", format="isot")
secs = [c // NS for c in cases]
nanos = [c % NS for c in cases]
times = epoch + TimeDelta(secs, format="sec", scale="tai") + TimeDelta([n * 1e-9 for n in nanos], format="sec", scale="tai")
times.precision = 9
ref_utc = times.utc.isot
ref_tt = times.tt.isot
ref_gps = times.gps
ref_yday = times.utc.yday

mismatches = []
for idx in range(N):
    utc, tt, gps, yday = ours[idx]
    if utc[:-1] != ref_utc[idx] or tt != ref_tt[idx] or yday != ref_yday[idx] or abs(gps - float(ref_gps[idx])) > 1e-6:
        mismatches.append((cases[idx], (utc, tt, gps, yday), (ref_utc[idx], ref_tt[idx], float(ref_gps[idx]), ref_yday[idx])))

print(f"\ncompared {N} instants across UTC, TT, GPS and day-of-year")
print(f"mismatches: {len(mismatches)}")
for m in mismatches[:10]:
    print(" ", m)
sys.exit(1 if mismatches else 0)
