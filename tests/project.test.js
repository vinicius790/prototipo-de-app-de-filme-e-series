// Regras do repositório inteiro: nenhuma chave no código, nenhum HTML montado com dado externo,
// nenhum acento corrompido. São regressões dos problemas que a primeira versão tinha.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.angular', 'coverage']);
const SKIPPED_FILES = new Set(['package-lock.json']);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.html', '.css', '.json', '.md', '.yml', '.txt', '']);

function textFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        files.push(...textFiles(path));
      }
    } else if (TEXT_EXTENSIONS.has(extname(entry.name)) && !SKIPPED_FILES.has(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

// Os arquivos de configuração reais existem só na máquina de quem roda o app e o git os ignora.
const LOCAL_CONFIG = new Set(['web-vanilla/config.js', 'angular/public/config.json']);

const files = textFiles(ROOT)
  .map((path) => ({ path, name: relative(ROOT, path).split(sep).join('/') }))
  .filter((file) => !LOCAL_CONFIG.has(file.name))
  .map((file) => ({ name: file.name, content: readFileSync(file.path, 'utf8') }));

const offenders = (predicate) => files.filter(predicate).map((file) => file.name);

test('nenhuma chave do TMDB está escrita no repositório', () => {
  // Chave v3: 32 hexadecimais seguidos. Token v4: JWT atribuído a apiKey/api_key.
  const v3Key = /\b[a-f0-9]{32}\b/i;
  const assignedSecret = /api_?key['"]?\s*[:=]\s*['"][\w.-]{20,}['"]/i;
  assert.deepEqual(
    offenders((file) => v3Key.test(file.content) || assignedSecret.test(file.content)),
    [],
  );
});

test('o arquivo de configuração real fica fora do git', () => {
  const gitignore = files.find((file) => file.name === '.gitignore').content.split(/\r?\n/);
  for (const ignored of [
    'web-vanilla/config.js',
    'angular/public/config.json',
    'node_modules/',
    'BACKUP_ORIGINAL_antes_de_organizar.zip',
    'LOG_REORGANIZACAO.txt',
  ]) {
    assert.ok(gitignore.includes(ignored), `.gitignore precisa conter ${ignored}`);
  }
  assert.equal(
    files.some((file) => file.name === 'web-vanilla/config.example.js'),
    true,
  );
});

test('o código da versão vanilla não monta HTML a partir de texto', () => {
  const htmlSinks = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
  assert.deepEqual(
    offenders((file) => file.name.startsWith('web-vanilla/') && htmlSinks.test(file.content)),
    [],
  );
});

test('não há manipuladores de evento inline nem sintaxe de template colada por engano', () => {
  const junk = /math-inline|\son(click|submit|change|load|error)\s*=\s*["']/i;
  assert.deepEqual(
    offenders(
      (file) =>
        /^(web-vanilla|angular\/src)\//.test(file.name) &&
        // Os testes do Angular usam textos hostis de propósito, como dado de entrada.
        !file.name.endsWith('.spec.ts') &&
        junk.test(file.content),
    ),
    [],
  );
});

test('arquivos estão em UTF-8 sem BOM e sem acentos corrompidos', () => {
  // A-til ou A-circunflexo seguidos de um byte de continuação: sinal clássico de UTF-8 lido como Latin-1.
  const char = String.fromCodePoint;
  const mojibake = new RegExp(`[${char(0xc3)}${char(0xc2)}][${char(0x80)}-${char(0xbf)}]|${char(0xfffd)}`);
  assert.deepEqual(
    offenders((file) => file.content.codePointAt(0) === 0xfeff || mojibake.test(file.content)),
    [],
  );
});

test('a página declara idioma, viewport e não depende de CDN', () => {
  const html = files.find((file) => file.name === 'web-vanilla/index.html').content;
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<script type="module" src="js\/app\.js">/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/);
  assert.doesNotMatch(html, /href="#"/);
});
