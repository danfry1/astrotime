#!/usr/bin/env python3
"""ERFA dtdb reference values for the full Fairhead & Bretagnon TDB series.

Geocentric TDB−TT (observer terms zeroed, as astropy uses for a Time without a
location) at seeded TT epochs from 1600 to 2500, plus J2000 and the validated
1972–2100 interval's ends. The test compares the series itself, in seconds,
rather than nanosecond-rounded readings, so model fidelity is visible below a
nanosecond.

  pip install pyerfa==2.0.1.5
  python3 scripts/generate-dtdb.py > tests/fixtures/erfa-dtdb.json
"""
import json
import random

import erfa

J2000 = 2451545.0
DAYS_PER_YEAR = 365.25

rng = random.Random(20261019)
days = [0.0, (1972 - 2000) * DAYS_PER_YEAR, (2100 - 2000) * DAYS_PER_YEAR]
days += [rng.uniform((1600 - 2000) * DAYS_PER_YEAR, (2500 - 2000) * DAYS_PER_YEAR) for _ in range(997)]

rows = [{"ttDaysSinceJ2000": d, "tdbMinusTt": float(erfa.dtdb(J2000, d, 0.0, 0.0, 0.0, 0.0))} for d in days]
print(
    json.dumps(
        {"generator": f"pyerfa {erfa.__version__} (ERFA {erfa.version.erfa_version}) dtdb, u = v = 0", "rows": rows},
        indent=1,
    )
)
