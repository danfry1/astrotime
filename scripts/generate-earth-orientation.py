#!/usr/bin/env python3
"""Earth-orientation references for tests/fixtures/earth-orientation.json.

Reads tests/fixtures/finals2000A-excerpt.txt, a verbatim excerpt of IERS
finals2000A.all (see SOURCE below), and computes at seeded instants:

- `linear`: astropy's IERS_A reading of the same excerpt (Bulletin B where
  present, else A; linear interpolation with leap-second handling), with ERFA
  era00, gmst06 and gst06a evaluated on astropy's UT1.
- `lagrange`: four-point Lagrange interpolation of UT1 − TAI and polar motion
  within runs of consecutive days, implemented here independently of
  astrotime, again with ERFA era00, gmst06 and gst06a.

  pip install astropy==6.0.1
  python3 scripts/generate-earth-orientation.py tests/fixtures/finals2000A-excerpt.txt \
    > tests/fixtures/earth-orientation.json
"""
import hashlib
import json
import random
import sys
import warnings

warnings.simplefilter("ignore")
import astropy  # noqa: E402
import erfa  # noqa: E402
import numpy as np  # noqa: E402
from astropy.time import Time, TimeDelta  # noqa: E402
from astropy.utils import iers  # noqa: E402

SOURCE = {
    "url": "https://datacenter.iers.org/data/9/finals2000A.all",
    "downloaded": "2026-10-19",
    "sha256": "bfa2066aab0400b075357f573af6081e0068a518993609eee0c5ca991bab0845",
    "rows": "MJD 51541-51546, 57723-57784 and 61284-61374, verbatim",
}
NS = 1_000_000_000
path = sys.argv[1]
text = open(path, "rb").read()
table = iers.IERS_A.open(path)

mjd = np.array(table["MJD"].value, dtype=int)
ut1_utc = np.array(table["UT1_UTC"].value, dtype=float)
pm_x = np.array(table["PM_x"].value, dtype=float)
pm_y = np.array(table["PM_y"].value, dtype=float)


def delta_at(day):
    year, month, dom, _ = erfa.jd2cal(2400000.5, float(day))
    return erfa.dat(year, month, dom, 0.0)


# Row positions on the TAI axis (whole seconds since 1970) and continuous UT1 − TAI.
offsets = np.array([delta_at(d) for d in mjd])
node_tai = (mjd - 40587) * 86400 + offsets
ut1_tai = ut1_utc - offsets


def run_bounds(row):
    first, last = row, row
    while first > 0 and mjd[first - 1] == mjd[first] - 1:
        first -= 1
    while last < len(mjd) - 1 and mjd[last + 1] == mjd[last] + 1:
        last += 1
    return first, last


def lagrange_at(tai_ns):
    row = int(np.searchsorted(node_tai * NS, tai_ns, side="right")) - 1
    run_first, run_last = run_bounds(row)
    first = max(run_first, min(row - 1, run_last - 3))
    idx = list(range(first, min(run_last, first + 3) + 1))
    origin = int(node_tai[idx[0]])
    x = (tai_ns - origin * NS) / NS
    xs = [int(node_tai[i]) - origin for i in idx]

    def interpolate(values):
        total = 0.0
        for a, i in enumerate(idx):
            weight = 1.0
            for b in range(len(idx)):
                if b != a:
                    weight *= (x - xs[b]) / (xs[a] - xs[b])
            total += weight * values[i]
        return total

    return interpolate(ut1_tai), interpolate(pm_x), interpolate(pm_y)


rng = random.Random(20261019)
segments = [(57723, 57784), (61284, 61374)]
cases = []
for low, high in segments:
    start = int(node_tai[list(mjd).index(low)]) * NS
    end = int(node_tai[list(mjd).index(high)]) * NS
    # astropy needs a following row to interpolate, so stay a second inside the end.
    cases += [start, end - NS] + [rng.randrange(start, end - NS) for _ in range(60)]
# Around the 2017-01-01 leap second: 23:59:59.5, 23:59:60.5 and 00:00:00.5 UTC.
cases += [1_483_228_835_500_000_000, 1_483_228_836_500_000_000, 1_483_228_837_500_000_000]

epoch = Time("1970-01-01T00:00:00", scale="tai", format="isot")
t = (
    epoch
    + TimeDelta([c // NS for c in cases], format="sec", scale="tai")
    + TimeDelta([(c % NS) * 1e-9 for c in cases], format="sec", scale="tai")
)
dut1 = table.ut1_utc(t.utc)
pm = table.pm_xy(t.utc)
t.delta_ut1_utc = dut1
ut1 = t.ut1
tt = t.tt

rows = []
for k, c in enumerate(cases):
    lin_dut1 = float(dut1[k].value)
    lag_ut1_tai, lag_x, lag_y = lagrange_at(c)
    # UT1 as a two-part JD from the Lagrange UT1 − TAI. The day is split off
    # in integers so the fraction keeps sub-nanosecond resolution.
    day = c // (86400 * NS)
    lag_jd1 = 2440587.5 + day
    lag_jd2 = ((c - day * 86400 * NS) / NS + lag_ut1_tai) / 86400
    rows.append(
        {
            "taiNanos": str(c),
            "linear": {
                "ut1MinusUtc": lin_dut1,
                "xp": float(pm[0][k].value),
                "yp": float(pm[1][k].value),
                "era": float(erfa.era00(ut1.jd1[k], ut1.jd2[k])),
                "gmst": float(erfa.gmst06(ut1.jd1[k], ut1.jd2[k], tt.jd1[k], tt.jd2[k])),
                "gast": float(erfa.gst06a(ut1.jd1[k], ut1.jd2[k], tt.jd1[k], tt.jd2[k])),
            },
            "lagrange": {
                "ut1MinusTai": lag_ut1_tai,
                "xp": lag_x,
                "yp": lag_y,
                "era": float(erfa.era00(lag_jd1, lag_jd2)),
                "gmst": float(erfa.gmst06(lag_jd1, lag_jd2, tt.jd1[k], tt.jd2[k])),
                "gast": float(erfa.gst06a(lag_jd1, lag_jd2, tt.jd1[k], tt.jd2[k])),
            },
        }
    )

print(
    json.dumps(
        {
            "generator": f"astropy {astropy.__version__}, pyerfa {erfa.__version__}",
            "source": SOURCE,
            "excerptSha256": hashlib.sha256(text).hexdigest(),
            "rows": rows,
        },
        indent=1,
    )
)
