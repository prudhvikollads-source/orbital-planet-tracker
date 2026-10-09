# DATA_SOURCES.md — every dot on the globe, traced to its feed

Zero-key principle: if a feed needs an API key, it is not in this project.
If a feed is down, the UI shows stale/absent data honestly — never invented.

## Live layers

| Layer | Feed | What we take | Cadence | Verified |
|---|---|---|---|---|
| Flights | [OpenSky Network](https://opensky-network.org/apidoc/) `/api/states/all` | icao24, callsign, lon/lat, altitude, velocity, heading | 5 min (Action) | 2026-10-09: **11,768 airborne** states parsed |
| Satellites | [CelesTrak](https://celestrak.org/) `gp.php` TLE, 8 groups | 3-line TLEs, propagated client-side (SGP4) | 5 min (Action; TLEs change daily) | 2026-10-09: **551 sats** (stations 19, visual 156, weather 72, goes 6, sarsat 83, tdrss 26, planet 117, spire 72) |
| Earthquakes | [USGS](https://earthquake.usgs.gov/) `2.5_day.geojson` | mag, place, lat/lon, depth, time | 5 min (Action) | 2026-10-09: **34 quakes**, max M5.9 |

### Honest sampling note (flights)
The OpenSky snapshot holds **2,500 of ~11,768** airborne aircraft — a deterministic
stride sample (sorted by icao24, not head-biased). Reason: static hosting. A full
snapshot is ~600 KB; the cap keeps every part file small enough for the GitHub
API and fast page loads. The UI reports the true airborne total next to the
sampled count, so the sampling is visible, not hidden.

### Satellite altitude rendering
SGP4 gives true altitude (shown in the tracking HUD). On the globe, altitude is
exaggerated (`r = 1 + min(alt/6371 × 1.5, 1.0)`) so LEO shells read visually;
GEO sats clamp at 2 R⊕ instead of their true 6.6 R⊕. This is a stated visual
choice, not data.

## Deliberately omitted

- **Ships.** There is no keyless global AIS feed. AISStream and every usable
  aggregator require an API key, which violates the zero-key principle. Rather
  than fake vessel dots, the layer does not exist. Documented, not silent.
- **adsb.lol.** Evaluated as a flight-feed candidate; returned HTTP 503 during
  verification. OpenSky was reliable, so adsb.lol is not used.

## Feed health
`etl/fetch.py` never lets one dead feed kill the others — each fetch is
isolated, and failures print `"<layer> FAILED: <reason>"` in the Action log.
The site's per-layer "updated Xs ago" badges make staleness visible to users.
