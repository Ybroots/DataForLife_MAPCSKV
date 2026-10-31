import assert from 'node:assert/strict';
const base = 'https://bandosocskv.com/api';
async function get(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(25_000), redirect: 'error' });
  assert(response.ok, `Read-only API check failed (${response.status}) at ${path}`);
  return response.json();
}
const [health, overview, units, hotlines] = await Promise.all([get('/health'), get('/v1/areas/overview'), get('/v1/directory/units'), get('/v1/hotlines')]);
assert.equal(health.dataSource, 'postgres', 'Production must not use fixture data');
const features = overview.data.features;
assert.equal(features.length, 124);
assert.equal(features.filter(feature => feature.geometry?.coordinates?.length).length, 124);
let next = 0;
let contacts = units.data.length;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < features.length) {
    const feature = features[next++];
    const area = (await get(`/v1/lookup/by-code/${encodeURIComponent(feature.properties.code)}`)).data;
    assert.equal(area.code, feature.properties.code);
    assert(area.boundary?.coordinates?.length, 'Missing canonical boundary');
    contacts += area.directory.length;
  }
}));
assert.equal(contacts, 296);
assert.equal(hotlines.data.length, 34);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: health.dataSource, areas: features.length, boundaries: features.length, contacts, hotlines: hotlines.data.length, method: 'read-only GET; no sessions or incidents created' }));
