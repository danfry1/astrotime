#!/usr/bin/env python3
"""Generate reference time-scale conversions with astropy (ERFA/SOFA) for tests/fixtures/astropy-golden.json.

Usage: python3 scripts/generate-golden.py > tests/fixtures/astropy-golden.json
Requires: pip install astropy
"""
import json
import sys

from astropy.time import Time

# UTC inputs covering leap seconds, epoch boundaries, far past/future, and ordinary values.
UTC_INPUTS = [
    "1972-01-01T00:00:00.000000000",
    "1972-06-30T23:59:59.000000000",
    "1972-06-30T23:59:60.000000000",
    "1972-06-30T23:59:60.999999999",
    "1972-07-01T00:00:00.000000000",
    "1980-01-06T00:00:00.000000000",
    "1998-12-31T23:59:59.500000000",
    "1998-12-31T23:59:60.000000000",
    "1999-01-01T00:00:00.000000000",
    "2000-01-01T11:58:55.816000000",
    "2000-01-01T12:00:00.000000000",
    "2005-12-31T23:59:60.250000000",
    "2008-12-31T23:59:60.000000000",
    "2012-06-30T23:59:59.999999999",
    "2012-06-30T23:59:60.000000000",
    "2012-07-01T00:00:00.000000000",
    "2015-06-30T23:59:60.123456789",
    "2016-12-31T23:59:59.000000000",
    "2016-12-31T23:59:60.000000000",
    "2016-12-31T23:59:60.500000000",
    "2017-01-01T00:00:00.000000000",
    "2017-01-01T00:00:00.000000001",
    "2020-02-29T12:00:00.000000000",
    "2024-12-31T23:59:59.999999999",
    "2026-08-19T12:34:56.789012345",
    "2038-01-19T03:14:08.000000000",
    "2099-12-31T23:59:59.000000000",
    "2100-03-01T00:00:00.000000000",
]

rows = []
for utc in UTC_INPUTS:
    t = Time(utc, scale="utc", format="isot", precision=9)
    row = {
        "utc": utc,
        "tai": t.tai.isot,
        "tt": t.tt.isot,
        "tdb": t.tdb.isot,
        "jdUtc": [t.jd1, t.jd2],
        "jdTt": [t.tt.jd1, t.tt.jd2],
        "mjdUtc": t.mjd,
        "unix": t.unix,
        "gps": t.gps,
        "yday": t.yday,
    }
    rows.append(row)

json.dump({"generator": "astropy " + __import__("astropy").__version__, "rows": rows}, sys.stdout, indent=1)
sys.stdout.write("\n")
