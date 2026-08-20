#!/usr/bin/env python3
"""Generate tests/fixtures/cspice-golden.json: NAIF CSPICE reference values.

For each UTC epoch: ET (TDB seconds past J2000, SPICE convention) and TAI
seconds elapsed since the ET=0 instant (leap-second arithmetic, no series).

Usage:
  pip install spiceypy==6.0.0
  curl -sLO https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls
  python3 scripts/generate-spice.py naif0012.tls > tests/fixtures/cspice-golden.json
"""
import json
import sys

import spiceypy as sp

sp.furnsh(sys.argv[1] if len(sys.argv) > 1 else "naif0012.tls")

UTC_EPOCHS = [
    "1972-01-01T00:00:00",
    "1972-06-30T23:59:59",
    "1972-06-30T23:59:60.5",
    "1972-07-01T00:00:00",
    "1980-01-06T00:00:00",
    "1985-06-30T23:59:60",
    "1994-06-30T23:59:60.25",
    "1998-12-31T23:59:59",
    "1999-01-01T00:00:00",
    "2000-01-01T11:58:55.816",
    "2000-01-01T12:00:00",
    "2005-12-31T23:59:60.999",
    "2008-12-31T23:59:60",
    "2012-06-30T23:59:60.123456",
    "2015-06-30T23:59:60",
    "2016-12-31T23:59:59.5",
    "2016-12-31T23:59:60.5",
    "2017-01-01T00:00:00",
    "2020-02-29T12:00:00",
    "2026-08-19T12:34:56.789012",
    "2038-01-19T03:14:08",
    "2049-12-31T23:59:59",
]

rows = []
for utc in UTC_EPOCHS:
    et = sp.str2et(utc)
    tai_since_et0 = sp.unitim(et, "ET", "TAI") - sp.unitim(0.0, "ET", "TAI")
    rows.append({"utc": utc, "et": et, "taiSinceEt0": tai_since_et0})

json.dump(
    {"generator": "CSPICE " + sp.tkvrsn("TOOLKIT"), "kernel": "naif0012.tls", "rows": rows},
    sys.stdout,
    indent=1,
)
sys.stdout.write("\n")
