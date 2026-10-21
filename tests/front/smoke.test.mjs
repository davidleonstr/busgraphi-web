// Front-end smoke test: real Blade markup + real marked/DOMPurify, stubbed Leaflet and mocked APIs.
//   cd tests/front && npm install && npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.PROJECT || path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8');

// ---- render the Blade view without Laravel
const CFG = {
  map: { center: [13.75, -88.9], zoom: 9, tile_url: 'http://t/{z}/{x}/{y}.png', attribution: 'x' },
  endpoints: { network: '/bus-api/network', journey: '/bus-api/journey', health: '/bus-api/health', chat: '/bus-api/chat' },
};
let html = read(path.join(ROOT, 'resources/views/busgraphi.blade.php'))
  .replace(/\{\{--[\s\S]*?--\}\}/g, '')
  .replace(/\{\{ \$brand \}\}/g, 'Busgraphi')
  .replace(/\{\{ csrf_token\(\) \}\}/g, 'tok123')
  .replace(/\{\{ asset\('([^']+)'\) \}\}/g, '/$1')
  .replace(/@json\(\$cfg, JSON_UNESCAPED_SLASHES \| JSON_HEX_TAG\)/, JSON.stringify(CFG))
  .replace(/<script src="[^"]+"><\/script>/g, '')
  .replace(/<link[^>]+>/g, '');
assert(!html.includes('{{') && !html.includes('@json'), 'unrendered blade syntax left');

const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

// ---- minimal Leaflet stub that records what the app draws
class Layer {
  constructor(kind, o = {}) { this.kind = kind; this.options = o; this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  once(ev, fn) { return this.on(ev, fn); }
  bindTooltip() { this.tip = true; return this; }
  openTooltip() { return this; }
  setStyle(s) { Object.assign(this.options, s); return this; }
  setRadius(r) { this.options.radius = r; return this; }
  bringToFront() { this.front = true; return this; }
  setLatLng(ll) { this.ll = ll; return this; }
  setContent(c) { this.content = c; return this; }
  openOn(m) { m.openPopup = this; return this; }
}
class Group {
  constructor() { this.layers = []; }
  addLayer(l) { this.layers.push(l); return this; }
  clearLayers() { this.layers = []; return this; }
  eachLayer(fn) { this.layers.forEach(fn); }
  addTo(m) { m.groups.add(this); return this; }
}
const mapStub = {
  groups: new Set(), handlers: {}, openPopup: null, fit: null, zoom: 9,
  setView() { return this; }, fitBounds(b) { this.fit = b; }, flyTo() {}, closePopup() { this.openPopup = null; },
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; },
  addLayer(g) { this.groups.add(g); }, removeLayer(g) { this.groups.delete(g); }, getZoom() { return this.zoom; },
};
window.L = {
  map: () => mapStub,
  control: { zoom: () => ({ addTo() {} }) },
  tileLayer: () => ({ addTo() {} }),
  layerGroup: () => new Group(),
  circleMarker: (ll, o) => new Layer('circle', o),
  polyline: (pts, o) => new Layer('line', o),
  marker: (ll, o) => new Layer('marker', o),
  divIcon: (o) => o,
  popup: (o) => new Layer('popup', o),
};

// real Markdown + sanitiser
window.eval(read(require.resolve('marked/marked.min.js')));
window.eval(read(require.resolve('dompurify/dist/purify.min.js')));
assert(window.marked && window.DOMPurify, 'marked / DOMPurify did not load');

// ---- mocked backend
const NETWORK = {
  stops: [
    { id: 1, name: 'Palo Alto', lat: 13.98, lon: -89.56, municipality: 'Santa Ana' },
    { id: 2, name: 'Terminal Santa Ana', lat: 13.99, lon: -89.55, municipality: 'Santa Ana' },
    { id: 3, name: 'Chalchuapa Centro', lat: 13.98, lon: -89.68, municipality: 'Chalchuapa' },
    { id: 4, name: 'Metrocentro', lat: 13.70, lon: -89.21, municipality: 'San Salvador' },
  ],
  routes: [
    { id: 7, code: '210', name: 'Santa Ana - Chalchuapa', operator: '', colour: null, patterns: [{ id: 1, direction: 0, headsign: 'Santa Ana', stop_ids: [1, 2, 3] }] },
    { id: 8, code: '44', name: null, operator: '', colour: '#aa3300', patterns: [{ id: 2, direction: 0, headsign: null, stop_ids: [3, 4] }] },
  ],
};
const JOURNEY = {
  summary: { total_duration_s: 1500, walking_m: 120, num_buses: 1, num_transfers: 0 },
  legs: [
    { mode: 'walk', instruction: 'x', start: { lat: 13.97, lon: -89.57, name: null }, end: { lat: 13.98, lon: -89.56, name: 'Palo Alto', stop_id: 1 }, duration_s: 100, distance_m: 120, points: [{ lat: 13.97, lon: -89.57 }, { lat: 13.98, lon: -89.56, name: 'Palo Alto' }], bus: null },
    { mode: 'bus', instruction: 'x', start: { lat: 13.98, lon: -89.56, name: 'Palo Alto', stop_id: 1 }, end: { lat: 13.98, lon: -89.68, name: 'Chalchuapa Centro', stop_id: 3 }, duration_s: 1400, distance_m: 9000,
      points: [{ lat: 13.98, lon: -89.56, name: 'Palo Alto' }, { lat: 13.99, lon: -89.55, name: 'Terminal Santa Ana' }, { lat: 13.98, lon: -89.68, name: 'Chalchuapa Centro' }],
      bus: { route_id: 7, route_code: '210', route_name: null, headsign: 'Santa Ana', board_stop: { name: 'Palo Alto', stop_id: 1 }, alight_stop: { name: 'Chalchuapa Centro', stop_id: 3 }, stops_passed: [{ name: 'Terminal Santa Ana' }], num_stops: 2, est_wait_s: 420 } },
  ],
  geojson: {},
};
const MD_REPLY = '**Take bus 210** at Palo Alto:\n\n1. Board at *Palo Alto*\n2. Get off at Chalchuapa Centro\n\n[more info](https://example.com)\n\n<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">\n\n| a | b |\n|---|---|\n| 1 | 2 |';

const calls = [];
let chatFails = false;
window.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body });
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (url === '/bus-api/network') return reply(200, NETWORK);
  if (url === '/bus-api/health') return reply(200, { routes: true, assistant: false });
  if (url === '/bus-api/journey') return reply(200, JOURNEY);
  if (url === '/bus-api/chat' && opts.method === 'POST') {
    if (chatFails) return reply(503, { message: 'Assistant API is unreachable.' });
    return reply(200, { session_id: 'sess12345', reply: MD_REPLY, journeys: [JOURNEY], tool_calls: [] });
  }
  return reply(404, { message: 'not found' });
};
window.navigator.geolocation = { getCurrentPosition: (ok) => ok({ coords: { latitude: 13.7, longitude: -89.2 } }) };

