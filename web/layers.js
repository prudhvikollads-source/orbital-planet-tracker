// Live layers: flights (dead-reckoned Points), satellites (SGP4 via satellite.js),
// earthquakes (pulsing Points). All geometry in globe-local coordinates.
import * as THREE from 'three';
import { latLonToVec3, pointsMaterial, orientedPointsMaterial, planeTexture, R } from './globe.js';
/* global satellite */

const dataURL = p => new URL('../data/' + p, import.meta.url).href;
const T0 = Date.now();

function flightColor(alt) {
  if (alt < 3000) return [0.98, 0.75, 0.29];   // low -> amber
  if (alt < 9000) return [0.49, 0.83, 0.99];   // mid  -> sky
  return [0.88, 0.95, 1.0];                     // cruise -> ice
}

function makeCloud(n, tex, px, oriented) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aHdg', new THREE.BufferAttribute(new Float32Array(n), 1));
  const pts = new THREE.Points(g,
    oriented ? orientedPointsMaterial(tex, px) : pointsMaterial(tex, 0.95, px));
  pts.frustumCulled = false;
  return pts;
}
function setPoint(pts, i, v, color, size, hdg = 0) {
  pts.geometry.attributes.position.set([v.x, v.y, v.z], i * 3);
  pts.geometry.attributes.aColor.set(color, i * 3);
  pts.geometry.attributes.aSize.set([size], i);
  pts.geometry.attributes.aHdg.set([hdg], i);
}
function flagDirty(pts) {
  pts.geometry.attributes.position.needsUpdate = true;
  pts.geometry.attributes.aColor.needsUpdate = true;
  pts.geometry.attributes.aSize.needsUpdate = true;
  pts.geometry.attributes.aHdg.needsUpdate = true;
}

