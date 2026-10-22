# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [1.3.0] - 2026-10-16

### Adicionado

- **Contador e métricas de tempo assistido (`#/tempo-assistido`)**: acompanhamento de minutos e dias totais
  assistidos, contagem de filmes e séries, estimativas inteligentes para séries sem minutagem expressa,
  gráfico de barras horizontais com distribuição por gênero, identificação do título mais longo assistido,
  histórico reversível em 1 clique e botão "Marcar como assistido" / "Assistido ✓" na página de detalhes.
- **Modo Cinema (`🎬 Modo Cinema`)**: experiência imersiva de alta definição para trailers e backdrops,
  escurecendo a interface com backdrop de 96% de opacidade, com controles de foco imediatos e saída rápida
  pela tecla `Esc` ou botão dedicado.
- **Algoritmo de afinidade de gênero e notas**: cálculo percentual de afinidade (`calculateAffinityScore`),
  exibindo badges informativas (50% a 99%) nos cartões e detalhes baseadas no perfil de gosto do usuário.
- **Exportação e restauração completa em JSON**: suporte a exportação e importação de favoritos, listas,
  avaliações e tempo assistido em arquivo `.json` estruturado com validação de esquema estrita.
- **Progressive Web App (PWA)**: manifesto completo (`manifest.json`) com ícones maskable, atalhos de sistema,
  meta tags mobile otimizadas e captura do evento de instalação (`beforeinstallprompt`).
- **Documentação de Arquitetura**: criação do `ARCHITECTURE.md` com especificações técnicas e múltiplos
  diagramas Mermaid cobrindo fluxos C4, ciclo de vida do Modo Cinema, PWA e algoritmo de afinidade.
- Suíte expandida para 188 testes automatizados no Node.js test runner nativo.

## [1.2.0] - 2026-10-03

### Adicionado

- Recomendações: favoritos e avaliações gravados antes da 1.1, sem gênero, são completados com os
  detalhes do TMDB ao abrir "Para você" (uma vez por título, até 40 por visita, 4 de cada vez).
  `genreIds` ausente = "ainda não se sabe"; `[]` = "conferido, sem gênero", que não é buscado de
  novo. Migração única (`movie-app:generos-v2`) converte os `[]` gravados até a 1.2.
- Link de lista comprimido (`z` + deflate-raw em base64url), muito mais curto para listas grandes;
  links no formato da 1.1 continuam válidos. Limite de 256 KB para o conteúdo descomprimido.
- Angular: `scripts/precache.mjs` (rodado pelo `postbuild`) escreve no `sw.js` do build a lista de
  todos os arquivos gerados; telas carregadas sob demanda abrem offline desde a primeira visita, e
  os arquivos de builds anteriores saem do cache na ativação. Sem a lista (`ng build` direto), o
  service worker descobre os blocos sozinho, seguindo as importações a partir do `index.html`.
- `e2e/offline.e2e.mjs`: teste de ponta a ponta num navegador real (Playwright, sob demanda).

### Corrigido

- Os service workers das duas versões, servidas na mesma origem, apagavam o cache um do outro na
  ativação; cada um agora só apaga os próprios caches antigos.
- Cota de armazenamento cheia no service worker transformava uma resposta boa da rede em erro.
- Angular: marcar uma lista cheia deixava a caixa marcada sem o título entrar; reordenar ou remover
  títulos de uma lista fazia o foco se perder.

## [1.1.0] - 2026-10-03

Funcionalidades novas nas duas versões (web-vanilla e Angular), com o mesmo comportamento e os mesmos
formatos de dados: servidas na mesma origem, as duas leem as listas uma da outra.

### Adicionado

- Listas personalizadas: criar, renomear, excluir, adicionar e remover títulos e reordenar. Ficam no
  `localStorage` com número de versão, com migração do formato sem versão e descarte de dados
  corrompidos. Telas `#/listas` e `#/lista/:id` (vanilla) ou `#/listas/:id` (Angular), e bloco
  "Minhas listas" na página de detalhes.
- Compartilhamento de lista por link: código compacto (JSON em base64url) no hash da URL, só com nome
  da lista e tipo, id e nome de cada título. Tela de importação com validação completa e prévia antes
  de salvar.
- Recomendações "Para você" a partir dos gêneros dos favoritos e das avaliações, com explicação
  "Porque você gostou de…".
- Modo offline: service worker com cache das últimas respostas da API (expiram em 24 horas), dos
  pôsteres visitados (até 300) e dos arquivos do app, mais um indicador de estado da conexão.
- Testes: listas, migração, link de compartilhamento, recomendações, regras do modo offline, os dois
  service workers executados com Cache API simulada, telas novas e rotas.

### Alterado

- Favoritos, avaliações e itens de listagem guardam também os ids de gênero (`genreIds`), usados nas
  recomendações. Registros antigos sem esse campo continuam válidos.
- Favoritar pela página de detalhes guarda só o resumo do título (antes, no Angular, o objeto de
  detalhes inteiro ia para o `localStorage`).

## [1.0.0] - 2026-10-01

- Versões web-vanilla e Angular reorganizadas e corrigidas: catálogo, filtros na URL, detalhes,
  favoritos, avaliações, chave da API fora do repositório, testes e CI.
