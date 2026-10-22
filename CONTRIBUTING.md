# Guia de Contribuição — Movie App (Filmes e Séries TMDB) 🎬

Agradecemos o interesse em colaborar com o **Movie App**! O projeto explora duas abordagens arquiteturais para uma mesma aplicação: **JavaScript Puro (Vanilla)** e **Angular**.

---

## 🛠️ Boas Práticas e Arquitetura

1. **Equivalência Funcional e Visual**:
   - Qualquer funcionalidade nova implementada na versão Vanilla (`web-vanilla/`) deve ter sua contrapartida equivalente na versão Angular (`angular/`), e vice-versa.
2. **Segurança e Sanitização**:
   - Nunca injete strings vindas da API via `innerHTML`. Use `createElement`/`textContent` na versão pura e interpolação padrão no Angular.
   - Nenhuma chave de API ou segredo deve ser versionado no Git.
3. **Modo Offline & Resiliência**:
   - Mantenha a integridade do cache nos Service Workers, respeitando expiração de requisições e armazenamento de pôsteres.
4. **Testes Automatizados**:
   - Todos os testes devem rodar com requisições simuladas (sem acessar a rede).

---

## 📋 Padrão de Commits (Conventional Commits)

Adotamos a convenção do [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/):

```text
<tipo>(<escopo>): <descrição no imperativo>
```

### Exemplos:
- `feat(vanilla): adiciona filtro de ordenacao por data de lancamento`
- `fix(sw): corrige cache de posters em navegadores antigos`
- `refactor(angular): migra componente de paginacao para Signals`
- `test(project): valida ausencia de chaves hardcoded e innerHTML`
- `docs(readme): adiciona badges e quick start em 3 passos`

---

## 🚀 Como Submeter um Pull Request

1. **Fork e Criação de Branch**:
   ```bash
   git checkout -b feat/minha-feature
   ```
2. **Executar Testes de Ambas as Versões**:
   ```bash
   # Testes da versão Vanilla e Service Worker
   npm test

   # Testes da versão Angular
   cd angular && npm test
   ```
   Ambas as suítes de teste devem passar com êxito.
3. **Commit Semântico**:
   ```bash
   git commit -m "feat(lists): permite exportar listas em formato JSON"
   ```
4. **Abrir Pull Request**:
   - Detalhe a implementação nas duas versões do projeto.
   - Confirme que os testes automatizados passaram localmente.
