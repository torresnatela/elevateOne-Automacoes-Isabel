# Pôr em produção: app na Vercel, banco na Hostinger

A app (Next.js) corre na Vercel. Um servidor da Hostinger com Docker corre o Postgres (com
pgvector), a Evolution API (WhatsApp), o HTTPS da Evolution (Caddy) e as cópias de segurança.
Para tudo num só servidor, ver [producao.md](producao.md).

> **Testado:** o Postgres deste compose arranca com os dados de `.env.hostinger`, aceita ligações
> de fora só com SSL (TLS 1.3) e recusa as que vêm sem SSL; as migrations aplicam-se por essa
> ligação e a extensão `vector` fica criada. **Por testar:** a Evolution e o Caddy num servidor
> real, o seed e o build na Vercel.

## 1. Hostinger

Precisa de um VPS com Docker, as portas 80, 443 e 5432 abertas na firewall, e um subdomínio
(por exemplo `evolution.exemplo.com`) a apontar para o IP do servidor.

```bash
git clone <este repositório> && cd elevateOne-Automacoes-Isabel
cp .env.hostinger.example .env.hostinger   # preencher
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger up -d
```

- O Postgres fica aberto na internet, porque a Vercel não tem IP fixo: só aceita SSL e senha
  (`docker/postgres/pg_hba.conf`). Use uma senha longa e aleatória.
- O certificado do Postgres é auto-assinado. Cifra a ligação, mas não prova a identidade do
  servidor. Para isso, troque-o por um certificado do domínio e use `sslmode=verify-full`.

## 2. Banco: migrations e primeiro admin

Da sua máquina, com a `DATABASE_URL` de produção:

```bash
DATABASE_URL="postgresql://…?sslmode=require" npx prisma migrate deploy
DATABASE_URL="postgresql://…?sslmode=require" DEFAULT_ADMIN_NAME="Isabel" \
  DEFAULT_ADMIN_EMAIL="…" DEFAULT_ADMIN_PASSWORD="…" npx prisma db seed
```

Depois disso, cada deploy de produção na Vercel aplica sozinho as migrations novas (script
`vercel-build`). Os deploys de preview não lhes mexem.

## 3. Vercel

1. Importe o repositório. O framework é detetado como Next.js, e a Vercel usa o script
   `vercel-build` (`prisma generate`, as migrations em produção, `next build`).
2. Em *Settings → Environment Variables*, ponha as de [`.env.vercel.example`](../.env.vercel.example)
   no ambiente **Production**. A `DATABASE_URL` leva `sslmode=require` e um `connection_limit`
   baixo, porque cada instância da função abre as suas próprias ligações.
3. Domínio: aponte-o para a Vercel e ponha-o em `APP_URL`. No Google Cloud, o URI de
   redirecionamento passa a ser `<APP_URL>/api/google/callback`.

## 4. WhatsApp

Os mesmos passos de [producao.md](producao.md#ligar-o-whatsapp), com duas diferenças: os comandos
vão para `https://<EVOLUTION_DOMAIN>` e não para `localhost:8080`, e o webhook aponta para a Vercel:

```bash
curl -X POST https://$EVOLUTION_DOMAIN/webhook/set/$EVOLUTION_INSTANCE \
  -H "apikey: $EVOLUTION_API_KEY" -H "content-type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"'"$APP_URL"'/api/webhooks/whatsapp","events":["MESSAGES_UPSERT"],"base64":false,"headers":{"x-webhook-secret":"'"$WHATSAPP_WEBHOOK_SECRET"'"}}}'
```

## O que muda em relação a um só servidor

- **Mais de uma instância.** A Vercel pode correr a app em várias instâncias ao mesmo tempo. A fila
  "uma mensagem de cada vez por número" e o limite de tentativas no login vivem na memória de
  cada instância, por isso deixam de ser garantidos: duas mensagens seguidas do mesmo número
  podem ser tratadas em paralelo. Com poucos utilizadores é raro. Se incomodar, a fila tem de
  passar para o banco ou para um Redis.
- **Respostas longas.** O agente do WhatsApp trabalha depois de o webhook responder, até ao limite
  da função (`maxDuration = 300` s).
- **Latência.** Escolha na Vercel uma região de funções perto do servidor da Hostinger
  (*Settings → Functions → Region*). Cada consulta atravessa a internet.
