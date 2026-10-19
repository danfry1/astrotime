#!/usr/bin/env python3
"""astropy references for topocentric TDB and TCB (an observer on the Earth).

For WGS84 observers at the three Deep Space Network complexes, the equator,
the South Pole and Mauna Kea, astropy's TDB and TCB readings (Time with a
location, which applies ERFA dtdb's topocentric terms) at seeded instants
from 1972 to 2100 and at a leap second. Each row also carries the
topocentric part alone in seconds (ERFA dtdb with the observer minus dtdb
without), and each observer its ERFA gd2gc distances from the spin axis and
the equatorial plane, so sub-nanosecond terms are checked directly.

  pip install astropy==6.0.1
  python3 scripts/generate-topocentric.py > tests/fixtures/astropy-topocentric.json
"""
import json
import random
import warnings

warnings.simplefilter("ignore")
import astropy  # noqa: E402
import erfa  # noqa: E402
import numpy as np  # noqa: E402
import astropy.units as u  # noqa: E402
from astropy.coordinates import EarthLocation  # noqa: E402
from astropy.time import Time, TimeDelta  # noqa: E402
from astropy.time.utils import day_frac  # noqa: E402

NS = 1_000_000_000
OBSERVERS = {
    "Goldstone DSS-14": (-116.889, 35.426, 1002.0),
    "Madrid DSS-63": (-4.248, 40.431, 865.0),
    "Canberra DSS-43": (148.981, -35.402, 689.0),
    "Equator": (0.0, 0.0, 0.0),
    "South Pole": (0.0, -90.0, 2835.0),
    "Mauna Kea": (-155.4681, 19.8207, 4207.0),
}
rng = random.Random(20261019)
cases = [rng.randrange(63_072_010 * NS, 4_102_444_800 * NS) for _ in range(40)]
cases.append(1_483_228_836_500_000_000)  # 2016-12-31T23:59:60.5 UTC

epoch = Time("1970-01-01T00:00:00", scale="tai", format="isot")
rows = []
OBSERVER_UV = {}
for name, (lon, lat, height) in OBSERVERS.items():
    location = EarthLocation.from_geodetic(lon * u.deg, lat * u.deg, height * u.m, ellipsoid="WGS84")
    t = (
        epoch
        + TimeDelta([c // NS for c in cases], format="sec", scale="tai")
        + TimeDelta([(c % NS) * 1e-9 for c in cases], format="sec", scale="tai")
    )
    t = Time(t, location=location)
    t.precision = 9
    tdb, tcb = t.tdb.isot, t.tcb.isot
    xyz = erfa.gd2gc(1, np.radians(lon), np.radians(lat), height)
    u_km, v_km = float(np.hypot(xyz[0], xyz[1])) / 1000, float(xyz[2]) / 1000
    OBSERVER_UV[name] = (u_km, v_km)
    tt = t.tt
    # The UTC fraction of the day exactly as astropy derives it for dtdb.
    njd1, njd2 = erfa.taiutc(*erfa.tttai(tt.jd1, tt.jd2))
    ut = [float(f) % 1.0 for f in day_frac(njd1 - 0.5, njd2)[1]]
    for k, c in enumerate(cases):
        topocentric = erfa.dtdb(tt.jd1[k], tt.jd2[k], ut[k], np.radians(lon), u_km, v_km) - erfa.dtdb(
            tt.jd1[k], tt.jd2[k], ut[k], 0.0, 0.0, 0.0
        )
        rows.append(
            {
                "observer": name,
                "taiNanos": str(c),
                "tdb": tdb[k],
                "tcb": tcb[k],
                "utcDayFraction": ut[k],
                "topocentricSeconds": float(topocentric),
            }
        )

print(
    json.dumps(
        {
            "generator": f"astropy {astropy.__version__}",
            "observers": {
                k: {"longitudeDeg": v[0], "latitudeDeg": v[1], "heightM": v[2], "uKm": OBSERVER_UV[k][0], "vKm": OBSERVER_UV[k][1]}
                for k, v in OBSERVERS.items()
            },
            "rows": rows,
        },
        indent=1,
    )
)
