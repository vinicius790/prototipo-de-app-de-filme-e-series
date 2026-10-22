// Cria public/config.json a partir do modelo, se ainda não existir.
// O arquivo real guarda a chave do TMDB e é ignorado pelo git.

import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const example = fileURLToPath(new URL('../public/config.example.json', import.meta.url));
const config = fileURLToPath(new URL('../public/config.json', import.meta.url));

if (!existsSync(config)) {
  copyFileSync(example, config);
  console.log('Criado public/config.json. Preencha "apiKey" com a sua chave do TMDB.');
}
