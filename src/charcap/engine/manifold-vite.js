// Browser-only entry for the boolean backend: Vite resolves the WASM asset URL at build time and
// hashes it into dist/assets. Import THIS from UI code (src/charcap/main.js); Node code (selftest)
// imports './csg.js' directly because the `?url` suffix is Vite syntax.
//
//   import { initBooleansForVite } from './engine/manifold-vite.js';
//   await initBooleansForVite();

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initBooleans } from './csg.js';

export function initBooleansForVite() {
  return initBooleans({ wasmUrl });
}

export { wasmUrl };
