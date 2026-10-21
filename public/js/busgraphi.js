/* Busgraphi front-end: Manual mode (interactive map) + Assistant mode (chat, read-only map). */
(() => {
  'use strict';

  const CFG = window.BUSGRAPHI;
  const EP = CFG.endpoints;
  const BBOX = { latMin: 12.9, latMax: 14.6, lonMin: -90.3, lonMax: -87.5 };
  const PALETTE = ['#1f5f8b', '#b4532a', '#2f7d5b', '#7a4e9b', '#a07a12', '#1b7f8c', '#9b3d54', '#4c6a2f', '#566b8f', '#8a5a44', '#3b6e8f', '#a05a2c'];
  const WALK_COLOR = '#52606d';
  const EXAMPLES = [
    '¿Cómo llego de Metrocentro a la Catedral de Santa Ana?',
    'And from where I get off, how can I reach Chalchuapa?',
  ];
  const WELCOME = 'Hi! I can plan **bus trips in El Salvador**. Tell me where you are and where you want to go, in English or Spanish.\n\n' +
    'You can also ask follow-ups such as *"and from where I get off, how do I get to…?"*';

  // ---------------------------------------------------------------- helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mins = (sec) => `${Math.max(1, Math.round(sec / 60))} min`;
  const dist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const inSV = (lat, lon) => lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
  const store = {
    get(k) { try { return localStorage.getItem('busgraphi.' + k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('busgraphi.' + k) : localStorage.setItem('busgraphi.' + k, v); } catch { /* ignore */ } },
  };
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
  async function api(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': csrf(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 419) {
      const err = new Error('Your session expired. Please reload the page.');
      err.status = 419;
      throw err;
    }
    if (!res.ok) {
      const first = data?.errors ? Object.values(data.errors).flat()[0] : null;
      const err = new Error(first || data?.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------- state
  const S = {
    mode: 'manual',
    stops: [], stopById: new Map(), routes: [], routeById: new Map(), servedBy: new Map(),
    stopMarkers: new Map(), lineLayers: [],
    selectedRoute: null,
    from: null, to: null,
    hintDismissed: false,
    fitted: false,
    chat: { sid: store.get('sid'), busy: false, shareLoc: false, loc: null },
  };

  // ---------------------------------------------------------------- map
  const map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 7, zoomSnap: 0.5 })
    .setView(CFG.map.center, CFG.map.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer(CFG.map.tile_url, { maxZoom: 19, attribution: CFG.map.attribution }).addTo(map);

  const G = {
    routes: L.layerGroup().addTo(map),
    stops: L.layerGroup().addTo(map),
    journey: { manual: L.layerGroup(), assistant: L.layerGroup() },
    pins: L.layerGroup(),
    me: L.layerGroup().addTo(map),
  };

  const stopRadius = (z) => (z <= 8 ? 2.2 : z <= 10 ? 3 : z <= 12 ? 4 : z <= 14 ? 5.5 : 7);
  map.on('zoomend', () => {
    const r = stopRadius(map.getZoom());
    S.stopMarkers.forEach((m) => m.setRadius(r));
  });

  // ---------------------------------------------------------------- network
  function routeColor(route) { return route?._color || PALETTE[0]; }
  function routeColorById(id, code) {
    const r = S.routeById.get(id);
    if (r) return routeColor(r);
    let h = 0; for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  async function loadNetwork() {
    $('#map-loading').hidden = false;
    $('#map-error').hidden = true;
    try {
      const data = await api(EP.network);
      S.stops = data.stops || [];
      S.routes = data.routes || [];
      S.stopById = new Map(S.stops.map((s) => [s.id, (s._n = norm(`${s.name} ${s.municipality || ''}`), s)]));
      S.routeById = new Map();
      S.servedBy = new Map();
      S.routes.forEach((r, i) => {
        r._color = r.colour || PALETTE[i % PALETTE.length];
        S.routeById.set(r.id, r);
        r.patterns.forEach((p) => p.stop_ids.forEach((id) => {
          if (!S.servedBy.has(id)) S.servedBy.set(id, new Map());
          S.servedBy.get(id).set(r.id, r);
        }));
      });
      renderNetwork();
      renderRouteList();
      $('#stops-count').textContent = `(${S.stops.length})`;
      $('#lines-count').textContent = `(${S.routes.length})`;
      $('#routes-count').textContent = S.routes.length;
      if (!S.fitted && S.stops.length) {
        map.fitBounds(S.stops.map((s) => [s.lat, s.lon]), { padding: [30, 30] });
        S.fitted = true;
      }
    } catch (e) {
      $('#map-error-msg').textContent = e.message;
      $('#map-error').hidden = false;
    } finally {
      $('#map-loading').hidden = true;
    }
  }

  /** (Re)draws every stop and route line. In assistant mode nothing is interactive. */
  function renderNetwork() {
    const interactive = S.mode === 'manual';
    G.routes.clearLayers();
    G.stops.clearLayers();
    S.stopMarkers.clear();
    S.lineLayers = [];

    S.routes.forEach((route) => {
      route.patterns.forEach((p) => {
        const pts = p.stop_ids.map((id) => S.stopById.get(id)).filter(Boolean).map((s) => [s.lat, s.lon]);
        if (pts.length < 2) return;
        const line = L.polyline(pts, { color: routeColor(route), weight: 3, opacity: 0.55, interactive, bubblingMouseEvents: false });
        if (interactive) {
          line.on('click', () => selectRoute(route.id));
          line.bindTooltip(`Route ${route.code}${p.headsign ? ' → ' + p.headsign : ''}`, { sticky: true });
        }
        G.routes.addLayer(line);
        S.lineLayers.push({ layer: line, routeId: route.id });
      });
    });

    const radius = stopRadius(map.getZoom());
    S.stops.forEach((stop) => {
      const m = L.circleMarker([stop.lat, stop.lon], {
        radius, color: '#2d4a68', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, interactive, bubblingMouseEvents: false,
      });
      if (interactive) {
        m.on('click', () => openStopPopup(stop));
        m.once('mouseover', () => m.bindTooltip(esc(stop.name), { direction: 'top', offset: [0, -4] }).openTooltip());
      }
      G.stops.addLayer(m);
      S.stopMarkers.set(stop.id, m);
    });

    applyRouteSelection();
    bringJourneyToFront();
    $('#layer-stops').dispatchEvent(new Event('change'));
    $('#layer-routes').dispatchEvent(new Event('change'));
  }

  function bringJourneyToFront() {
    G.journey[S.mode].eachLayer((l) => l.bringToFront && l.bringToFront());
  }

  function applyRouteSelection() {
    const sel = S.selectedRoute ? S.routeById.get(S.selectedRoute) : null;
    const members = sel ? new Set(sel.patterns.flatMap((p) => p.stop_ids)) : null;
    S.lineLayers.forEach(({ layer, routeId }) => {
      layer.setStyle(sel ? (routeId === sel.id ? { opacity: 0.95, weight: 5 } : { opacity: 0.1, weight: 2 }) : { opacity: 0.55, weight: 3 });
    });
    S.stopMarkers.forEach((m, id) => {
      if (!sel) m.setStyle({ color: '#2d4a68', weight: 1.5, opacity: 1, fillOpacity: 1 });
      else if (members.has(id)) m.setStyle({ color: routeColor(sel), weight: 2.5, opacity: 1, fillOpacity: 1 });
      else m.setStyle({ color: '#2d4a68', weight: 1, opacity: 0.3, fillOpacity: 0.4 });
    });
  }

  // layer toggles
  $('#layer-stops').addEventListener('change', (e) => { e.target.checked ? map.addLayer(G.stops) : map.removeLayer(G.stops); });
  $('#layer-routes').addEventListener('change', (e) => { e.target.checked ? map.addLayer(G.routes) : map.removeLayer(G.routes); });
  $('#map-retry').addEventListener('click', loadNetwork);

  // ---------------------------------------------------------------- manual mode: popups & endpoints
  function openStopPopup(stop) {
    const served = Array.from(S.servedBy.get(stop.id)?.values() || []).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const box = el('div', 'popup',
      `<strong>${esc(stop.name)}</strong><span class="muted">${esc(stop.municipality || '')}</span>` +
      `<div class="codes">${served.map((r) => `<span class="code" style="--c:${routeColor(r)}">${esc(r.code)}</span>`).join('') || '<em class="muted">No routes registered</em>'}</div>` +
      '<div class="popup-actions"><button type="button" data-act="from">From here</button><button type="button" data-act="to">To here</button></div>');
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      setEndpoint(b.dataset.act, { type: 'stop', id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon });
      map.closePopup();
    });
    L.popup({ offset: [0, -2] }).setLatLng([stop.lat, stop.lon]).setContent(box).openOn(map);
  }

  map.on('click', (e) => {
    if (S.mode !== 'manual') return;
    const { lat, lng } = e.latlng;
    const ok = inSV(lat, lng);
    const box = el('div', 'popup',
      `<strong>Selected point</strong><span class="muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>` +
      (ok ? '<div class="popup-actions" style="margin-top:8px"><button type="button" data-act="from">From here</button><button type="button" data-act="to">To here</button></div>'
        : '<p class="muted" style="margin:8px 0 0">This point is outside El Salvador.</p>'));
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      setEndpoint(b.dataset.act, { type: 'point', name: `Point ${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lon: lng });
      map.closePopup();
    });
    L.popup().setLatLng(e.latlng).setContent(box).openOn(map);
  });

  function setEndpoint(which, ep) {
    S[which] = ep;
    S.hintDismissed = true;
    syncInputs(); syncPins(); updateRibbon(); updatePlanBtn();
  }
  function syncInputs() {
    ['from', 'to'].forEach((w) => {
      const f = $(`[data-field="${w}"]`);
      $('input', f).value = S[w]?.name || '';
      $('.clear', f).hidden = !S[w];
    });
  }
  function syncPins() {
    G.pins.clearLayers();
    [['from', 'a', 'A'], ['to', 'b', 'B']].forEach(([w, cls, letter]) => {
      const ep = S[w];
      if (!ep) return;
      G.pins.addLayer(L.marker([ep.lat, ep.lon], {
        icon: L.divIcon({ className: `map-pin ${cls}`, html: `<span><b>${letter}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 36] }),
        interactive: false, keyboard: false,
      }));
    });
  }
  function updatePlanBtn() { $('#plan-btn').disabled = !(S.from && S.to); }

  // origin / destination search (local, the whole network is already loaded)
  function searchStops(q) {
    const n = norm(q).trim();
    if (n.length < 2) return [];
    const out = [];
    for (const s of S.stops) {
      const name = norm(s.name);
      let rank = -1;
      if (name.startsWith(n)) rank = 0;
      else if (name.includes(' ' + n)) rank = 1;
      else if (s._n.includes(n)) rank = 2;
      if (rank >= 0) out.push([rank, s]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
    return out.slice(0, 8).map((x) => x[1]);
  }

  function wireCombo(which) {
    const field = $(`[data-field="${which}"]`);
    const input = $('input', field);
    const list = $('.suggest', field);
    let items = [];
    let idx = -1;
    const close = () => { list.hidden = true; idx = -1; };
    const paint = () => $$('li', list).forEach((li, i) => li.classList.toggle('on', i === idx));
    const choose = (s) => {
      setEndpoint(which, { type: 'stop', id: s.id, name: s.name, lat: s.lat, lon: s.lon });
      map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 14), { duration: 0.6 });
      close();
    };
    input.addEventListener('input', () => {
      if (S[which]) { S[which] = null; syncPins(); updatePlanBtn(); $('.clear', field).hidden = true; }
      items = searchStops(input.value);
      list.innerHTML = items.map((s, i) => `<li data-i="${i}"><span>${esc(s.name)}</span><small>${esc(s.municipality || '')}</small></li>`).join('');
      list.hidden = !items.length;
      idx = -1;
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === 'Enter' && items.length) { choose(items[Math.max(idx, 0)]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li');
      if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    $('.clear', field).addEventListener('click', () => {
      S[which] = null; input.value = ''; syncInputs(); syncPins(); updatePlanBtn(); input.focus();
    });
  }
  wireCombo('from');
  wireCombo('to');

  $('#swap').addEventListener('click', () => {
    [S.from, S.to] = [S.to, S.from];
    syncInputs(); syncPins(); updatePlanBtn();
  });
  $('#walk').addEventListener('input', (e) => { $('#walk-out').textContent = `${e.target.value} m`; });
  $('#reset-btn').addEventListener('click', resetManual);

  function resetManual() {
    S.from = S.to = null;
    syncInputs(); syncPins(); updatePlanBtn();
    G.journey.manual.clearLayers();
    $('#plan-result').innerHTML = '';
    if (S.selectedRoute) selectRoute(S.selectedRoute);
    map.closePopup();
  }

  // ---------------------------------------------------------------- manual mode: planning
  $('#plan-form').addEventListener('submit', (e) => { e.preventDefault(); plan(); });

  async function plan() {
    if (!(S.from && S.to)) return;
    const body = { max_walk_m: +$('#walk').value, fewer_transfers: $('#fewer').checked };
    [['from', 'origin'], ['to', 'destination']].forEach(([w, key]) => {
      const ep = S[w];
      if (ep.type === 'stop') body[`${key}_stop_id`] = ep.id;
      else body[key] = { lat: ep.lat, lon: ep.lon };
    });
    const btn = $('#plan-btn');
    btn.disabled = true; btn.textContent = 'Planning…';
    $('#plan-result').innerHTML = '';
    try {
      const j = await api(EP.journey, { method: 'POST', body });
      renderResult(j);
      drawJourney(j, 'manual');
    } catch (err) {
      $('#plan-result').innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
    } finally {
      btn.textContent = 'Plan trip'; updatePlanBtn();
    }
  }

  function renderResult(j) {
    const s = j.summary;
    const box = $('#plan-result');
    box.innerHTML =
      `<div class="stats"><div><b>${mins(s.total_duration_s)}</b><span>Total time</span></div>` +
      `<div><b>${s.num_buses}</b><span>${s.num_buses === 1 ? 'Bus' : 'Buses'}</span></div>` +
      `<div><b>${s.num_transfers}</b><span>Transfers</span></div>` +
      `<div><b>${dist(s.walking_m)}</b><span>Walking</span></div></div>`;
    const ul = el('ol', 'legs');
    j.legs.forEach((leg) => {
      const li = el('li', `leg ${leg.mode}`);
      if (leg.mode === 'walk') {
        li.innerHTML = '<span class="icon"><svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="2" fill="currentColor"/><path d="M10 21l2-6-2-2 1-5 3 3 3 1M9 11l-3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
          `<div><b>Walk ${dist(leg.distance_m)}</b> to ${esc(leg.end.name || 'your destination')}<div class="sub">about ${mins(leg.duration_s)}</div></div>`;
      } else {
        const b = leg.bus;
        li.style.setProperty('--c', routeColorById(b.route_id, b.route_code));
        li.innerHTML = `<span class="code" style="--c:${routeColorById(b.route_id, b.route_code)}">${esc(b.route_code)}</span>` +
          `<div><b>Bus ${esc(b.route_code)}</b>${b.headsign ? ' toward ' + esc(b.headsign) : ''}` +
          `<div>Board at <b>${esc(b.board_stop.name)}</b></div><div>Get off at <b>${esc(b.alight_stop.name)}</b></div>` +
          `<div class="sub">${b.num_stops} stop${b.num_stops === 1 ? '' : 's'} · about ${mins(leg.duration_s)} incl. ~${mins(b.est_wait_s)} wait</div>` +
          (b.stops_passed.length ? `<details><summary>Stops along the way</summary><ol>${b.stops_passed.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ol></details>` : '') +
          '</div>';
      }
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('details')) return;
        map.fitBounds(leg.points.map((p) => [p.lat, p.lon]), { padding: [60, 60], maxZoom: 16 });
      });
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  // ---------------------------------------------------------------- journey drawing (both modes)
  function pinMarker(p, cls, letter) {
    return L.marker([p.lat, p.lon], {
      icon: L.divIcon({ className: `map-pin ${cls}`, html: `<span><b>${letter}</b></span>`, iconSize: [30, 30], iconAnchor: [15, 36] }),
      interactive: false, keyboard: false,
    });
  }

  function drawJourney(j, mode = S.mode, { fit = true } = {}) {
    const g = G.journey[mode];
    g.clearLayers();
    const interactive = mode === 'manual';
    const all = [];
    j.legs.forEach((leg) => {
      const pts = leg.points.map((p) => [p.lat, p.lon]);
      all.push(...pts);
      if (leg.mode === 'bus') {
        const c = routeColorById(leg.bus.route_id, leg.bus.route_code);
        g.addLayer(L.polyline(pts, { color: '#ffffff', weight: 10, opacity: 0.95, interactive: false }));
        const line = L.polyline(pts, { color: c, weight: 6, opacity: 1, interactive, bubblingMouseEvents: false });
        if (interactive) line.bindTooltip(`Bus ${leg.bus.route_code}: ${leg.bus.board_stop.name} → ${leg.bus.alight_stop.name}`, { sticky: true });
        g.addLayer(line);
        [leg.start, leg.end].forEach((p) => g.addLayer(L.circleMarker([p.lat, p.lon], { radius: 7, color: c, weight: 3, fillColor: '#ffffff', fillOpacity: 1, interactive: false })));
      } else {
        g.addLayer(L.polyline(pts, { color: WALK_COLOR, weight: 4, dashArray: '1 8', lineCap: 'round', interactive: false }));
      }
    });
    if (j.legs.length) {
      g.addLayer(pinMarker(j.legs[0].start, 'a', 'A'));
      g.addLayer(pinMarker(j.legs[j.legs.length - 1].end, 'b', 'B'));
    }
    if (S.mode === mode) { map.addLayer(g); bringJourneyToFront(); }
    if (fit && all.length) map.fitBounds(all, { padding: [60, 60], maxZoom: 16 });
  }

  // ---------------------------------------------------------------- manual mode: routes tab
  function renderRouteList() {
    const q = norm($('#route-filter').value).trim();
    const ul = $('#route-list');
    ul.innerHTML = '';
    S.routes.filter((r) => !q || norm(`${r.code} ${r.name || ''} ${r.operator || ''}`).includes(q)).forEach((r) => {
      const li = el('li', S.selectedRoute === r.id ? 'on' : '',
        `<span class="code" style="--c:${routeColor(r)}">${esc(r.code)}</span>` +
        `<span class="meta"><b>${esc(r.name || 'Route ' + r.code)}</b><small>${r.patterns.length} direction${r.patterns.length === 1 ? '' : 's'}${r.operator ? ' · ' + esc(r.operator) : ''}</small></span>`);
      li.addEventListener('click', () => selectRoute(r.id));
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.innerHTML = '<li class="muted" style="cursor:default;border:0">No routes found.</li>';
  }
  $('#route-filter').addEventListener('input', renderRouteList);

  function selectRoute(id) {
    S.selectedRoute = S.selectedRoute === id ? null : id;
    applyRouteSelection();
    renderRouteList();
    renderRouteDetail();
    const r = S.routeById.get(S.selectedRoute);
    if (r) {
      const pts = r.patterns.flatMap((p) => p.stop_ids.map((sid) => S.stopById.get(sid)).filter(Boolean).map((s) => [s.lat, s.lon]));
      if (pts.length) map.fitBounds(pts, { padding: [50, 50] });
      setTab('routes');
    }
  }

  function renderRouteDetail() {
    const box = $('#route-detail');
    box.innerHTML = '';
    const r = S.routeById.get(S.selectedRoute);
    if (!r) return;
    box.className = 'route-detail';
    r.patterns.forEach((p) => {
      box.appendChild(el('h3', '', `${p.direction === 1 ? 'Inbound' : 'Outbound'}${p.headsign ? ' · toward ' + esc(p.headsign) : ''}`));
      const ol = el('ol');
      p.stop_ids.forEach((sid) => {
        const s = S.stopById.get(sid);
        if (!s) return;
        const li = el('li', '', esc(s.name));
        li.addEventListener('click', () => { map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15), { duration: 0.6 }); openStopPopup(s); });
        ol.appendChild(li);
      });
      box.appendChild(ol);
    });
  }

  function setTab(name) {
    $$('.tabs button').forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#tab-plan').hidden = name !== 'plan';
    $('#tab-routes').hidden = name !== 'routes';
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------------------------------------------------------------- assistant mode: chat
  function renderMd(text) {
    const raw = String(text ?? '');
    if (!window.marked || !window.DOMPurify) return esc(raw).replace(/\n/g, '<br>'); // never inject unsanitised HTML
    return window.DOMPurify.sanitize(window.marked.parse(raw, { gfm: true, breaks: true }));
  }
  if (window.DOMPurify) {
    window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    });
  }

  function scrollChat() { const log = $('#chat-log'); log.scrollTop = log.scrollHeight; }

  function addMessage(role, text, { journeys = [], error = false } = {}) {
    const m = el('article', `msg ${role}${error ? ' error' : ''}`);
    m.appendChild(el('div', 'who', `<span class="avatar">${role === 'user' ? 'U' : 'AI'}</span><span>${role === 'user' ? 'You' : 'Assistant'}</span>`));
    const bubble = el('div', role === 'assistant' ? 'bubble md' : 'bubble');
    if (role === 'assistant') {
      bubble.innerHTML = renderMd(text);
      $$('table', bubble).forEach((t) => { const w = el('div', 'table-wrap'); t.replaceWith(w); w.appendChild(t); });
    } else {
      bubble.textContent = text;
    }
    m.appendChild(bubble);
    if (journeys.length) {
      const row = el('div', 'actions-row');
      const b = el('button', 'show-map', 'Show route on map');
      b.type = 'button';
      b.addEventListener('click', () => drawJourney(journeys[journeys.length - 1], 'assistant'));
      row.appendChild(b);
      m.appendChild(row);
    }
    $('#chat-log').appendChild(m);
    scrollChat();
    return m;
  }

  function showTyping() {
    const m = el('article', 'msg assistant typing');
    m.appendChild(el('div', 'who', '<span class="avatar">AI</span><span>Assistant</span>'));
    m.appendChild(el('div', 'bubble', '<i></i><i></i><i></i>'));
    $('#chat-log').appendChild(m);
    scrollChat();
    return m;
  }

  function setBusy(b) {
    S.chat.busy = b;
    $('#chat-send').disabled = b;
    $('#chat-input').disabled = b;
    if (!b) $('#chat-input').focus();
  }

  async function sendChat(text) {
    text = String(text || '').trim();
    if (!text || S.chat.busy) return;
    $('#chat-suggest').hidden = true;
    addMessage('user', text);
    const typing = showTyping();
    setBusy(true);
    const body = { message: text };
    if (S.chat.sid) body.session_id = S.chat.sid;
    if (S.chat.shareLoc && S.chat.loc) body.location = S.chat.loc;
    try {
      const data = await api(EP.chat, { method: 'POST', body });
      S.chat.sid = data.session_id;
      store.set('sid', S.chat.sid);
      typing.remove();
      const journeys = data.journeys || [];
      addMessage('assistant', data.reply, { journeys });
      if (journeys.length) drawJourney(journeys[journeys.length - 1], 'assistant');
    } catch (err) {
      typing.remove();
      addMessage('assistant', `The assistant could not answer: ${err.message}`, { error: true });
    } finally {
      setBusy(false);
    }
  }

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const t = input.value;
    input.value = ''; input.style.height = 'auto';
    sendChat(t);
  });
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); }
  });
  $('#chat-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
  });

  EXAMPLES.forEach((t) => {
    const b = el('button', '', esc(t));
    b.type = 'button';
    b.addEventListener('click', () => sendChat(t));
    $('#chat-suggest').appendChild(b);
  });

  function resetChatUI() {
    $('#chat-log').innerHTML = '';
    addMessage('assistant', WELCOME);
    $('#chat-suggest').hidden = false;
    G.journey.assistant.clearLayers();
  }

  $('#chat-new').addEventListener('click', () => {
    if (S.chat.sid) api(`${EP.chat}/${encodeURIComponent(S.chat.sid)}`, { method: 'DELETE' }).catch(() => {});
    S.chat.sid = null;
    store.set('sid', null);
    resetChatUI();
  });

  $('#chat-location').addEventListener('click', () => {
    const btn = $('#chat-location');
    if (S.chat.shareLoc) { setShareLoc(false); return; }
    if (!navigator.geolocation) { addMessage('assistant', 'Your browser does not support geolocation.', { error: true }); return; }
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.disabled = false;
      const { latitude: lat, longitude: lon } = pos.coords;
      if (!inSV(lat, lon)) { addMessage('assistant', 'Your location appears to be outside El Salvador, so it was not shared.', { error: true }); return; }
      S.chat.loc = { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
      setShareLoc(true);
      map.flyTo([lat, lon], Math.max(map.getZoom(), 13), { duration: 0.6 });
    }, (err) => { btn.disabled = false; addMessage('assistant', `Could not read your location: ${err.message}`, { error: true }); });
  });
  function setShareLoc(on) {
    S.chat.shareLoc = on;
    const btn = $('#chat-location');
    btn.setAttribute('aria-pressed', on);
    $('span', btn).textContent = on ? 'Sharing my location' : 'Share my location';
    G.me.clearLayers();
    if (on && S.chat.loc) {
      G.me.addLayer(L.marker([S.chat.loc.lat, S.chat.loc.lon], {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false,
      }));
    }
  }

  async function restoreHistory() {
    resetChatUI();
    if (!S.chat.sid) return;
    try {
      const data = await api(`${EP.chat}/${encodeURIComponent(S.chat.sid)}`);
      if (!data.messages?.length) return;
      $('#chat-suggest').hidden = true;
      data.messages.forEach((m) => addMessage(m.role === 'user' ? 'user' : 'assistant', m.content));
    } catch {
      S.chat.sid = null; store.set('sid', null); // expired or assistant down: start fresh
    }
  }

  // ---------------------------------------------------------------- modes
  const COPY = {
    manual: {
      tag: 'Manual mode', title: 'Plan a trip',
      sub: 'Choose a start and a destination on the map or by searching, then calculate the route.',
      ribbon: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="2"/></svg><span><b>Manual mode</b> · click a stop or any point on the map</span>',
    },
    assistant: {
      tag: 'Assistant mode', title: 'Ask the assistant',
      sub: 'Describe your trip in your own words. The map is read-only here: all interaction happens in the chat.',
      ribbon: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg><span><b>Assistant mode</b> · read-only map, use the chat to plan your trip</span>',
    },
  };

  function updateRibbon() {
    const r = $('#map-ribbon');
    r.innerHTML = COPY[S.mode].ribbon;
    r.hidden = S.mode === 'manual' && S.hintDismissed;
  }

  function setMode(mode) {
    S.mode = mode;
    store.set('mode', mode);
    document.body.dataset.mode = mode;
    $$('.mode-switch [role="tab"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === mode));
    $('#view-manual').hidden = mode !== 'manual';
    $('#view-assistant').hidden = mode !== 'assistant';
    $('#mode-tag').textContent = COPY[mode].tag;
    $('#panel-title').textContent = COPY[mode].title;
    $('#panel-sub').textContent = COPY[mode].sub;
    updateRibbon();
    map.closePopup();

    if (mode === 'assistant') S.selectedRoute = null;
    ['manual', 'assistant'].forEach((m) => (m === mode ? map.addLayer(G.journey[m]) : map.removeLayer(G.journey[m])));
    mode === 'manual' ? map.addLayer(G.pins) : map.removeLayer(G.pins);
    if (S.stops.length) renderNetwork(); // rebuilt so stops are clickable (manual) or inert (assistant)
    renderRouteList();
    renderRouteDetail();
    if (mode === 'assistant') $('#chat-input').focus();
  }
  $$('.mode-switch [role="tab"]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ---------------------------------------------------------------- health
  /*
  async function checkHealth() {
    const set = (sel, ok) => { const p = $(sel); p.classList.toggle('ok', !!ok); p.classList.toggle('down', !ok); };
    try {
      const h = await api(EP.health);
      set('#status-routes', h.routes); set('#status-assistant', h.assistant);
    } catch { set('#status-routes', false); set('#status-assistant', false); }
  }
  */

  // ---------------------------------------------------------------- init
  setMode(store.get('mode') === 'assistant' ? 'assistant' : 'manual');
  syncInputs(); updatePlanBtn();
  loadNetwork();
  restoreHistory();
  // checkHealth();
  // setInterval(checkHealth, 30000);

  window.Busgraphi = { S, map, G, setMode, loadNetwork, setEndpoint, plan, sendChat, drawJourney, renderMd, selectRoute };
})();
