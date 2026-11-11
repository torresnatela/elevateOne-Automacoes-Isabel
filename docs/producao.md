# Pôr em produção

Um só servidor com Docker corre tudo: a app, o Postgres, a Evolution API (WhatsApp), o HTTPS
(Caddy, com certificado automático) e as cópias de segurança diárias.

> **Por testar.** O build de produção da app foi verificado fora do Docker (corre sozinho, lê
> PDF e DOCX, responde em `/api/health`). A imagem Docker, o `docker-compose.prod.yml` no seu
> conjunto, o Caddy, os backups e os comandos da Evolution API abaixo ainda não correram num
> servidor: conte com ajustes na primeira instalação.

## O que é preciso

- Um servidor Linux com Docker e Docker Compose (2 vCPU e 4 GB de RAM chegam para começar), com
  as portas 80 e 443 abertas.
- Um domínio (por exemplo `app.exemplo.pt`) a apontar para o IP do servidor.
- As chaves: Anthropic, OpenAI, as credenciais OAuth do Google (com o URI de redirecionamento
  `https://<domínio>/api/google/callback`).
- Um número de telemóvel só para o agente do WhatsApp.

## Instalar

```bash
git clone <este repositório> && cd elevateOne-Automacoes-Isabel
cp .env.production.example .env.production   # preencher; cada segredo: openssl rand -hex 32
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

O serviço `migrate` aplica as migrations e cria o primeiro utilizador (`DEFAULT_ADMIN_*`) antes de
a app arrancar. A app fica em `https://<domínio>`. Para ver se está bem:

```bash
curl https://<domínio>/api/health        # {"ok":true}
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Depois de entrar, troque a senha do admin por uma que só a pessoa saiba (hoje troca-se no banco;
ainda não há página para isso).

## Ligar o WhatsApp

A Evolution API só escuta em `127.0.0.1:8080` no servidor. Do seu computador, abra um túnel e use
os comandos a partir daí:

```bash
ssh -L 8080:127.0.0.1:8080 <utilizador>@<servidor>
```

Com `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` e `WHATSAPP_WEBHOOK_SECRET` do `.env.production`:

```bash
# 1. Criar a instância (devolve o QR code; também se vê em http://localhost:8080/manager)
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H "content-type: application/json" \
  -d '{"instanceName":"'"$EVOLUTION_INSTANCE"'","integration":"WHATSAPP-BAILEYS","qrcode":true}'

# 2. Ler o QR code com o WhatsApp do telemóvel do número do agente (Dispositivos ligados)

# 3. Apontar o webhook para a app, por dentro da rede do Docker
curl -X POST http://localhost:8080/webhook/set/$EVOLUTION_INSTANCE \
  -H "apikey: $EVOLUTION_API_KEY" -H "content-type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"http://app:3000/api/webhooks/whatsapp","events":["MESSAGES_UPSERT"],"base64":true,"headers":{"x-webhook-secret":"'"$WHATSAPP_WEBHOOK_SECRET"'"}}}'
```

Por fim, em `/admin/whatsapp`, dê a cada pessoa o seu número; e cada pessoa liga a sua conta
Google em `/integracoes`.

## Atualizar

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

As migrations novas correm sozinhas antes de a app nova arrancar.

## Cópias de segurança

O serviço `backup` guarda todos os dias uma cópia dos dois bancos (`elevateone` e `evolution`) em
`./backups`, e mantém 7 dias, 4 semanas e 6 meses. **Ficam no mesmo servidor**: copie essa pasta
para fora dele (outro servidor, um bucket), senão um disco avariado leva os dados e as cópias.

Repor uma cópia:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production stop app
gunzip -c backups/daily/elevateone-<data>.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  psql -U postgres -d elevateone
docker compose -f docker-compose.prod.yml --env-file .env.production start app
```

A cópia tem os acessos ao Google cifrados com a `ENCRYPTION_KEY`: guarde essa chave à parte. Sem
ela, as contas Google têm de ser ligadas de novo.

## O que saber

- **Uma só instância da app.** As mensagens de um mesmo número de WhatsApp são tratadas uma de
  cada vez por uma fila na memória do processo. Com duas instâncias, isso deixava de valer.
- **Reiniciar a app a meio de uma resposta** perde essa resposta: a pessoa tem de pedir outra vez.
- **O WhatsApp não é oficial.** A Meta pode desligar ou bloquear o número. Se o agente deixar de
  responder, veja primeiro o estado da instância em `http://localhost:8080/manager`.
- **Dados de clientes saem do servidor**: o texto das conversas vai para a Anthropic, e os
  ficheiros da base de conhecimento e os áudios vão para a OpenAI. Convém isso constar da
  política de privacidade do escritório (RGPD).
- **Não há limite de tentativas no login.** Use uma senha forte no admin.
