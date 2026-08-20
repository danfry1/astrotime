#!/usr/bin/env python3
"""Generate tests/fixtures/astropy-drift.json: seeded random TAI instants (1972–2150) plus ±1 ns / ±0.5 s / ±1 s
probes around every leap-second boundary, with astropy (ERFA/SOFA) reference UTC, TT, GPS and day-of-year readings.

Usage: python3 scripts/generate-drift.py > tests/fixtures/astropy-drift.json
Requires: pip install astropy (generated with astropy 6.0.1)
"""
import json
import random
import sys
import warnings

warnings.simplefilter("ignore")
from astropy.time import Time, TimeDelta  # noqa: E402

random.seed(20260819)
NS = 1_000_000_000

# (unix midnight, new TAI-UTC) — mirrors IERS_LEAP_SECONDS in src/leap-seconds.ts
LEAPS = [
    (63072000, 10), (78796800, 11), (94694400, 12), (126230400, 13), (157766400, 14), (189302400, 15),
    (220924800, 16), (252460800, 17), (283996800, 18), (315532800, 19), (362793600, 20), (394329600, 21),
    (425865600, 22), (489024000, 23), (567993600, 24), (631152000, 25), (662688000, 26), (709948800, 27),
    (741484800, 28), (773020800, 29), (820454400, 30), (867715200, 31), (915148800, 32), (1136073600, 33),
    (1230768000, 34), (1341100800, 35), (1435708800, 36), (1483228800, 37),
]

probes = []
for _ in range(400):
    probes.append((random.randint(63_072_000 + 10, 5_680_281_600), random.randint(0, NS - 1)))
for unix_midnight, delta in LEAPS[1:]:
    boundary = unix_midnight + delta  # TAI seconds at which the new offset starts
    for ds, dns in [(-2, 0), (-1, 0), (-1, NS // 2), (-1, NS - 1), (0, 0), (0, 1), (0, NS // 2), (1, 0)]:
        probes.append((boundary + ds, dns))

epoch = Time("1970-01-01T00:00:00", scale="tai", format="isot")
rows = []
for seconds, nanos in probes:
    t = epoch + TimeDelta(seconds, format="sec", scale="tai") + TimeDelta(nanos * 1e-9, format="sec", scale="tai")
    t.precision = 9
    rows.append({
        "taiNanos": str(seconds * NS + nanos),
        "utc": t.utc.isot,
        "tt": t.tt.isot,
        "gps": float(t.gps),
        "yday": t.utc.yday,
    })

json.dump({"generator": "astropy " + __import__("astropy").__version__, "seed": 20260819, "rows": rows}, sys.stdout, separators=(",", ":"))
sys.stdout.write("\n")