// ---- run the app
window.BUSGRAPHI = CFG;
window.eval(read(path.join(ROOT, 'public/js/busgraphi.js')));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
await tick(80);
const B = window.Busgraphi;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const click = (e) => e.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const submit = (f) => f.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
let n = 0;
const ok = (name) => console.log(`  ok ${++n} - ${name}`);

// 1. manual mode: everything visible and interactive
assert.equal(document.body.dataset.mode, 'manual');
assert.equal(B.S.stopMarkers.size, 4); assert.equal(B.S.lineLayers.length, 2);
assert([...B.S.stopMarkers.values()].every((m) => m.options.interactive === true && m.handlers.click));
assert($('#view-assistant').hidden && !$('#view-manual').hidden);
assert.equal($('#mode-tag').textContent, 'Manual mode');
assert(calls.find((c) => c.url === '/bus-api/network').headers['X-CSRF-TOKEN'] === 'tok123');
ok('manual mode loads the network; all stops and routes interactive');

// 2. autocomplete + manual selection through popups
const fromInput = $('#from-input');
fromInput.value = 'palo'; fromInput.dispatchEvent(new window.Event('input'));
assert.equal($$('[data-field="from"] .suggest li').length, 1);
$('[data-field="from"] .suggest li').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
assert.equal(B.S.from.id, 1); assert.equal(fromInput.value, 'Palo Alto');
B.S.stopMarkers.get(3).handlers.click[0]();                  // click stop 3 on the map
click(mapStub.openPopup.content.querySelector('[data-act="to"]'));
assert.equal(B.S.to.id, 3); assert.equal($('#plan-btn').disabled, false);
assert(!$('#map-ribbon').hidden === false, 'hint ribbon hidden after first selection');
ok('search + clicking a stop sets origin/destination; plan button enabled');

// 3. map click on an arbitrary point (and outside El Salvador)
mapStub.handlers.click[0]({ latlng: { lat: 13.8, lng: -89.1 } });
assert(mapStub.openPopup.content.querySelector('[data-act="from"]'));
mapStub.handlers.click[0]({ latlng: { lat: 40.7, lng: -74 } });
assert(!mapStub.openPopup.content.querySelector('[data-act="from"]'));
ok('map click offers From/To inside El Salvador and refuses outside');

// 4. plan the trip
submit($('#plan-form')); await tick(50);
const jc = calls.find((c) => c.url === '/bus-api/journey');
assert.deepEqual([jc.body.origin_stop_id, jc.body.destination_stop_id, jc.body.max_walk_m], [1, 3, 800]);
assert.equal($$('#plan-result .leg').length, 2);
assert($('#plan-result .stats').textContent.includes('25 min'));
assert(B.G.journey.manual.layers.length > 0 && B.G.journey.manual.layers.some((l) => l.front));
ok('planning posts the stop ids and renders summary, legs and the route on the map');

// 5. routes tab
click($$('.tabs button')[1]);
assert(!$('#tab-routes').hidden && $('#tab-plan').hidden);
assert.equal($$('#route-list li').length, 2);
click($$('#route-list li')[0]);
assert.equal(B.S.selectedRoute, 7);
assert.equal(B.S.lineLayers.find((l) => l.routeId === 7).layer.options.weight, 5);
assert.equal(B.S.lineLayers.find((l) => l.routeId === 8).layer.options.opacity, 0.1);
assert.equal($$('#route-detail li').length, 3);
ok('routes tab highlights a route and lists its ordered stops');

