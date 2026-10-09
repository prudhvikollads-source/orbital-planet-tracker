// Talk to Orbital: deterministic analyst over the live scene state.
// Every number is computed from actual loaded data — no hallucination.
// Voice via Web Speech API (progressive enhancement); optional LLM key for
// open-ended questions only.
export function createAnalyst(getState, actions) {
  const chat = document.getElementById('chat');
  const keyInput = document.getElementById('llm-key');
  keyInput.value = localStorage.getItem('orbital_llm_key') || '';
  document.getElementById('llm-save').onclick = () => {
    localStorage.setItem('orbital_llm_key', keyInput.value.trim());
    say('Key saved in this browser only. Analytics still run on live data; open-ended questions now use the LLM.');
    document.getElementById('amode').textContent = keyInput.value.trim() ? 'analyst+llm' : 'analyst';
  };
  if (keyInput.value.trim()) document.getElementById('amode').textContent = 'analyst+llm';

  const say = (html, cls = 'bot') => {
    const d = document.createElement('div'); d.className = 'msg ' + cls;
    d.innerHTML = html; chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = ts => {
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    return s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 360)}h ago`;
  };

  function nearestCity(lat, lon, cities) {
    let best = null, bd = 1e9;
    for (const c of cities) {
      const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function counts(st) {
    const f = st.flights, s = st.sats, q = st.quakes;
    say(`<b>${f.meta.total_airborne.toLocaleString()}</b> aircraft airborne right now ` +
      `(${f.meta.sampled} in this snapshot, refreshed ${ago(f.meta.fetched_at)}).<br>` +
      `<b>${s.meta.count}</b> satellites tracked (SGP4, live).<br>` +
      `<b>${q.meta.count}</b> earthquakes M2.5+ in the last 24h.`);
  }
  function iss(st) {
    const sat = st.sats.list.find(x => /ISS/i.test(x.name));
    if (!sat) return say('ISS not in the current TLE set.');
    const near = nearestCity(sat.lat, sat.lon, st.cities);
    say(`The <b>ISS</b> is over <b>${near ? near.name : 'open ocean'}</b> right now — ` +
      `${sat.lat.toFixed(1)}°, ${sat.lon.toFixed(1)} at ${Math.round(sat.altKm)} km, ` +
      `moving ${sat.vel.toFixed(2)} km/s.`);
    actions.flyTo(sat.lat, sat.lon);
  }
  function quake(st) {
    const q = st.quakes.list[0];
    if (!q) return say('No M2.5+ quakes in the last 24h.');
    const t = new Date(q.time).toUTCString().slice(5, 22);
    say(`Biggest in 24h: <b>M${q.mag}</b> — ${esc(q.place)}<br>` +
      `Depth ${q.depth_km} km · ${t} UTC.`);
    actions.flyTo(q.lat, q.lon);
  }
  function hotspot(st) {
    // Geo-bin flights into 30° cells; report the busiest honestly.
    const bins = {};
    for (const f of st.flights.list) {
      const k = `${Math.floor((f._lat + 90) / 30)},${Math.floor((f._lon + 180) / 30)}`;
      (bins[k] = bins[k] || { n: 0, lat: 0, lon: 0 });
      bins[k].n++; bins[k].lat += f._lat; bins[k].lon += f._lon;
    }
    const top = Object.entries(bins).sort((a, b) => b[1].n - a[1].n)[0];
    if (!top) return say('No flight data loaded yet.');
    const b = top[1], clat = b.lat / b.n, clon = b.lon / b.n;
    const near = nearestCity(clat, clon, st.cities);
    say(`Busiest airspace right now: <b>${b.n} flights</b> in the 30° cell ` +
      `centered near <b>${near ? near.name : `${clat.toFixed(0)}°, ${clon.toFixed(0)}°`}</b>.`);
    actions.flyTo(clat, clon);
  }
  function help() {
    say(`I answer from the live scene — try:<br>• "How many flights are airborne?"<br>` +
      `• "Where is the ISS right now?"<br>• "Biggest earthquake today?"<br>` +
      `• "Which region is busiest?"<br>• "Fly to Tokyo"<br>• "Hide satellites"<br><br>` +
      `Add an LLM key below for open-ended questions.`);
  }

  async function llmAnswer(key, q) {
    say('Thinking…');
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: 'You are Orbital, a planet-intelligence analyst. Be terse.' },
                     { role: 'user', content: q }] }) });
      const d = await r.json();
      chat.lastChild.innerHTML = esc(d.choices[0].message.content);
    } catch (e) { chat.lastChild.innerHTML = 'LLM call failed: ' + esc(e.message); }
  }

  function ask(q) {
    say(esc(q), 'user');
    const st = getState();
    if (!st.ready) { say('Still loading the live scene — one moment.'); return; }
    const ql = q.toLowerCase();
    try {
      if (/iss\b|space station/.test(ql)) return iss(st);
      if (/quake|earthquake|tremor/.test(ql)) return quake(st);
      if (/busiest|hotspot|region|traffic/.test(ql)) return hotspot(st);
      if (/how many|count|airborne|flying/.test(ql)) return counts(st);
      if (/^(hide|show) /.test(ql)) {
        const layer = /sat/.test(ql) ? 'sats' : /flight|plane/.test(ql) ? 'flights' : /quake/.test(ql) ? 'quakes' : null;
        if (layer) { actions.toggle(layer, ql.startsWith('show')); return say(`Satellites ${ql.startsWith('show') ? 'on' : 'off'}.`.replace('Satellites', layer)); }
      }
      const fly = ql.match(/fly to ([a-z .'-]+)/);
      if (fly) {
        const c = st.cities.find(c => c.name.toLowerCase().includes(fly[1].trim()));
        if (c) { actions.flyTo(c.lat, c.lon); return say(`Flying to <b>${esc(c.name)}</b>.`); }
        return say(`I don't know "${esc(fly[1].trim())}" — try a major city.`);
      }
      if (/help|what can you/.test(ql)) return help();
      const key = localStorage.getItem('orbital_llm_key');
      if (key) return llmAnswer(key, q);
      return say(`I only answer from live scene data — try "help" for examples.<br>Add an LLM key below for open-ended questions.`);
    } catch (e) { say('That query hit a snag: ' + esc(e.message)); }
  }

  // Voice push-to-talk (progressive enhancement).
  const mic = document.getElementById('mic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { mic.style.display = 'none'; }
  else {
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
    mic.onclick = () => { mic.classList.add('listening'); rec.start(); };
    rec.onresult = e => { mic.classList.remove('listening');
      ask(e.results[0][0].transcript); };
    rec.onend = () => mic.classList.remove('listening');
    rec.onerror = () => mic.classList.remove('listening');
  }

  document.getElementById('ask-form').onsubmit = e => {
    e.preventDefault();
    const inp = document.getElementById('ask');
    if (inp.value.trim()) ask(inp.value.trim());
    inp.value = '';
  };
  document.querySelectorAll('.quick button').forEach(b =>
    b.onclick = () => ask(b.dataset.q));

  say(`👋 I'm watching <b>live</b> flights, satellites and earthquakes. Ask me what's happening up there — or press 🎙 to talk.`);
  return { ask };
}
