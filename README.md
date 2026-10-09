# 🌍 ORBITAL — Live Planet Intelligence

![tests](https://img.shields.io/badge/pytest-6_passed-0A9EDC) ![feeds](https://img.shields.io/badge/feeds-3_live-34d399) ![keys](https://img.shields.io/badge/API_keys-zero-FF4B4B) ![License](https://img.shields.io/badge/License-MIT-green)

> **A mission control for the living planet — then you realize every dot is real.**

A slowly rotating 3D Earth. Thousands of live aircraft gliding on real ADS-B telemetry. 551 satellites sweeping overhead on real orbital elements, propagated live. Earthquakes pulsing where the ground actually moved today. Click anything and the camera chases it. Ask the analyst what's happening — by text or voice.

*Every dot is real. If a feed is down, the UI says so — there are no invented dots here.*

---

## Why this exists

Live planet-scale data is public — ADS-B transponders, orbital element sets, seismographs — but it lives in JSON endpoints nobody watches. ORBITAL puts it in one explorable globe so you can move between the whole-Earth picture and a single aircraft, satellite, or tremor. It is static-first: a scheduled job refreshes the data, the site renders it, no servers, no keys.

## 🎛️ What it does

- **🌍 Living globe** — procedural 3D Earth (no texture downloads), fresnel atmosphere, starfield, graticule. Auto-rotates; drag to spin, scroll to zoom.
- **✈️ Live flights** — thousands of aircraft as glowing points, colored by altitude, dead-reckoned smoothly between 5-minute snapshots.
- **🛰️ Live satellites** — 551 real TLEs propagated client-side with SGP4 every frame. The ISS is highlighted; GEO sats clamp visually while the HUD shows true altitude.
- **🌋 Earthquakes** — past-24h M2.5+ as pulsing points sized by magnitude.
- **🎯 Click-to-track** — click any flight, satellite, or quake: the camera chases it, a trail draws behind it, and a telemetry HUD comes up (callsign · altitude · speed · heading). ESC, drag, or ✕ releases.
- **🎙️ Talk to Orbital** — deterministic analyst over the live scene: *"How many flights are airborne?"*, *"Where is the ISS right now?"*, *"Biggest earthquake today?"*, *"Which region is busiest?"* Push-to-talk voice included; an optional LLM key unlocks open-ended questions.
- **🔍 Fly-to search** — 40 bundled world cities, no geocoder key.
- **🏷️ Honesty UI** — per-layer "updated Xs ago" badges, true-vs-sampled counts, LIVE/SNAPSHOT states.
- **🗺️ Country borders + airspace intel** — 180 country boundaries drawn on the globe; every flight tagged with the country it's over (point-in-polygon in the ETL). Click a plane to see its country; ask the analyst "flights over France?" or "busiest airspace by country?"
- **🛫 Flight route cards** — click any aircraft for a FlightRadar24-style panel: origin → destination, live progress bar, ETA and distance-to-go, altitude/speed/heading/squawk. Routes are *estimated* from live track geometry (nearest airport along the flight's track cone + climb/descent state, resolved against 4,568 real airports) — no keyless filed-plan API exists, so the method is documented and the UI labels it.

## 📡 Live data (measured 2026-10-09)

| Layer | Source | Captured |
|---|---|---|
| Flights | OpenSky Network | **11,517 airborne** → 4,516 sampled, stratified by region; each tagged with country + estimated route |
| Satellites | CelesTrak (8 groups) | **551 TLEs**, SGP4-propagated live |
| Earthquakes | USGS (M2.5+, 24h) | **34 quakes**, max M5.9 |

Full provenance, the sampling rationale, and deliberately omitted layers (ships — no keyless AIS exists) in [DATA_SOURCES.md](DATA_SOURCES.md).

## ⚡ Quick start

```bash
git clone https://github.com/prudhvikollads-source/orbital-planet-tracker.git
cd orbital-planet-tracker
bash scripts/quickstart.sh   # venv → deps → tests → ETL dry run
python3 -m http.server 8000  # serve from the REPO ROOT
# open http://localhost:8000/web/
```

No API keys. No build step. The bundled `data/live/` snapshots are real captures, so the globe is alive on first load.

**Live refresh:** add `.github/workflows/etl.yml` via the GitHub web UI (the API blocks workflow files) — the Action then refreshes snapshots every 5 minutes. **Deploy:** GitHub Pages from `/` (root); the app lives at `/web/`.

## 🕐 The first five minutes

1. **Watch the planet breathe.** Let the globe rotate — cyan flights over the Atlantic corridor, violet satellites sweeping pole to pole, an orange pulse where the ground moved.
2. **Chase a flight.** Click any aircraft: the camera locks on, a trail draws, the HUD reads callsign · altitude · speed · heading. Drag to release.
3. **Ride the ISS.** Ask *"Where is the ISS right now?"* — the analyst answers and flies you to it.
4. **Feel a quake.** Ask *"Biggest earthquake today?"* — the globe dives to the epicenter.
5. **Talk.** Hit 🎙 and ask *"Which region is busiest?"* — the answer is computed from the live flight positions, binned into a 30° grid.

## 🎙️ Talk to it

The analyst is deterministic: every number is computed from the loaded scene, so it cannot hallucinate. Voice is push-to-talk via the Web Speech API (Chrome/Edge; the text box works everywhere).

## Architecture

```
┌─────────────┐    5 min     ┌──────────────┐   same-origin   ┌────────────────┐
│  OpenSky    │─────────────▶│              │   JSON, no CORS │                │
│  CelesTrak  │─────────────▶│  GitHub      │────────────────▶│  Static 3D     │
│  USGS       │─────────────▶│  Action ETL  │                 │  site (Pages)  │
└─────────────┘              │  etl/fetch.py│                 │                │
                             └──────────────┘                 │  • flights:    │
                                                              │    dead-reckon │
                                                              │  • sats: SGP4  │
                                                              │  • analyst:    │
                                                              │    live-state  │
                                                              └────────────────┘
```

## Key engineering decisions

1. **ETL + dead reckoning over direct client polling.** *Why:* OpenSky's anonymous tier allows ~400 req/day and most feeds lack CORS. A 5-minute Action (288 req/day) respects the limit; the client interpolates between snapshots with velocity×heading. The globe never stalls on a rate limit.
2. **SGP4 client-side.** *Why:* TLEs change daily, not minutely — polling them is waste. satellite.js propagates 551 sats per frame for zero network cost after load.
3. **Honest stratified 6,000-flight cap.** *Why:* a full ~11.7k snapshot is ~600 KB — hostile to static hosting and the GitHub API. Stratified sampling (per-region caps) guarantees every continent is represented instead of letting receiver-dense US/EU drown the planet; the UI shows the true airborne total beside the sampled count.
4. **No ships.** *Why:* no keyless global AIS exists. A faked vessel layer would violate the project's founding rule ("every dot is real"), so the layer doesn't exist — documented in DATA_SOURCES.md.
5. **Deterministic analyst first.** *Why:* counts, extrema, and geo-bins don't need an LLM, and a deterministic engine can't hallucinate a flight that isn't there. The LLM key is an upgrade for open-ended chat, never the source of numbers.
6. **THREE.Points, not meshes.** *Why:* 3,000+ objects at 60fps means one draw call per layer. Only the tracked object gets a mesh + trail.
7. **Procedural globe.** *Why:* zero texture downloads, works offline after first load, and keeps the whole site keyless.

## Project structure

```
├── web/
│   ├── index.html        # app shell: topbar, HUD, analyst panel
│   ├── styles.css        # night mission-control theme
│   ├── globe.js          # Three.js scene: earth, atmosphere, stars, camera
│   ├── layers.js         # flights (dead-reckoned), sats (SGP4), quakes
│   ├── track.js          # click-to-track chase cam, trail, telemetry HUD
│   ├── analyst.js        # deterministic Q&A + voice + optional LLM
│   └── app.js            # boot, toggles, search, refresh loop
├── etl/
│   ├── fetch.py          # OpenSky + CelesTrak + USGS → data/live/
│   └── requirements.txt
├── data/
│   ├── cities.json       # 40 search cities (no geocoder key)
│   └── live/             # real snapshots (flights sharded, tles, quakes)
├── tests/test_etl.py     # schema, sampling honesty, TLE sanity (6 tests)
├── docs/index.html       # case-study page (GitHub Pages-ready)
└── .github/workflows/etl.yml  # 5-min refresh (add via web UI)
```

## Maps to your profiles

- **Data Engineer:** multi-feed ETL (REST + 3-line TLE parsing) on a 5-minute schedule; compact wire format with sharding for API limits; change-aware commits; honest sampling with provenance docs.
- **Data Scientist:** measured everything — 11,544 airborne stratified to 4,477 with guaranteed per-region coverage, 92 countries tagged via point-in-polygon; geo-binned hotspot analysis; SGP4 propagation validated against TLE checksums; eval-style schema tests.
- **AI Engineer:** deterministic agent over live state (no hallucination surface), tool-like intents, voice input pipeline, optional LLM escalation with localStorage-only keys.
- **Product Manager:** "every dot is real" as the product promise; honesty UI (freshness badges, true-vs-sampled counts) as trust features; zero-key onboarding; ships deliberately omitted rather than faked.

## What I'd do differently at scale

- **Tile the flight feed:** move from one ETL snapshot to regional shards or a WebSocket relay for true live positions.
- **Server-side SGP4 cache:** precompute sat positions per minute in the Action for weaker clients.
- **Historical replay:** store snapshots and add a time scrubber — "the planet, 6 hours ago."
- **More layers:** weather radar, wildfire detections, shipping (with a keyed AIS provider as a paid tier).

## Demo

Live: `https://prudhvikollads-source.github.io/orbital-planet-tracker/web/` (enable Pages from `/` root, add `etl.yml` for the 5-minute refresh). Case study: `docs/index.html`.
