# Ligar o OneDrive

O sistema chega ao OneDrive pelo **Microsoft Graph**, em nome de quem liga a conta (o mesmo modelo
do Google): cada pessoa liga a sua conta Microsoft em `/integracoes` e escolhe a **pasta da
empresa**. Os agentes só trabalham dentro dessa pasta, e só veem o que essa conta pode ver.

São três partes: registar a aplicação na Microsoft (uma vez), pôr as chaves no `.env`/Vercel, e
ligar a conta na app.

---

## 1. Registar a aplicação no Microsoft Entra (uma vez)

Quem faz: alguém com acesso de administrador ao Microsoft 365 da empresa (ou, se a pasta estiver
num OneDrive pessoal — @outlook.com / @hotmail.com —, essa pessoa, numa conta Azure gratuita).

1. Abrir <https://entra.microsoft.com> → **Identidade** (Entra ID) → **Registos de aplicações**
   (*App registrations*) → **Novo registo**.
2. Preencher:
   - **Nome:** `ElevateOne Automações`
   - **Tipos de conta suportados** — escolha conforme onde está a pasta:

     | A pasta está…                                       | Escolha                                                     | `MICROSOFT_TENANT_ID`            |
     | --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
     | no OneDrive **da empresa** (Microsoft 365, SharePoint) | *Contas apenas neste diretório organizacional* (single tenant) | o **ID do diretório (tenant)** |
     | num OneDrive **pessoal** (outlook/hotmail/live)      | *Contas em qualquer diretório organizacional e contas Microsoft pessoais* | `common`         |

     Na dúvida, se o link da pasta tem `sharepoint.com`, é da empresa.
   - **URI de redirecionamento:** plataforma **Web**, e o endereço
     `http://localhost:3000/api/microsoft/callback` (para testar no computador).
3. **Registar.** Na página **Descrição geral** copie:
   - **ID da aplicação (cliente)** → `MICROSOFT_CLIENT_ID`
   - **ID do diretório (inquilino)** → `MICROSOFT_TENANT_ID` (só no caso *single tenant*)
4. **Autenticação** → **Adicionar URI** → o endereço de produção:
   `https://<domínio-da-app>/api/microsoft/callback` (o mesmo `APP_URL` da Vercel). Guardar.
5. **Certificados e segredos** → **Novo segredo do cliente** → descrição `app`, validade 24 meses
   → **Adicionar**. Copie logo a coluna **Valor** (não o *ID do segredo*; o valor só aparece uma
   vez) → `MICROSOFT_CLIENT_SECRET`. Ponha um lembrete para o renovar antes de expirar.
6. **Permissões de API** → **Adicionar uma permissão** → **Microsoft Graph** → **Permissões
   delegadas** e marcar:
   - `Files.ReadWrite.All`
   - `offline_access`, `openid`, `email`, `profile`
   - `User.Read` (já vem)

   Depois, numa conta de empresa, clique **Conceder consentimento de administrador para
   &lt;empresa&gt;**. Assim ninguém fica bloqueado com «precisa de aprovação do administrador».

> **Porque `Files.ReadWrite.All`?** É o que chega às pastas **partilhadas** com a pessoa (a da
> empresa costuma ser uma delas) e deixa os agentes, mais à frente, guardar e organizar
> documentos. Os agentes pedem sempre confirmação antes de escrever.

## 2. Configurar as chaves

No `.env` (local):

```
APP_URL="http://localhost:3000"
MICROSOFT_CLIENT_ID="…"
MICROSOFT_CLIENT_SECRET="…"
MICROSOFT_TENANT_ID="…"        # ou common
ENCRYPTION_KEY="…"             # já existe (é a mesma do Google)
```

Aplicar a migração nova (cria a tabela `microsoft_accounts`):

```
npm run db:migrate
```

Na **Vercel**: *Project Settings → Environment Variables → Production*, acrescentar as três
`MICROSOFT_*` e fazer um novo deploy. O build de produção já corre `prisma migrate deploy`.
Num servidor Docker (Hostinger), juntar as três variáveis ao `.env` e reiniciar o contentor; a
migração corre com `npm run db:deploy`.

## 3. Ligar a conta e escolher a pasta

1. Entrar na app → **Integrações** → cartão **Microsoft OneDrive** → **Ligar conta Microsoft**.
2. Escolher a conta que **tem acesso** à pasta da empresa e aceitar as permissões.
3. De volta à app, indicar a pasta, de uma de duas maneiras:
   - **Link de partilha:** no OneDrive, na pasta → **Partilhar** → **Copiar link**, e colar.
     Qualquer tipo de link serve, desde que a conta ligada tenha acesso à pasta.
   - **Caminho:** se a pasta está no OneDrive da própria pessoa, o caminho a partir da raiz, por
     exemplo `Empresa/Documentos`.
4. **Usar esta pasta.** A app mostra o que lá está. **Ver o que lá está** confirma a qualquer
   momento que a ligação funciona.

## Problemas comuns

| O que aparece                                               | Porquê / o que fazer                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| «A ligação à Microsoft ainda não está configurada»          | Faltam `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` ou `APP_URL` no ambiente (e um novo deploy).           |
| Na Microsoft: `AADSTS50011` (redirect URI não corresponde)   | O URI em **Autenticação** tem de ser exatamente `<APP_URL>/api/microsoft/callback`, sem barra no fim.          |
| Na Microsoft: `AADSTS700016` (aplicação não encontrada)      | O tipo de conta não bate com `MICROSOFT_TENANT_ID`: conta pessoal com app *single tenant*, ou o tenant errado. |
| «Precisa de aprovação do administrador»                      | Um admin do Microsoft 365 clica **Conceder consentimento de administrador** (passo 1.6).                       |
| Erro ao ligar, depois de meses a funcionar                   | O segredo do cliente expirou: criar um novo (passo 1.5) e trocar `MICROSOFT_CLIENT_SECRET`.                   |
| «O OneDrive recusou o pedido (403)» ao escolher a pasta      | A conta ligada não tem acesso a essa pasta: peça a quem a partilhou para a partilhar com essa conta.           |
| «O OneDrive recusou o pedido (404)»                          | O link está errado/expirou, ou o caminho não existe (atenção a maiúsculas e acentos).                         |

**Desligar.** O botão **Desligar** apaga o acesso guardado na app. Para o retirar também do lado
da Microsoft: <https://myapps.microsoft.com> (conta de empresa) ou
<https://account.live.com/consent/Manage> (conta pessoal).

## Para quem programa

- OAuth: `src/server/integrations/microsoft/oauth.ts` (a Microsoft roda o refresh token a cada
  renovação; o serviço guarda sempre o mais recente, cifrado com `ENCRYPTION_KEY`).
- OneDrive (Graph): `src/server/integrations/microsoft/onedrive.ts` — `resolveFolder`,
  `listChildren`, `search`, `getItem`, `readFile` (até 10 MB).
- Serviço: `src/server/services/microsoft.service.ts`. As ferramentas dos agentes devem usar
  `microsoftService.oneDriveFor(userId)`, que devolve o drive **e** a pasta da empresa (e erros
  que dizem à pessoa onde ligar a conta ou escolher a pasta).
- Rotas: `GET/DELETE /api/microsoft`, `GET /api/microsoft/connect`, `GET /api/microsoft/callback`,
  `GET/PUT/DELETE /api/microsoft/folder`.
