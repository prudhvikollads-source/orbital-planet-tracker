// ORBITAL boot: globe + layers + tracking + analyst + UI wiring.
import { createGlobe, glowTexture } from './globe.js';
import { createLayers } from './layers.js';
import { createTracker } from './track.js';
import { createAnalyst } from './analyst.js';

const dataURL = p => new URL('../data/' + p, import.meta.url).href;
const $ = id => document.getElementById(id);
const ago = ts => {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

let G, L, tracker, cities = [], ready = false;
const tex = glowTexture();

function renderCounts() {
  if (L.flights.meta) {
    $('c-flights').textContent = L.flights.meta.total_airborne.toLocaleString();
    $('upd-flights').textContent = ago(L.flights.meta.fetched_at);
  }
  if (L.sats.meta) {
    $('c-sats').textContent = L.sats.meta.count;
    $('upd-sats').textContent = ago(L.sats.meta.fetched_at);
  }
  if (L.quakes.meta) {
    $('c-quakes').textContent = L.quakes.meta.count;
    $('upd-quakes').textContent = ago(L.quakes.meta.fetched_at);
  }
}

function getState() {
  return { ready, flights: L.flights, sats: L.sats, quakes: L.quakes, cities };
}
const actions = {
  flyTo: (lat, lon) => G.flyTo(lat, lon),
  toggle: (layer, on) => {
    L.setVisible(layer, on);
    $( { flights: 'tgl-flights', sats: 'tgl-sats', quakes: 'tgl-quakes' }[layer]).checked = on;
  },
};

async function boot() {
  const canvas = $('globe');
  G = createGlobe(canvas);
  L = createLayers(G, tex);
  tracker = createTracker(G, L, tex);
  cities = (await (await fetch(dataURL('cities.json'))).json()).cities;

  // Load layers in parallel; each renders as it arrives.
  await Promise.all([
    L.loadFlights().then(renderCounts).catch(e => console.warn('flights', e)),
    L.loadSats().then(renderCounts).catch(e => console.warn('sats', e)),
    L.loadQuakes().then(renderCounts).catch(e => console.warn('quakes', e)),
  ]);
  ready = true; renderCounts();

  createAnalyst(getState, actions);

  // Layer toggles.
  $('tgl-flights').onchange = e => L.setVisible('flights', e.target.checked);
  $('tgl-sats').onchange = e => L.setVisible('sats', e.target.checked);
  $('tgl-quakes').onchange = e => L.setVisible('quakes', e.target.checked);

  // Search -> fly.
  const go = () => {
    const q = $('q').value.trim().toLowerCase();
    if (!q) return;
    const c = cities.find(c => c.name.toLowerCase().includes(q));
    if (c) G.flyTo(c.lat, c.lon);
  };
  $('go').onclick = go;
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  // Click -> track (but not when the user was dragging).
  canvas.addEventListener('click', e => {
    if (G.wasDragged()) return;
    const r = canvas.getBoundingClientRect();
    const hit = L.pick(((e.clientX - r.left) / r.width) * 2 - 1,
                       -((e.clientY - r.top) / r.height) * 2 + 1);
    if (!hit) return;
    if (hit.type === 'flight') {
      const f = L.flights.list[hit.i];
      tracker.track('flight', f, `${f.cs || f.id}`);
    } else if (hit.type === 'sat') {
      const s = L.sats.list[hit.i];
      tracker.track('sat', s, s.name.trim());
    } else {
      const q = L.quakes.list[hit.i];
      tracker.track('quake', q, `M${q.mag} ${q.place || ''}`.trim());
    }
  });

  // Refresh snapshots every 5 min (matches the Action cadence).
  setInterval(async () => {
    try { await L.loadFlights(); renderCounts(); } catch (e) { console.warn(e); }
    try { await L.loadQuakes(); renderCounts(); } catch (e) { console.warn(e); }
  }, 5 * 60 * 1000);
  setInterval(renderCounts, 30000);
  setInterval(() => tracker.hudTick(), 2000);

  // Main loop.
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    G.resize();
    G.tick(dt, now);
    L.update(dt, now);
    tracker.update(dt);
    G.renderer.render(G.scene, G.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
boot();
