// Procedural 3D globe: no external textures. Dark earth, fresnel atmosphere,
// graticule, starfield. Exposes rotation/fly-to primitives for layers+tracking.
import * as THREE from 'three';

export const R = 1;
export function latLonToVec3(lat, lon, r = R) {
  const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta));
}

// Soft round sprite texture (canvas-generated) for additive glow points.
export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

export function pointsMaterial(tex, opacity = 0.95) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uOp: { value: opacity } },
    vertexShader: `attribute float aSize; attribute vec3 aColor; varying vec3 vC;
      void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=aSize*(320.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uTex; uniform float uOp; varying vec3 vC;
      void main(){ float a=texture2D(uTex,gl_PointCoord).a;
        gl_FragColor=vec4(vC,a*uOp); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

export function createGlobe(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(0, 0, 3.1);

  const globe = new THREE.Group(); scene.add(globe);

  // Earth: very dark blue-black sphere with subtle vertical shading.
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 72, 72),
    new THREE.MeshBasicMaterial({ color: 0x0a1224 }));
  globe.add(earth);

  // Graticule: faint lat/lon grid for orientation.
  {
    const pts = [];
    for (let lon = -180; lon < 180; lon += 15)
      for (let a = -75; a < 75; a += 5) {
        pts.push(latLonToVec3(a, lon, R * 1.001), latLonToVec3(a + 5, lon, R * 1.001));
      }
    for (let lat = -75; lat <= 75; lat += 15)
      for (let lon = -180; lon < 180; lon += 5) {
        pts.push(latLonToVec3(lat, lon, R * 1.001), latLonToVec3(lat, lon + 5, R * 1.001));
      }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    globe.add(new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0x1e2c52, transparent: true, opacity: 0.5 })));
  }

  // Atmosphere: fresnel-ish rim glow shell.
  {
    const mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vN;
        void main(){ float i=pow(0.72-dot(vN,vec3(0.,0.,1.)),3.2);
          gl_FragColor=vec4(0.25,0.55,1.0,1.0)*i*1.4; }`,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.22, 64, 64), mat));
  }

  // Starfield.
  {
    const n = 1600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 40);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x8ea2cc, size: 0.09, transparent: true, opacity: 0.75,
      sizeAttenuation: true, depthWrite: false })));
  }

  const Z = new THREE.Vector3(0, 0, 1);
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
  let flyTarget = null, lastInteract = 0, autoRotate = true;

  function faceLatLon(lat, lon) {  // quaternion that faces lat/lon at camera
    const v = latLonToVec3(lat, lon).normalize();
    return new THREE.Quaternion().setFromUnitVectors(v, Z);
  }
  function flyTo(lat, lon) {
    // Compose: rotate current orientation so (lat,lon) faces camera.
    const v = latLonToVec3(lat, lon).applyQuaternion(globe.quaternion).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(v, Z);
    flyTarget = delta.multiply(globe.quaternion).clone();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  // Drag to spin (spherical), wheel to zoom.
  let dragging = false, px = 0, py = 0, moved = false;
  canvas.addEventListener('pointerdown', e => { dragging = true; moved = false; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.005);
    globe.quaternion.premultiply(tmpQ);
    tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.005);
    globe.quaternion.premultiply(tmpQ);
    flyTarget = null; lastInteract = performance.now();
    canvas.dispatchEvent(new CustomEvent('userdrag'));
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camera.position.z = Math.min(6, Math.max(1.7, camera.position.z + e.deltaY * 0.002));
    lastInteract = performance.now();
  }, { passive: false });

  function tick(dt, now) {
    if (flyTarget) {
      globe.quaternion.slerp(flyTarget, Math.min(1, dt * 2.2));
      if (globe.quaternion.angleTo(flyTarget) < 0.002) flyTarget = null;
    } else if (autoRotate && !dragging && now - lastInteract > 4000) {
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.03);
      globe.quaternion.premultiply(tmpQ);
    }
  }
  function wasDragged() { const m = moved; moved = false; return m; }

  return { scene, camera, renderer, globe, R, resize, tick, flyTo, faceLatLon,
           wasDragged, setAutoRotate: v => autoRotate = v,
           canvas, THREE };
}
