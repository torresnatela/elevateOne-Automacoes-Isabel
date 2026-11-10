# ElevateOne Automações

Base do sistema: **Next.js 15 (App Router) + React 19 + TypeScript**, **PostgreSQL** via **Prisma**,
autenticação por login/senha com usuário padrão e autorização por papéis. Estrutura **MVC** e
desenvolvimento orientado a testes (**TDD**).

## Começando

```bash
cp .env.example .env            # ajuste SESSION_SECRET
docker compose up -d db         # Postgres 16 (cria também o banco elevateone_test)
npm install
npm run db:deploy               # aplica as migrations
npm run db:seed                 # cria o usuário padrão
npm run dev                     # http://localhost:3000
```

**Usuário padrão (dev):** `admin@elevateone.local` / `Admin@123` (papel `ADMIN`).
Definido por `DEFAULT_ADMIN_*` no `.env` — **troque em produção**. O seed é idempotente e nunca
sobrescreve a senha de um usuário existente.

## Scripts

| Script                                   | O que faz                                                  |
| ---------------------------------------- | ---------------------------------------------------------- |
| `npm run dev` / `build` / `start`        | Next.js                                                    |
| `npm test`                               | Testes unitários + integração (Vitest)                     |
| `npm run test:unit` / `test:integration` | Só uma das suítes                                          |
| `npm run test:watch`                     | Vitest em modo watch (ciclo TDD)                           |
| `npm run test:e2e`                       | Playwright (sobe o app em `:3100` contra o banco de teste) |
| `npm run lint` / `typecheck` / `format`  | Qualidade                                                  |
| `npm run db:migrate`                     | Cria uma nova migration (dev)                              |
| `npm run db:deploy` / `db:seed`          | Aplica migrations / cria usuário padrão                    |

Testes de integração e E2E usam o banco do `.env.test` (`elevateone_test`); as migrations são
aplicadas automaticamente antes da suíte.

## Arquitetura (MVC)

```
src/
  app/                 Rotas Next.js — camada fina que delega para controllers/views
    (public)/login     Página de login
    (protected)/       Layout que exige usuário ativo; dashboard e admin
    api/auth/*         login, logout, me  -> AuthController
  middleware.ts        Autenticação global + regra de papel por prefixo de rota
  server/
    models/            Entidades e tipos de domínio (User, Role, Session) — sem Prisma
    repositories/      Persistência (interface UserRepository + PrismaUserRepository)
    services/          Regras de negócio (auth, senha, sessão JWT, seed)
    controllers/       HTTP <-> services: valida entrada (zod), trata erros, define cookies
    policies/          Autorização: hasRole / can / requireRole e regras de rotas
    validators/        Schemas zod de entrada
    lib/               db (Prisma), erros, helpers HTTP, usuário atual
    container.ts       Composição das dependências (injeção manual)
  views/components/    Componentes React (LoginForm, LogoutButton)
tests/
  unit/                services, policies, validators, controllers, middleware, views
  integration/         repositório, rotas e seed contra Postgres real
  e2e/                 fluxo completo no navegador
  setup/               setup do Vitest, reset do banco, repositório fake
```

Regras da casa:

- **Controller nunca acessa o Prisma**; usa services. **Services dependem de interfaces** de
  repositório (injetadas no construtor), o que permite testá-los com `FakeUserRepository`.
- **TDD**: escreva o teste (vermelho) → implemente o mínimo (verde) → refatore. Toda feature nova
  entra com testes unitários e, quando tocar o banco, de integração.
- Erros de domínio estendem `AppError` (status + código) e viram JSON padronizado
  `{ error: { code, message } }` via `handleError`.

## Autenticação e autorização

- Senhas com **bcrypt**; sessão em **JWT HS256** (`jose`) num cookie `eo_session` `httpOnly`,
  `sameSite=lax`, `secure` em produção, validade de 8h.
- Login retorna sempre a mesma mensagem genérica para usuário inexistente, inativo ou senha
  errada (com tempo de resposta equalizado).
- `middleware.ts`: sem sessão → redireciona para `/login?next=...` (páginas) ou `401` (API).
  Rotas com papel exigido (`src/server/policies/routes.ts`) → `403`.
- O layout protegido confere no banco se o usuário ainda está ativo (desativar um usuário
  derruba o acesso mesmo com token válido).
- Papéis: `USER` < `ADMIN` (ADMIN herda as permissões de USER). Para uma nova feature:
  registre a ação em `PERMISSIONS` (`policies/authorization.ts`) e, se for por rota, o prefixo em
  `ROUTE_ROLES`.
