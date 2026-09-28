// Carrega os módulos puros de src/ no Node (sem DOM) para testes rápidos.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

export function loadModules(upTo = '99', expose = []) {
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.js') && f.slice(0, 2) <= upTo).sort();
  const code = files.map((f) => readFileSync(join(srcDir, f), 'utf8')).join('\n');
  const ctx = {
    console, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, crypto: globalThis.crypto,
    DecompressionStream, CompressionStream, Blob, atob, btoa, navigator: { onLine: true },
    localStorage: undefined, indexedDB: undefined,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`(function(){\n${code}\n;globalThis.__T = {${expose.join(',')}};\n})();`, ctx, { filename: 'bundle.js' });
  return ctx.__T;
}
