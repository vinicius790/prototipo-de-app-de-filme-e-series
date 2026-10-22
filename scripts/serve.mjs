// Servidor estático mínimo para a versão web-vanilla, sem dependências.
// Módulos ES não carregam por file://, então a página precisa ser servida por HTTP.
//
// Uso: npm start            (porta 8080)
//      PORT=3000 npm start

import { copyFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../web-vanilla', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Converte o caminho da URL num arquivo dentro de `root`.
 * Devolve `null` para qualquer tentativa de sair da pasta servida.
 */
export function resolveFile(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) {
    return null;
  }
  const base = resolve(root);
  const file = resolve(base, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  return file.startsWith(base + sep) ? file : null;
}

/** Cria `config.js` a partir do modelo para a página não pedir um arquivo inexistente. */
export function ensureConfig(root) {
  const config = join(root, 'config.js');
  if (existsSync(config)) {
    return false;
  }
  copyFileSync(join(root, 'config.example.js'), config);
  return true;
}

async function handle(request, response) {
  const file = request.method === 'GET' || request.method === 'HEAD' ? resolveFile(ROOT, request.url) : null;
  try {
    if (!file) {
      throw new Error('fora da pasta servida');
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Não encontrado');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (ensureConfig(ROOT)) {
    console.log('Criado web-vanilla/config.js a partir de config.example.js (o git ignora esse arquivo).');
  }
  const port = Number(process.env.PORT) || 8080;
  const server = createServer(handle);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`A porta ${port} já está em uso. Escolha outra com a variável PORT.`);
    } else {
      console.error(`Não foi possível iniciar o servidor: ${error.message}`);
    }
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Movie App (web-vanilla) em http://localhost:${port}/  —  Ctrl+C para parar`);
  });
}
