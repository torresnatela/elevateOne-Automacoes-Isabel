# A imagem de produção da app (Next.js autónomo). Ver docs/producao.md.
FROM node:22-bookworm-slim AS base
# O Prisma precisa do OpenSSL; os pedidos às APIs, dos certificados.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Com todas as dependências: faz o build e serve também para as migrations e o seed.
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npx prisma generate && npm run build

# Só o que é preciso para correr, sem privilégios.
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