// 6. assistant mode: stops stay visible but are NOT interactive
click($('.mode-switch [data-mode="assistant"]'));
assert.equal(document.body.dataset.mode, 'assistant');
assert(!$('#view-assistant').hidden && $('#view-manual').hidden);
assert.equal($('#mode-tag').textContent, 'Assistant mode');
assert.equal(B.S.stopMarkers.size, 4); assert.equal(B.S.lineLayers.length, 2);
assert(mapStub.groups.has(B.G.stops) && mapStub.groups.has(B.G.routes), 'stops and routes still on the map');
assert([...B.S.stopMarkers.values()].every((m) => m.options.interactive === false && !m.handlers.click && !m.tip));
assert(B.S.lineLayers.every((l) => l.layer.options.interactive === false && !l.layer.handlers.click));
assert.equal(B.S.selectedRoute, null);
mapStub.openPopup = null; mapStub.handlers.click[0]({ latlng: { lat: 13.8, lng: -89.1 } });
assert.equal(mapStub.openPopup, null, 'map clicks do nothing in assistant mode');
assert(!mapStub.groups.has(B.G.pins) && !mapStub.groups.has(B.G.journey.manual) && mapStub.groups.has(B.G.journey.assistant));
assert($('#map-ribbon').textContent.includes('read-only'));
ok('assistant mode: all stops visible but inert; map clicks ignored; manual layers hidden');

// 7. chat: Markdown, sanitising, journey drawn, CSRF, session id
assert($$('#chat-log .msg.assistant').length === 1, 'welcome message');
$('#chat-input').value = 'How do I get from <b>Palo Alto</b> to Chalchuapa?';
submit($('#chat-form')); await tick(60);
const c1 = calls.filter((c) => c.url === '/bus-api/chat' && c.method === 'POST')[0];
assert.equal(c1.headers['X-CSRF-TOKEN'], 'tok123'); assert.equal(c1.body.session_id, undefined);
const user = $('#chat-log .msg.user .bubble'); const bot = $$('#chat-log .msg.assistant .bubble').pop();
assert.equal(user.textContent, 'How do I get from <b>Palo Alto</b> to Chalchuapa?'); assert.equal(user.querySelector('b'), null);
assert(bot.querySelector('strong') && bot.querySelector('ol li') && bot.querySelector('.table-wrap table'));
assert(!bot.querySelector('script') && !bot.querySelector('img[onerror]') && !bot.innerHTML.includes('onerror') && !window.__pwned);
const a = bot.querySelector('a'); assert.equal(a.getAttribute('rel'), 'noopener noreferrer'); assert.equal(a.getAttribute('target'), '_blank');
assert($('#chat-log .msg.user .avatar').textContent !== $('#chat-log .msg.assistant .avatar').textContent);
assert(B.G.journey.assistant.layers.length > 0);
assert([...B.S.stopMarkers.values()].every((m) => m.options.interactive === false));
assert($('#chat-log .show-map'));
ok('chat renders Markdown safely, distinguishes You/AI, draws the journey, sends CSRF token');

// 8. follow-up reuses the session and shares the location
click($('#chat-location')); assert.equal(B.S.chat.shareLoc, true);
$('#chat-input').value = 'And from where I get off, how can I reach Metrocentro?';
submit($('#chat-form')); await tick(60);
const c2 = calls.filter((c) => c.url === '/bus-api/chat' && c.method === 'POST')[1];
assert.equal(c2.body.session_id, 'sess12345'); assert.deepEqual(c2.body.location, { lat: 13.7, lon: -89.2 });
assert.equal(window.localStorage.getItem('busgraphi.sid'), 'sess12345');
ok('follow-up reuses the session id and optional location');

// 9. errors from the assistant show up as an error bubble
chatFails = true;
$('#chat-input').value = 'hola'; submit($('#chat-form')); await tick(60);
assert($$('#chat-log .msg.error .bubble').pop().textContent.includes('unreachable'));
ok('assistant failure is shown as an error message');

// 10. back to manual: interactive again, planned trip kept
chatFails = false;
click($('.mode-switch [data-mode="manual"]'));
assert([...B.S.stopMarkers.values()].every((m) => m.options.interactive === true && m.handlers.click));
assert(mapStub.groups.has(B.G.journey.manual) && !mapStub.groups.has(B.G.journey.assistant) && mapStub.groups.has(B.G.pins));
assert.equal($$('#plan-result .leg').length, 2);
ok('switching back to manual restores interactivity and the manual trip');

// 11. new conversation clears session
click($('#chat-new')); await tick(30);
assert.equal(window.localStorage.getItem('busgraphi.sid'), null);
assert(calls.some((c) => c.method === 'DELETE' && c.url === '/bus-api/chat/sess12345'));
ok('new conversation deletes the session');

console.log(`\nAll ${n} front-end checks passed`);
process.exit(0);
