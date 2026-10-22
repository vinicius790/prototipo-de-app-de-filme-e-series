#!/usr/bin/env sh
# Inicia localmente a versao vanilla do prototipo de app de filmes e series com 1 clique.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
PORTA="${PORTA:-8080}"
URL="http://localhost:$PORTA/"
VANILLA_DIR="$DIR/web-vanilla"

# Garante a existência de config.js
if [ ! -f "$VANILLA_DIR/config.js" ] && [ -f "$VANILLA_DIR/config.example.js" ]; then
  cp "$VANILLA_DIR/config.example.js" "$VANILLA_DIR/config.js"
  echo "==> Criado config.js a partir de config.example.js"
fi

echo "==> Iniciando Movie App (Vanilla Web) em: $URL"
echo "==> Pressione Ctrl+C para encerrar o servidor."

# Tenta abrir o navegador em segundo plano se disponível
if [ -z "${NO_BROWSER:-}" ]; then
  if command -v xdg-open >/dev/null 2>&1; then
    (sleep 1 && xdg-open "$URL") >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    (sleep 1 && open "$URL") >/dev/null 2>&1 &
  fi
fi

# 1. Tenta Python http.server
for py in python3 python py; do
  if command -v "$py" >/dev/null 2>&1; then
    if "$py" -c "import http.server" >/dev/null 2>&1; then
      echo "==> Servidor: Python ($py) http.server"
      exec "$py" -m http.server "$PORTA" --directory "$VANILLA_DIR"
    fi
  fi
done

# 2. Tenta npx serve
if command -v npx >/dev/null 2>&1; then
  echo "==> Servidor: npx serve"
  exec npx serve "$VANILLA_DIR" -l "$PORTA"
fi

# 3. Fallback: script Node.js dedicado do repositório
if command -v node >/dev/null 2>&1 && [ -f "$DIR/scripts/serve.mjs" ]; then
  echo "==> Servidor: Node.js (scripts/serve.mjs)"
  PORT="$PORTA" exec node "$DIR/scripts/serve.mjs"
fi

echo "Erro: Nenhum servidor disponível. Instale Python 3 ou Node.js (npx)." >&2
exit 1