export function createLayers(G, tex) {
  const PX = (G.renderer && G.renderer.getPixelRatio()) || 1; // device px per CSS px
  const planeTex = planeTexture(); // flights render as heading-oriented aircraft
  const flights = { list: [], pts: null, meta: null };
  const sats = { list: [], pts: null, meta: null, tick: 0 };
  const quakes = { list: [], pts: null, meta: null };
  let borders = null;

  // Country borders: baked 110m line segments, drawn once.
  async function loadBorders() {
    const d = await (await fetch(dataURL('countries.json'))).json();
    const seg = [];
    for (const ring of d.borders)
      for (let i = 0; i < ring.length - 1; i++) {
        seg.push(latLonToVec3(ring[i][1], ring[i][0], R * 1.002));
        seg.push(latLonToVec3(ring[i + 1][1], ring[i + 1][0], R * 1.002));
      }
    const g = new THREE.BufferGeometry().setFromPoints(seg);
    borders = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0x4c6ef5, transparent: true, opacity: 0.38 }));
    G.globe.add(borders);
  }

  async function loadFlights() {
    const p0 = await (await fetch(dataURL('live/flights/part-0.json'))).json();
    let all = p0.flights;
    for (let i = 1; i < p0.parts; i++)
      all = all.concat((await (await fetch(dataURL(`live/flights/part-${i}.json`))).json()).flights);
    flights.meta = p0; flights.list = all.map(f => ({
      id: f[0], cs: f[1] || f[0], lon: f[2], lat: f[3],
      alt: f[4], vel: f[5], hdg: f[6], country: f[7] || null, t0: T0 }));
    flights.pts = makeCloud(flights.list.length, planeTex, PX, true);
    G.globe.add(flights.pts);
    refreshFlightPoints(0);
  }
  function deadReckon(f, now) {
    const dt = Math.max(0, (now - f.t0) / 1000), d = f.vel * dt;
    const hr = f.hdg * Math.PI / 180, latR = f.lat * Math.PI / 180;
    let lat = f.lat + d * Math.cos(hr) / 111319.9;
    let lon = f.lon + d * Math.sin(hr) / (111319.9 * Math.cos(latR));
    lon = ((lon + 540) % 360) - 180;
    lat = Math.max(-85, Math.min(85, lat));
    return [lat, lon];
  }
  function refreshFlightPoints(now) {
    const v = new THREE.Vector3();
    flights.list.forEach((f, i) => {
      const [lat, lon] = deadReckon(f, now);
      f._lat = lat; f._lon = lon;
      setPoint(flights.pts, i, v.copy(latLonToVec3(lat, lon, R * 1.004)),
               flightColor(f.alt), 8, f.hdg || 0);
    });
    flagDirty(flights.pts);
  }

  async function loadSats() {
    const d = await (await fetch(dataURL('live/tles.json'))).json();
    sats.meta = d;
    sats.list = d.sats.map(s => {
      let rec = null;
      try { rec = satellite.twoline2satrec(s.l1, s.l2); } catch (_) { /* skip */ }
      return { name: s.n, group: s.g, rec, lat: 0, lon: 0, altKm: 0, vel: 0 };
    }).filter(s => s.rec);
    sats.pts = makeCloud(sats.list.length, tex, PX);
    G.globe.add(sats.pts);
    propagateSats(new Date());
  }
  function propagateSats(date) {
    const v = new THREE.Vector3();
    const gmst = satellite.gstime(date);
    sats.list.forEach((s, i) => {
      try {
        const pv = satellite.propagate(s.rec, date);
        if (!pv || !pv.position) return;
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        s.lat = satellite.degreesLat(gd.latitude);
        s.lon = satellite.degreesLong(gd.longitude);
        s.altKm = gd.height;
        s.vel = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
        const r = R * (1 + Math.min(s.altKm / 6371 * 1.5, 1.0)); // exaggerated, HUD shows true
        const iss = /ISS/i.test(s.name);
        setPoint(sats.pts, i, v.copy(latLonToVec3(s.lat, s.lon, r)),
                 iss ? [0.3, 1, 0.7] : [0.77, 0.71, 0.99], iss ? 8 : 4.2);
      } catch (_) { /* stale TLE, keep last */ }
    });
    flagDirty(sats.pts);
  }

  async function loadQuakes() {
    const d = await (await fetch(dataURL('live/quakes.json'))).json();
    quakes.meta = d; quakes.list = d.quakes;
    quakes.pts = makeCloud(quakes.list.length, tex, PX);
    G.globe.add(quakes.pts);
  }
  function refreshQuakes(now) {
    if (!quakes.pts) return;
    const v = new THREE.Vector3(), t = now / 1000;
    quakes.list.forEach((q, i) => {
      const pulse = 1 + 0.22 * Math.sin(t * 2.5 + i * 1.7);
      const heat = Math.min(1, (q.mag - 2.5) / 4);
      setPoint(quakes.pts, i, v.copy(latLonToVec3(q.lat, q.lon, R * 1.006)),
               [1, 0.55 - heat * 0.25, 0.2], (5 + q.mag * 2.6) * pulse);
    });
    flagDirty(quakes.pts);
  }

  // ---- picking ----
  const ray = new THREE.Raycaster();
  ray.params.Points = { threshold: 0.022 };
  function pick(nx, ny) {
    ray.setFromCamera({ x: nx, y: ny }, G.camera);
    let best = null;
    const tryPts = (pts, type, list) => {
      if (!pts || !pts.visible || !list.length) return;
      const hit = ray.intersectObject(pts)[0];
      if (hit && (!best || hit.distance < best.d))
        best = { d: hit.distance, type, i: hit.index };
    };
    tryPts(flights.pts, 'flight', flights.list);
    tryPts(sats.pts, 'sat', sats.list);
    tryPts(quakes.pts, 'quake', quakes.list);
    return best;
  }

  function update(dt, now) {
    if (flights.pts && flights.pts.visible) refreshFlightPoints(now);
    if (sats.pts && sats.pts.visible && (sats.tick++ % 2 === 0)) propagateSats(new Date());
    refreshQuakes(now);
  }
  function setVisible(layer, on) {
    if (layer === 'borders') { if (borders) borders.visible = on; return; }
    ({ flights: flights.pts, sats: sats.pts, quakes: quakes.pts })[layer].visible = on;
  }
  // Current dead-reckoned position of a flight (globe-local).
  function flightPos(f, now = Date.now()) {
    const [lat, lon] = deadReckon(f, now);
    return latLonToVec3(lat, lon, R * 1.004);
  }
  function satPos(s) {
    const r = R * (1 + Math.min(s.altKm / 6371 * 1.5, 1.0));
    return latLonToVec3(s.lat, s.lon, r);
  }

  return { flights, sats, quakes, loadFlights, loadSats, loadQuakes, loadBorders,
           update, setVisible, pick, flightPos, satPos, deadReckon };
}
