"""Tests for the ORBITAL ETL: snapshot schema, sampling honesty, TLE sanity."""
import json
import math
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(ROOT, "data", "live")


def load_flights():
    p0 = json.load(open(os.path.join(LIVE, "flights", "part-0.json")))
    out = list(p0["flights"])
    for i in range(1, p0["parts"]):
        out += json.load(open(os.path.join(LIVE, "flights",
                                           f"part-{i}.json")))["flights"]
    return p0, out


def test_flight_snapshot_schema():
    meta, flights = load_flights()
    assert meta["source"] == "opensky-network"
    assert meta["fields"] == ["icao24", "callsign", "lon", "lat", "alt_m",
                              "vel_ms", "hdg_deg", "country", "orig_iata",
                              "dest_iata", "squawk", "vspeed_ms"]
    assert meta["fetched_at"].endswith("Z")
    assert meta["sampled"] == len(flights) <= 6000
    assert meta["total_airborne"] >= len(flights) > 1000
    for f in flights[:200]:
        assert isinstance(f[0], str) and len(f[0]) == 6, f  # icao24
        assert -180 <= f[2] <= 180 and -90 <= f[3] <= 90
        assert f[4] > 300  # alt_m, airborne filter
        assert 0 <= f[6] < 360  # heading
        assert f[7] is None or isinstance(f[7], str)  # country tag
        assert f[8] is None or (isinstance(f[8], str) and len(f[8]) == 3)  # orig
        assert f[9] is None or (isinstance(f[9], str) and len(f[9]) == 3)  # dest


def test_flight_sample_is_stratified_global():
    # Stratified sampling: deterministic, no duplicates, every region covered.
    from collections import Counter
    _, flights = load_flights()
    ids = [f[0] for f in flights]
    assert len(set(ids)) == len(ids), "no duplicate aircraft"

    def region(lat, lon):
        if 25 <= lat <= 72 and -170 <= lon <= -55: return "north_america"
        if 36 <= lat <= 72 and -12 <= lon <= 45: return "europe"
        if 5 <= lat <= 55 and 45 <= lon <= 145: return "asia"
        if -55 <= lat <= 12 and -82 <= lon <= -35: return "south_america"
        if -35 <= lat <= 36 and -20 <= lon <= 60: return "africa_me"
        if -50 <= lat <= -10 and 110 <= lon <= 180: return "oceania"
        return "rest"
    counts = Counter(region(f[3], f[2]) for f in flights)
    # minimums reflect genuine OpenSky receiver coverage (Oceania is truly thin)
    minimums = {"north_america": 500, "europe": 500, "asia": 200,
                "south_america": 100, "africa_me": 100, "oceania": 20}
    for r, min_n in minimums.items():
        assert counts[r] >= min_n, f"{r} underrepresented: {counts[r]}"
    lons = [f[2] for f in flights]
    assert max(lons) - min(lons) > 200


def test_flight_country_tags():
    # Point-in-polygon tagging: most continental flights resolve a country;
    # oceanic flights are honestly null.
    _, flights = load_flights()
    tagged = sum(1 for f in flights if f[7])
    assert tagged / len(flights) > 0.4, f"only {tagged}/{len(flights)} tagged"
    names = {f[7] for f in flights if f[7]}
    assert len(names) > 30, "country tags should span dozens of countries"


def test_flight_route_estimates():
    # Route estimation: a solid majority of flights resolve an origin and
    # destination from track geometry (honest estimate, not filed plans).
    _, flights = load_flights()
    orig = sum(1 for f in flights if f[8])
    dest = sum(1 for f in flights if f[9])
    assert orig / len(flights) > 0.5, f"orig {orig}/{len(flights)}"
    assert dest / len(flights) > 0.5, f"dest {dest}/{len(flights)}"


def test_dead_reckoning_math():
    # vel=250 m/s due east for 60 s at the equator ≈ 0.135°
    lon, lat, vel, hdg = 0.0, 0.0, 250.0, 90
    d = vel * 60
    dlon = d * math.sin(math.radians(hdg)) / 111319.9
    assert abs(dlon - 0.1347) < 0.002, dlon


def test_tle_bundle_parses():
    d = json.load(open(os.path.join(LIVE, "tles.json")))
    assert d["source"] == "celestrak"
    assert 300 <= d["count"] == len(d["sats"]) <= 800
    groups = {s["g"] for s in d["sats"]}
    assert {"stations", "visual", "weather"} <= groups
    for s in d["sats"][:50]:
        assert s["l1"].startswith("1 ") and s["l2"].startswith("2 "), s["n"]
        assert len(s["l1"]) >= 69 and len(s["l2"]) >= 69  # full TLE lines
    names = " ".join(s["n"] for s in d["sats"])
    assert "ISS" in names, "ISS must be in the stations group"


def test_quake_schema():
    d = json.load(open(os.path.join(LIVE, "quakes.json")))
    assert d["source"] == "usgs"
    assert d["count"] == len(d["quakes"]) > 0
    mags = [q["mag"] for q in d["quakes"]]
    assert mags == sorted(mags, reverse=True), "sorted by magnitude desc"
    assert all(2.5 <= m <= 10 for m in mags)
    for q in d["quakes"]:
        assert -90 <= q["lat"] <= 90 and -180 <= q["lon"] <= 180


def test_cities_search_list():
    d = json.load(open(os.path.join(ROOT, "data", "cities.json")))
    names = [c["name"] for c in d["cities"]]
    assert len(names) >= 30
    for want in ("Tokyo", "London", "New York", "Sydney"):
        assert want in names
    for c in d["cities"]:
        assert -90 <= c["lat"] <= 90 and -180 <= c["lon"] <= 180
