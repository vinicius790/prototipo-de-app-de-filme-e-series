# syntax=docker/dockerfile:1
FROM nginx:1.27-alpine

LABEL maintainer="Erick <contato@erick.dev>" \
      description="Web Vanilla Filmes e Séries servido com Nginx Alpine otimizado"

WORKDIR /usr/share/nginx/html

# Remove arquivos estáticos padrão do nginx
RUN rm -rf ./*

# Aplica configuração com headers de cache e segurança
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia os arquivos do app web-vanilla
COPY web-vanilla/ .

# Permissões apropriadas
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
