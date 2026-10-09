// Click-to-track: chase cam that re-centers the globe on the object,
// fading trail, telemetry HUD. ESC / drag / ✕ releases.
import * as THREE from 'three';
import { latLonToVec3, R } from './globe.js';

const Z = new THREE.Vector3(0, 0, 1);

export function createTracker(G, layers, tex) {
  let target = null;   // {type, obj, label}
  let trailPts = [];
  let trailLine = null, marker = null;
  const hud = document.getElementById('hud');

  function ensureTrail() {
    if (!trailLine) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
      trailLine = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.8 }));
      trailLine.frustumCulled = false;
      G.globe.add(trailLine);
      const sm = new THREE.SpriteMaterial({ map: tex, color: 0xffffff,
        blending: THREE.AdditiveBlending, depthWrite: false });
      marker = new THREE.Sprite(sm); marker.scale.setScalar(0.07);
      G.globe.add(marker);
    }
  }
  function pushTrail(v) {
    const last = trailPts[trailPts.length - 1];
    if (!last || last.distanceToSquared(v) > 1e-8) {
      trailPts.push(v.clone());
      if (trailPts.length > 60) trailPts.shift();
      const a = trailLine.geometry.attributes.position;
      trailPts.forEach((p, i) => a.set([p.x, p.y, p.z], i * 3));
      trailLine.geometry.setDrawRange(0, trailPts.length);
      a.needsUpdate = true;
    }
  }

  function objPos() {
    if (!target) return null;
    if (target.type === 'flight') {
      // Rebind to the live object each frame: snapshots replace the list,
      // and a vanished id means the flight left the feed.
      const f = layers.flights.list.find(x => x.id === target.obj.id);
      if (!f) { release(); return null; }
      target.obj = f;
      return layers.flightPos(f);
    }
    if (target.type === 'sat') return layers.satPos(target.obj);
    const q = target.obj;  // quake: static point
    return latLonToVec3(q.lat, q.lon, R * 1.006);
  }

  function track(type, obj, label) {
    target = { type, obj, label };
    trailPts = []; ensureTrail();
    hud.classList.remove('hidden');
    G.setAutoRotate(false);
    renderHUD();
  }
  function release() {
    target = null;
    hud.classList.add('hidden');
    if (trailLine) { G.globe.remove(trailLine); G.globe.remove(marker);
      trailLine.geometry.dispose(); trailLine = null; marker = null; }
    G.setAutoRotate(true);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderHUD() {
    if (!target) return;
    const t = target;
    let tele = '', pos = '';
    if (t.type === 'flight') {
      const f = t.obj, [lat, lon] = layers.deadReckon(f, Date.now());
      tele = `${Math.round(f.alt * 3.281)} ft · ${Math.round(f.vel * 1.944)} kts · hdg ${String(f.hdg).padStart(3, '0')}°`;
      pos = `${lat.toFixed(2)}, ${lon.toFixed(2)} · over ${f.country ? esc(f.country) : 'international waters'}`;
    } else if (t.type === 'sat') {
      const s = t.obj;
      tele = `alt ${Math.round(s.altKm)} km · ${s.vel.toFixed(2)} km/s · ${esc(s.group)}`;
      pos = `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
    } else {
      const q = t.obj;
      tele = `M${q.mag} · depth ${q.depth_km} km`;
      pos = esc(q.place || '');
    }
    hud.innerHTML = `<span class="rec"></span><b>TRACKING</b>
      <span>${esc(t.label)}</span><span class="t-tele">${tele}</span>
      <span class="t-pos">${pos}</span><button id="rel">✕</button>`;
    document.getElementById('rel').onclick = e => { e.stopPropagation(); release(); };
  }

  function update(dt) {
    if (!target) return;
    const v = objPos();
    if (!v) { release(); return; }
    pushTrail(v);
    marker.position.copy(v);
    // Rotate the globe so the object faces the camera.
    const world = v.clone().applyQuaternion(G.globe.quaternion).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(world, Z);
    const want = delta.multiply(G.globe.quaternion);
    G.globe.quaternion.slerp(want, Math.min(1, dt * 3.2));
  }
  function hudTick() { if (target) renderHUD(); }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') release(); });
  G.canvas.addEventListener('userdrag', () => release());

  return { track, release, update, hudTick, get target() { return target; } };
}
