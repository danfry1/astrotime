#!/usr/bin/env python3
"""Reference TCG and TCB readings for tests/fixtures/coordinate-times.json.

TCG is defined exactly (IAU 2000 Resolution B1.9): TCG − T0 = (TT − T0) / (1 − L_G)
with L_G = 6.969290134e-10 and T0 = 1977-01-01T00:00:32.184. Each row's
`tcgExact` is that definition evaluated in exact rational arithmetic and
rounded half away from zero to a nanosecond, independently of astropy and of
astrotime. Rows inside 1972–2100 also carry astropy's TCG and TCB readings,
which use double-precision ERFA tttcg/tdbtcb.

  pip install astropy==6.0.1
  python3 scripts/generate-coordinate-times.py > tests/fixtures/coordinate-times.json
"""
import json
import random
import warnings
from fractions import Fraction

warnings.simplefilter("ignore")
import astropy  # noqa: E402
from astropy.time import Time, TimeDelta  # noqa: E402

NS = 1_000_000_000
TT_MINUS_TAI = 32_184_000_000
LG = Fraction(6_969_290_134, 10**19)
T0 = 220_924_832_184_000_000  # 1977-01-01T00:00:32.184 as TT/TCG nanoseconds since 1970
YEAR = 31_556_952 * NS
rng = random.Random(20261019)


def round_half_away(x):
    magnitude = (abs(x) * 2 + 1) // 2
    return magnitude if x >= 0 else -magnitude


def tcg_exact(tai):
    return T0 + round_half_away(Fraction(tai + TT_MINUS_TAI - T0) / (1 - LG))


modern = [
    220_924_800 * NS,  # 1977-01-01T00:00:00 TAI: T0, where TT = TCG
    946_727_967_816_000_000,  # J2000.0, 2000-01-01T12:00:00 TT
    1_483_228_836 * NS,  # 2016-12-31T23:59:60 UTC (TAI)
    1_483_228_836 * NS + 999_999_999,
]
modern += [rng.randrange(63_072_010 * NS, 4_102_444_800 * NS) for _ in range(396)]
# The exact definition holds across the whole civil range, ±999 999 years.
far = [rng.randrange(-998_000 * YEAR, 998_000 * YEAR) for _ in range(100)]

epoch = Time("1970-01-01T00:00:00", scale="tai", format="isot")
times = (
    epoch
    + TimeDelta([c // NS for c in modern], format="sec", scale="tai")
    + TimeDelta([(c % NS) * 1e-9 for c in modern], format="sec", scale="tai")
)
times.precision = 9
tcg = times.tcg.isot
tcb = times.tcb.isot

rows = [
    {"taiNanos": str(c), "tcgExact": str(tcg_exact(c)), "tcgAstropy": tcg[i], "tcbAstropy": tcb[i]}
    for i, c in enumerate(modern)
]
rows += [{"taiNanos": str(c), "tcgExact": str(tcg_exact(c))} for c in far]
print(json.dumps({"generator": f"exact rational IAU definitions; astropy {astropy.__version__}", "rows": rows}, indent=1))
