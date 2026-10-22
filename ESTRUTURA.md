# ESTRUTURA.md - prototipo-de-app-de-filme-e-series

## Visão Geral
Protótipo de aplicativo web para catálogo, busca e gerenciamento de filmes e séries.

## Organização de Pastas
- `index.html`: Interface do usuário.
- `src/` / arquivos estáticos (CSS/JS): Lógica de consumo de APIs de mídia e renderização de cards.
- `.github/workflows/`: Pipelines de CI/CD.

## Arquitetura e Fluxo de Dados
Fluxo assíncrono para requisições de APIs externas de filmes (como TMDb), gerencimento de estado de favoritos e exibição dinâmica na interface.
