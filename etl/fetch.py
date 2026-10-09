"""ORBITAL ETL: live planet feeds -> compact JSON snapshots.

Why a GitHub Action instead of client polling: OpenSky's anonymous tier allows
~400 req/day and most feeds lack CORS headers. A 5-minute Action (288 req/day)
stays under the limit, and the static site loads same-origin JSON — no keys,
no CORS, GitHub Pages-ready. The client dead-reckons flights between snapshots.

Usage: python fetch.py [--check]   # --check = dry run, no writes
"""
import datetime
import json
import os
import sys

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(ROOT, "data", "live")

FLIGHT_CAP = 6000      # snapshot cap: static-hosting size honesty (see README)
SHARD = 1200           # flights per part file (GitHub API arg limits)
# Stratified sampling regions (name, lat_min, lat_max, lon_min, lon_max, cap).
# Checked in order; rest_of_world is the catch-all. Guarantees every region
# is represented instead of letting receiver-dense US/EU drown the planet.
FLIGHT_REGIONS = [
    ("north_america",    25,  72, -170,  -55, 1500),
    ("europe",           36,  72,  -12,   45, 1500),
    ("asia",              5,  55,   45,  145, 1000),
    ("south_america",   -55,  12,  -82,  -35,  500),
    ("africa_me",       -35,  36,  -20,   60,  500),
    ("oceania",         -50, -10,  110,  180,  500),
    ("rest_of_world",   -90,  90, -180,  180,  500),
]
TLE_GROUPS = ["stations", "visual", "weather", "goes",
              "sarsat", "tdrss", "planet", "spire"]


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def region_of(lat, lon):
    for name, la0, la1, lo0, lo1, _ in FLIGHT_REGIONS:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return name
    return "rest_of_world"


def fetch_flights(check):
    """OpenSky states -> airborne, compact, stratified by region, sharded."""
    r = requests.get("https://opensky-network.org/api/states/all", timeout=60)
    r.raise_for_status()
    states = r.json().get("states") or []
    recs = []
    for s in states:
        lon, lat = s[5], s[6]
        if lon is None or lat is None:
            continue
        alt = s[13] if s[13] is not None else s[7]  # geo preferred, baro fallback
        if s[8] is True and not (alt and alt > 1500):
            continue  # on ground
        if alt is None or alt < 300:
            continue
        vel = s[9] or 0.0
        hdg = s[10] if s[10] is not None else 0
        recs.append([s[0], (s[1] or "").strip() or None,
                     round(lon, 3), round(lat, 3),
                     int(alt), round(vel, 1), int(hdg)])
    recs.sort(key=lambda f: f[0])  # deterministic before bucketing
    total = len(recs)
    # Stratified: cap each region so receiver-dense areas can't drown the planet.
    caps = {name: cap for name, _, _, _, _, cap in FLIGHT_REGIONS}
    buckets = {name: [] for name, _, _, _, _, _ in FLIGHT_REGIONS}
    for f in recs:
        buckets[region_of(f[3], f[2])].append(f)
    sampled, per_region = [], {}
    for name, _, _, _, _, _ in FLIGHT_REGIONS:
        take = buckets[name][:caps[name]]
        per_region[name] = len(take)
        sampled.extend(take)
    recs = sampled
    snap = {"fetched_at": utcnow(), "source": "opensky-network",
            "total_airborne": total, "sampled": len(recs),
            "sampling": "stratified by region (guaranteed global coverage)",
            "per_region": per_region,
            "fields": ["icao24", "callsign", "lon", "lat", "alt_m",
                       "vel_ms", "hdg_deg"]}
    parts = [recs[i:i + SHARD] for i in range(0, len(recs), SHARD)] or [[]]
    d = os.path.join(LIVE, "flights")
    if not check:
        os.makedirs(d, exist_ok=True)
        for i, p in enumerate(parts):
            with open(os.path.join(d, f"part-{i}.json"), "w") as f:
                json.dump({**snap, "part": i, "parts": len(parts),
                           "flights": p}, f, separators=(",", ":"))
        # remove stale shards from a previously larger sample
        for j in range(len(parts), 8):
            p = os.path.join(d, f"part-{j}.json")
            if os.path.exists(p):
                os.remove(p)
    print(f"flights: {total} airborne -> {len(recs)} sampled, "
          f"{len(parts)} parts", flush=True)
    return len(recs)


def fetch_tles(check):
    """CelesTrak 3-line TLEs -> one JSON bundle (refreshed; SGP4 runs client-side)."""
    sats = []
    for g in TLE_GROUPS:
        r = requests.get("https://celestrak.org/NORAD/elements/gp.php",
                         params={"GROUP": g, "FORMAT": "tle"}, timeout=45)
        r.raise_for_status()
        lines = [ln.rstrip() for ln in r.text.splitlines() if ln.strip()]
        for i in range(0, len(lines) - 2, 3):
            if lines[i + 1].startswith("1 ") and lines[i + 2].startswith("2 "):
                sats.append({"n": lines[i].strip(), "g": g,
                             "l1": lines[i + 1], "l2": lines[i + 2]})
    snap = {"fetched_at": utcnow(), "source": "celestrak",
            "groups": TLE_GROUPS, "count": len(sats), "sats": sats}
    if not check:
        with open(os.path.join(LIVE, "tles.json"), "w") as f:
            json.dump(snap, f, separators=(",", ":"))
    print(f"satellites: {len(sats)} TLEs across {len(TLE_GROUPS)} groups",
          flush=True)
    return len(sats)


def fetch_quakes(check):
    """USGS past-24h M2.5+ -> compact list."""
    r = requests.get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/"
                     "summary/2.5_day.geojson", timeout=45)
    r.raise_for_status()
    feats = r.json().get("features", [])
    qs = []
    for f in feats:
        p, c = f["properties"], f["geometry"]["coordinates"]
        qs.append({"id": f["id"], "mag": p["mag"], "place": p["place"],
                   "lat": round(c[1], 3), "lon": round(c[0], 3),
                   "depth_km": c[2], "time": p["time"]})
    qs.sort(key=lambda q: -q["mag"])
    if not check:
        with open(os.path.join(LIVE, "quakes.json"), "w") as f:
            json.dump({"fetched_at": utcnow(), "source": "usgs",
                       "count": len(qs), "quakes": qs},
                      f, separators=(",", ":"))
    print(f"quakes: {len(qs)} (M2.5+, 24h)", flush=True)
    return len(qs)


def main():
    check = "--check" in sys.argv
    os.makedirs(LIVE, exist_ok=True)
    try:
        fetch_flights(check)
    except Exception as e:
        print(f"flights FAILED: {e}", flush=True)
    try:
        fetch_tles(check)
    except Exception as e:
        print(f"tles FAILED: {e}", flush=True)
    try:
        fetch_quakes(check)
    except Exception as e:
        print(f"quakes FAILED: {e}", flush=True)


if __name__ == "__main__":
    main()
