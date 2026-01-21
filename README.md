# Backend - Sistema Multi-Loja (API)

API Node/Express para gerenciamento de lojas, produtos, pedidos e configurações de um sistema multi-loja. Possui autenticação em duas etapas (usuário e loja), endpoints públicos para pedidos e cardápio, além de suporte a SQLite (dev) e PostgreSQL (prod).

## Stack

- Node.js + Express
- SQLite (dev) via `better-sqlite3`
- PostgreSQL (prod) via `pg`
- JWT para autenticação

## Requisitos

- Node.js 18+
- SQLite (para desenvolvimento local)
- PostgreSQL (opcional, produção)

## Configuração

Crie um arquivo `.env` com as variáveis necessárias:

```env
# App
PORT=4000
FRONTEND_ORIGIN=http://localhost:8080

# Auth
JWT_SECRET=uma_chave_segura
JWT_EXPIRES_IN=8h
JWT_USER_EXPIRES_IN=8h

# Banco de dados
DATABASE_URL=postgres://user:pass@host:5432/dbname # opcional
PG_SSL=false
SQLITE_PATH=./database/dev.db

# SMTP (recuperação de senha)
SMTP_HOST=smtp.seudominio.com
SMTP_PORT=587
SMTP_USER=usuario
SMTP_PASS=senha
```

## Rodar localmente (SQLite)

```bash
npm install
node scripts/init-sqlite.js
npm run dev
```

## Migração (PostgreSQL)

```bash
npm install
npm run migrate
npm start
```

## Autenticação

A autenticação funciona em duas etapas:

1. **Login** gera um token de usuário (sem loja).
2. **Selecionar loja** gera um token de usuário + loja ativa.

### Login (token de usuário)

`POST /api/auth/login`

```json
{
  "email": "admin@admin.com",
  "password": "senha123"
}
```

Resposta:

```json
{
  "ok": true,
  "token": "JWT_TOKEN_DO_USUARIO",
  "user": {
    "id": "uuid-do-usuario",
    "email": "admin@admin.com",
    "name": "Admin",
    "role": "admin"
  },
  "lojas": [
    {
      "id": "uuid-loja-1",
      "name": "Loja Centro",
      "is_active": true,
      "user_role": "owner"
    }
  ]
}
```

### Selecionar loja (token de usuário + loja)

`POST /api/auth/select-store`

Headers:

```
Authorization: Bearer JWT_TOKEN_DO_USUARIO
```

Body:

```json
{
  "loja_id": "uuid-da-loja"
}
```

Resposta:

```json
{
  "ok": true,
  "token": "JWT_COM_USUARIO_E_LOJA",
  "loja": {
    "id": "uuid-da-loja",
    "name": "Loja Centro",
    "public_key": "chave-publica"
  }
}
```

### Recuperação de senha

- `POST /api/auth/forgot`
- `POST /api/auth/reset`

### Registro de usuário

- `POST /api/auth/register` (use com cuidado em produção)

## Rotas principais

> Rotas protegidas exigem `Authorization: Bearer <token>` com token de **usuário + loja**.

### Lojas

Base: `/api/lojas`

- `POST /` cria loja
- `GET /` lista lojas do usuário
- `GET /current` detalhes da loja ativa
- `GET /current?include=settings,credits` inclui settings e/ou créditos na resposta
- `GET /current/summary` retorna `{ loja, settings, credits }`
- `PUT /current` atualiza loja ativa
- `POST /current/regenerate-key` gera nova public key

Créditos:

- `GET /:id/credits`
- `POST /:id/credits/add`
- `POST /:id/credits/consume`

### Configurações da loja

Base: `/api/store-settings`

- `GET /`
- `PUT /`

### Produtos (admin)

Base: `/products`

- `POST /` cria produto
- `GET /` lista produtos (query `active=true`, `visible=true`)
- `GET /:id`
- `PUT /:id`
- `DELETE /:id` remove produto

Opções de produto:

- `POST /:productId/options`
- `GET /:productId/options` (use `?include=items` para retornar itens)
- `PUT /:productId/options/:optionId`
- `DELETE /:productId/options/:optionId`

Itens de opção:

- `POST /options/:optionId/items`
- `GET /options/:optionId/items`
- `PUT /options/:optionId/items/:itemId`
- `DELETE /options/:optionId/items/:itemId`

### Pedidos

Base: `/api/orders`

Pedido público (sem JWT):

- `POST /` com `X-LOJA-KEY: <public_key>`
- Alternativa: `POST /?loja=<public_key>`

Painel admin (JWT):

- `GET /` lista pedidos
- `GET /?include=items` lista pedidos já com itens
- `GET /:id` (id interno ou `external_id`)
- `PUT /:id/status`

### Cardápio público

`GET /public/menu/:public_key`

Retorna produtos, opções e faixas de entrega visíveis para a loja.

## Deploy (Coolify)

- Definir `DATABASE_URL`
- Definir `JWT_SECRET`
- Definir `PG_SSL` se necessário
- Porta padrão: `4000`
