import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { ensureConfig, resolveFile } from '../scripts/serve.mjs';

const ROOT = resolve('pasta', 'servida');

test('resolveFile entrega arquivos de dentro da pasta', () => {
  assert.equal(resolveFile(ROOT, '/'), join(ROOT, 'index.html'));
  assert.equal(resolveFile(ROOT, '/js/app.js?v=1'), join(ROOT, 'js', 'app.js'));
  assert.equal(resolveFile(ROOT, '/style.css'), join(ROOT, 'style.css'));
});

test('resolveFile bloqueia tentativas de sair da pasta', () => {
  for (const url of ['/..%2f..%2fsegredo.txt', '/%2e%2e%5c%2e%2e%5csegredo.txt', '/js/..%2f..%2f..%2fsegredo', '/%00', '/%E0%A4%A']) {
    assert.equal(resolveFile(ROOT, url), null, url);
  }
  // O próprio parser de URL já normaliza "/../", então o resultado continua dentro da pasta.
  assert.equal(resolveFile(ROOT, '/../../segredo.txt'), join(ROOT, 'segredo.txt'));
});

test('ensureConfig cria config.js a partir do modelo sem sobrescrever o existente', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'movie-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'config.example.js'), 'export default { apiKey: "" };\n');

  assert.equal(ensureConfig(dir), true);
  assert.equal(readFileSync(join(dir, 'config.js'), 'utf8'), 'export default { apiKey: "" };\n');

  writeFileSync(join(dir, 'config.js'), 'export default { apiKey: "minha" };\n');
  assert.equal(ensureConfig(dir), false);
  assert.equal(readFileSync(join(dir, 'config.js'), 'utf8'), 'export default { apiKey: "minha" };\n');
});
