import { setWorkerUrl } from 'maplibre-gl';
// TypeScript 7 resolves this package subpath differently between the app and
// test projects; Vite validates and bundles the worker URL in the build step.
// @ts-ignore Vite worker resource query; covered by verify-map-worker.mjs.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre 6 loads its worker separately. Let Vite bundle the worker AND its
// shared imports; the default sibling URL only works in unbundled ESM.
// https://maplibre.org/maplibre-gl-js/docs/#vite
setWorkerUrl(workerUrl);

export * from 'maplibre-gl';
