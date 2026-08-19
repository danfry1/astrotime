# Changelog

## 0.1.0

Initial release.

- `Instant` (TAI nanoseconds) and `Duration` (signed nanoseconds) with exact arithmetic.
- Leap-second-aware UTC conversions with a bundled IERS table (valid to 2027-06-28) and `parseLeapSecondsList` for IANA/NIST and IERS formats.
- Scales: UTC, TAI, TT, GPS, TDB; seconds since J2000, Julian / Modified Julian dates, GPS week.
- ISO 8601 calendar/ordinal parsing with offsets and 1–9 fraction digits; strict token patterns; ISO and clock durations.
- Golden-vector tests against astropy 6.0.1.
