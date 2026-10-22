// Depois do `ng build` (script `postbuild`): escreve no sw.js do build a lista de arquivos gerados,
// com hash no nome, para o service worker guardar tudo na instalação, inclusive os blocos das
// rotas carregadas sob demanda. Assim qualquer tela abre offline desde a primeira visita.
//
// Uso: node scripts/precache.mjs [pasta do build]   (padrão: dist/angular/browser)

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ponto do sw.js que recebe a lista (ver public/sw.js). */
export const MARKER = 'const PRECACHE = [];';

// index.html é guardado à parte ('./'); config.json tem a chave de cada pessoa e é lido pela rede.
const SKIPPED = new Set(['sw.js', 'index.html', 'config.json', 'config.example.json']);

/** Arquivos do build, com caminho relativo e barras normais, em ordem estável. */
export function buildFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (!entry.name.endsWith('.map')) {
        files.push(relative(dir, path).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return files.filter((file) => !SKIPPED.has(file)).sort();
}

/** Escreve a lista no sw.js de `dir` e a devolve. */
export function injectPrecache(dir) {
  const worker = join(dir, 'sw.js');
  const source = readFileSync(worker, 'utf8');
  if (!source.includes(MARKER)) {
    throw new Error(`${worker} não tem "${MARKER}": a lista já foi escrita ou o arquivo mudou.`);
  }
  const files = buildFiles(dir);
  writeFileSync(worker, source.replace(MARKER, `const PRECACHE = ${JSON.stringify(files)};`));
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(
    process.argv[2] ?? fileURLToPath(new URL('../dist/angular/browser', import.meta.url)),
  );
  try {
    const files = injectPrecache(dir);
    console.log(`sw.js: ${files.length} arquivos do build entram no cache offline.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
