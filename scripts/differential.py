#!/usr/bin/env python3
"""Large-scale differential test: astrotime vs astropy (ERFA/SOFA).

Generates N pseudo-random TAI instants, computes UTC/TT/TDB/GPS/day-of-year
and two-part UTC/TT Julian dates with both implementations, and reports any
disagreement. Unlike the committed fixtures this is a *sweep*, not a sample
— run it locally or on a schedule.

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
from datetime import date

warnings.simplefilter("ignore")
import astropy  # noqa: E402
import erfa  # noqa: E402
from astropy.time import Time, TimeDelta  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100_000
REPORT_PATH = sys.argv[2] if len(sys.argv) > 2 else None
NS = 1_000_000_000
SEED = 20260821
random.seed(SEED)

# 1972-01-01 TAI .. 2100 (leap-second UTC era, where astropy and we both claim exactness)
LO = (63_072_000 + 10) * NS
HI = 4_102_444_800 * NS
cases = [random.randrange(LO, HI) for _ in range(N)]

script = """
import { readFileSync } from 'node:fs';
import {
  formatInstant,
  formatIso,
  instantFromTaiNanos,
  instantToGpsSeconds,
  instantToJulianDateParts,
} from 'DIST_URL';
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = cases.map((s) => {
  const i = instantFromTaiNanos(BigInt(s));
  const jdUtc = instantToJulianDateParts(i, 'utc');
  const jdTt = instantToJulianDateParts(i, 'tt');
  return [
    formatIso(i, { precision: 'nanos' }),
    formatIso(i, { scale: 'tt', precision: 'nanos', designator: 'none' }),
    formatIso(i, { scale: 'tdb', precision: 'nanos', designator: 'none' }),
    instantToGpsSeconds(i),
    formatInstant(i, 'YYYY:DDD:HH:mm:ss.SSSSSSSSS'),
    jdUtc.jd1,
    jdUtc.jd2,
    jdTt.jd1,
    jdTt.jd2,
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
ref_tdb = times.tdb.isot
ref_gps = times.gps
ref_yday = times.utc.yday
ref_jd_utc1 = times.utc.jd1
ref_jd_utc2 = times.utc.jd2
ref_jd_tt1 = times.tt.jd1
ref_jd_tt2 = times.tt.jd2

def iso_epoch_nanos(text):
    """Exact epoch nanoseconds for a uniform-scale ISO reading in this sweep's year range."""
    date_text, time_text = text.split("T")
    year, month, day = (int(part) for part in date_text.split("-"))
    hour_text, minute_text, second_text = time_text.split(":")
    second, _, fraction = second_text.partition(".")
    whole_days = (date(year, month, day) - date(1970, 1, 1)).days
    whole_seconds = whole_days * 86_400 + int(hour_text) * 3_600 + int(minute_text) * 60 + int(second)
    return whole_seconds * NS + int(fraction.ljust(9, "0") or "0")

mismatches = []
max_tdb_error_ns = 0
max_jd_error_seconds = 0.0
for idx in range(N):
    utc, tt, tdb, gps, yday, utc1, utc2, tt1, tt2 = ours[idx]
    tdb_error_ns = abs(iso_epoch_nanos(tdb) - iso_epoch_nanos(ref_tdb[idx]))
    utc_jd_error = abs((utc1 - float(ref_jd_utc1[idx]) + utc2 - float(ref_jd_utc2[idx])) * 86_400)
    tt_jd_error = abs((tt1 - float(ref_jd_tt1[idx]) + tt2 - float(ref_jd_tt2[idx])) * 86_400)
    jd_error = max(utc_jd_error, tt_jd_error)
    max_tdb_error_ns = max(max_tdb_error_ns, tdb_error_ns)
    max_jd_error_seconds = max(max_jd_error_seconds, jd_error)
    if (
        utc[:-1] != ref_utc[idx]
        or tt != ref_tt[idx]
        or yday != ref_yday[idx]
        or abs(gps - float(ref_gps[idx])) > 1e-6
        or tdb_error_ns > 10_000
        or jd_error > 1e-9
    ):
        mismatches.append(
            (
                cases[idx],
                (utc, tt, tdb, gps, yday, (utc1, utc2), (tt1, tt2)),
                (
                    ref_utc[idx],
                    ref_tt[idx],
                    ref_tdb[idx],
                    float(ref_gps[idx]),
                    ref_yday[idx],
                    (float(ref_jd_utc1[idx]), float(ref_jd_utc2[idx])),
                    (float(ref_jd_tt1[idx]), float(ref_jd_tt2[idx])),
                ),
            )
        )

print(f"\ncompared {N} instants across UTC, TT, TDB, GPS, day-of-year and UTC/TT JD")
print(f"maximum TDB error: {max_tdb_error_ns} ns (limit 10000 ns)")
print(f"maximum two-part JD error: {max_jd_error_seconds:.3e} s (limit 1e-9 s)")
print(f"mismatches: {len(mismatches)}")
for m in mismatches[:10]:
    print(" ", m)
if REPORT_PATH is not None:
    report_directory = os.path.dirname(REPORT_PATH)
    if report_directory:
        os.makedirs(report_directory, exist_ok=True)
    with open(REPORT_PATH, "w") as report_file:
        json.dump(
            {
                "schemaVersion": 1,
                "cases": N,
                "seed": SEED,
                "range": {
                    "taiNanosInclusive": str(LO),
                    "taiNanosExclusive": str(HI),
                    "civilApproximation": "1972-01-01 through 2100-01-01",
                },
                "reference": {
                    "astropy": astropy.__version__,
                    "erfa": erfa.__version__,
                },
                "limits": {"tdbErrorNanos": 10_000, "julianDateErrorSeconds": 1e-9},
                "observed": {
                    "maxTdbErrorNanos": max_tdb_error_ns,
                    "maxJulianDateErrorSeconds": max_jd_error_seconds,
                    "mismatches": len(mismatches),
                },
                "passed": len(mismatches) == 0,
            },
            report_file,
            indent=2,
        )
        report_file.write("\n")
sys.exit(1 if mismatches else 0)
