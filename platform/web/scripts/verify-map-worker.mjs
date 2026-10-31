import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const assets = new URL(`../${process.argv[2] === 'dist-android' ? 'dist-android' : 'dist'}/assets/`, import.meta.url);
const files = await readdir(assets);
const workers = files.filter(name => /^maplibre-gl-worker-.*\.js$/.test(name));
assert.equal(workers.length, 1, 'Build must emit the self-contained MapLibre worker');
const worker = workers[0];
assert.ok((await stat(new URL(worker, assets))).size > 100000, 'Map worker must include its shared dependencies');
const bundles = await Promise.all(files.filter(name => name.endsWith('.js') && name !== worker).map(name => readFile(new URL(name, assets), 'utf8')));
assert.ok(bundles.some(code => code.includes(worker)), 'Application must reference the emitted worker URL');
const workerCode = await readFile(new URL(worker, assets), 'utf8');
assert.ok(!workerCode.includes('./maplibre-gl-shared.mjs'), 'Worker must not depend on an unshipped sibling module');
console.log(`MapLibre production worker verified: ${worker}`);
