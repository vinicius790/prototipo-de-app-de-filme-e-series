# Segurança

## Relatar uma vulnerabilidade

Caso identifique qualquer falha de segurança ou vazamento inadvertido de credenciais, reporte de forma privada pela aba **Security → Report a vulnerability** no repositório GitHub. Não divulgue chaves de API nem detalhes exploráveis publicamente.

Inclua:
- Módulo afetado (versão Vanilla JS ou versão Angular).
- Passos para reproduzir o problema.
- Impacto esperado e riscos identificados.

## Gestão de credenciais e chaves de API

Este projeto consome a API pública do **The Movie Database (TMDB)**:
- **Proteção da chave de API**: a chave de acesso do TMDB **nunca** deve ser incluída no histórico do git.
- **Arquivos de exemplo**: use apenas os modelos versionados (`web-vanilla/config.example.js` e `angular/public/config.example.json`). As configurações reais (`config.js` e `config.json`) estão expressamente listadas no `.gitignore`.
- Caso uma chave seja commitada por engano, deve ser imediatamente revogada e regerada no painel de desenvolvedor do TMDB.

## Modelo e escopo do aplicativo

- **Renderização e dados externos**: dados obtidos da API do TMDB são tratados como entradas externas e higienizados antes da renderização no DOM para mitigar riscos de Cross-Site Scripting (XSS).
- **Comunicação estritamente via HTTPS**: todos os endpoints de requisição de filmes, séries e metadados utilizam TLS/HTTPS obrigatório.
- **Sem armazenamento de dados pessoais**: o protótipo não implementa autenticação com senha de usuários e não armazena dados confidenciais do usuário final.

## Boas práticas para colaboradores

- Nunca altere os arquivos de exemplo para conter chaves reais.
- Mantenha dependências do Angular e ferramentas Node atualizadas contra vulnerabilidades conhecidas (`npm audit`).
