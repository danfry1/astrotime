#!/usr/bin/env python3
"""ERFA references for nutation, obliquity and the equation of the equinoxes.

Seeded TT epochs from 1800 to 2200 (plus J2000.0 and the interval's ends):
ERFA nut06a (Δψ, Δε), obl06, eect00 and ee06a. ee06a is computed by ERFA as
gst06a − gmst06, through the full IAU 2006/2000A precession-nutation matrix,
so it independently checks astrotime's Δψ cos ε_A + complementary-terms form.

  pip install pyerfa==2.0.1.5
  python3 scripts/generate-nutation.py > tests/fixtures/erfa-nutation.json
"""
import json
import random

import erfa

J2000 = 2451545.0
CENTURY = 36525.0
rng = random.Random(20261019)
days = [0.0, -2 * CENTURY, 2 * CENTURY] + [rng.uniform(-2 * CENTURY, 2 * CENTURY) for _ in range(497)]

rows = []
for d in days:
    dpsi, deps = erfa.nut06a(J2000, d)
    rows.append(
        {
            "ttDaysSinceJ2000": d,
            "dpsi": float(dpsi),
            "deps": float(deps),
            "obliquity": float(erfa.obl06(J2000, d)),
            "complementary": float(erfa.eect00(J2000, d)),
            "equationOfEquinoxes": float(erfa.ee06a(J2000, d)),
        }
    )
print(json.dumps({"generator": f"pyerfa {erfa.__version__} (ERFA {erfa.version.erfa_version})", "rows": rows}, indent=1))
