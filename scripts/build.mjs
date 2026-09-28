// Build do OPS 360° IA: concatena os módulos de src/ (em ordem alfabética)
// dentro de um único IIFE e grava dist/ops360-ia.js.
//   node scripts/build.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const files = readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();

// nomes de nível superior repetidos entre módulos se sobrescrevem no IIFE: falha o build
const seen = new Map();
for (const f of files) {
  const code = readFileSync(join(srcDir, f), 'utf8');
  for (const m of code.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:const|let|class)\s+([A-Za-z0-9_$]+)/gm)) {
    const name = m[1] || m[2];
    if (seen.has(name)) {
      console.error(`Nome duplicado "${name}" em ${seen.get(name)} e ${f}`);
      process.exit(1);
    }
    seen.set(name, f);
  }
}
const header = readFileSync(join(srcDir, '_header.txt'), 'utf8');
const parts = files.map((f) => `\n/* ===== ${f} ===== */\n` + readFileSync(join(srcDir, f), 'utf8'));
const out = `${header}\n(function () {\n'use strict';\n${parts.join('\n')}\n})();\n`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'ops360-ia.js'), out);
console.log(`dist/ops360-ia.js  ${(out.length / 1024).toFixed(1)} KB  (${files.length} módulos)`);
