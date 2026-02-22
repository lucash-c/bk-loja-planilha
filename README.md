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
- `PUT /current` atualiza cadastro da loja ativa (exceto ativação)
- `POST /current/regenerate-key` gera nova public key

Créditos:

- `GET /:id/credits`
- `POST /:id/credits/add`
- `POST /:id/credits/consume`

### Lojas (admin do sistema)

Base: `/api/lojas/admin` (exige token de usuário com `role=admin`)

- `GET /` lista todas as lojas
- `GET /:id` detalhes completos de qualquer loja
  - `?include=settings,credits` adiciona settings e créditos
- `PUT /:id` edita qualquer loja (inclui `is_active`)
- `PATCH /:id/status` ativa/desativa loja (`{ "is_active": true|false }`)
- `DELETE /:id` exclui loja (remove relações vinculadas)

### Configurações da loja

Base: `/api/store-settings`

- `GET /`
- `PUT /` atualiza configurações (somente owner, usado para abrir/fechar a loja via `is_open`)

### Faixas de entrega (admin)

Base: `/api/delivery-fees`

Todas as rotas exigem JWT com loja ativa.

- `GET /` lista faixas de entrega da loja
- `POST /` cria/atualiza uma faixa (upsert por distância)
- `DELETE /:id` remove uma faixa
- `POST /batch` cria/atualiza várias faixas de uma só vez
- `DELETE /batch` remove várias faixas de uma só vez

#### POST `/api/delivery-fees`

Body:

```json
{
  "distance_km": 5,
  "fee": 12.5,
  "estimated_time_minutes": 45
}
```

Resposta:

```json
{
  "id": "uuid-faixa",
  "loja_id": "uuid-loja",
  "distance_km": 5,
  "fee": "12.50",
  "estimated_time_minutes": 45,
  "created_at": "2024-01-01T12:00:00.000Z"
}
```

#### POST `/api/delivery-fees/batch`

Body (lote):

```json
{
  "items": [
    { "distance_km": 3, "fee": 8, "estimated_time_minutes": 30 },
    { "distance_km": 5, "fee": 12.5, "estimated_time_minutes": 45 },
    { "distance_km": 10, "fee": 18 }
  ]
}
```

Resposta (faixas atualizadas, ordenadas por distância):

```json
[
  {
    "id": "uuid-faixa-1",
    "loja_id": "uuid-loja",
    "distance_km": 3,
    "fee": "8.00",
    "estimated_time_minutes": 30,
    "created_at": "2024-01-01T12:00:00.000Z"
  },
  {
    "id": "uuid-faixa-2",
    "loja_id": "uuid-loja",
    "distance_km": 5,
    "fee": "12.50",
    "estimated_time_minutes": 45,
    "created_at": "2024-01-01T12:00:00.000Z"
  }
]
```

#### DELETE `/api/delivery-fees/:id`

Resposta:

```json
{ "ok": true }
```

#### DELETE `/api/delivery-fees/batch`

Body:

```json
{
  "ids": ["uuid-faixa-1", "uuid-faixa-2"]
}
```

Resposta:

```json
{ "deleted": 2 }
```

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

### Grupos de adicionais (admin)

Base: `/option-groups`

- `GET /` lista grupos com seus itens
- `POST /bulk` cria grupos em lote
- `PUT /bulk` atualiza grupos em lote
- `DELETE /bulk` remove grupos em lote

Payload de grupo (criação/atualização):

```json
[
  {
    "id": "uuid-opcional-para-update",
    "name": "Adicionais",
    "type": "single",
    "required": false,
    "min_choices": 0,
    "max_choices": 2,
    "items": [
      {
        "id": "uuid-opcional-para-update",
        "name": "Bacon",
        "price": 3.5,
        "is_active": true,
        "is_visible": true
      }
    ]
  }
]
```

Respostas em lote incluem IDs criados/atualizados e erros por registro:

```json
{
  "created": [
    {
      "index": 0,
      "id": "uuid-grupo",
      "item_ids": ["uuid-item-1", "uuid-item-2"]
    }
  ],
  "errors": [
    {
      "index": 1,
      "error": "Já existe um grupo com este nome para a loja"
    }
  ]
}
```

```json
{
  "updated": [
    {
      "index": 0,
      "id": "uuid-grupo",
      "item_changes": {
        "created": ["uuid-item-novo"],
        "updated": ["uuid-item-existente"],
        "deleted": ["uuid-item-removido"]
      }
    }
  ],
  "errors": [
    {
      "index": 2,
      "error": "Grupo não encontrado"
    }
  ]
}
```

```json
{
  "deleted": [
    {
      "index": 0,
      "id": "uuid-grupo"
    }
  ],
  "errors": [
    {
      "index": 1,
      "error": "Grupo não encontrado"
    }
  ]
}
```

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

Parâmetro opcional:
- `group_by=none`: desativa o agrupamento por categoria no payload `categories`.

Configuração opcional de rollout:
- `PUBLIC_MENU_OPTIONS_SOURCE=hybrid|legacy|group` (default: `hybrid`).
  - `hybrid`: combina opções legadas (`product_options`) e grupos modernos (`option_groups`).
  - `legacy`: retorna apenas opções legadas.
  - `group`: retorna apenas grupos modernos.

Retorna produtos, opções e faixas de entrega visíveis para a loja, incluindo:

- `products` (legado): lista flat de produtos com opções.
- `categories` (novo): lista agrupada por `category_id`, no formato:

```json
[
  {
    "id": "uuid-da-categoria",
    "name": "Bebidas",
    "slug": "bebidas",
    "image_url": "https://...",
    "products": [
      {
        "id": "uuid-produto",
        "name": "Coca-Cola 350ml",
        "category_id": "uuid-da-categoria",
        "category": {
          "id": "uuid-da-categoria",
          "name": "Bebidas",
          "slug": "bebidas",
          "image_url": "https://..."
        },
        "options": [
          {
            "id": "uuid-opcao",
            "name": "Molhos",
            "type": "multiple",
            "required": false,
            "min_choices": 0,
            "max_choices": 2,
            "created_at": "2024-01-01T12:00:00.000Z",
            "items": [
              {
                "id": "uuid-item",
                "name": "Barbecue",
                "price": 1.5
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": null,
    "name": "Sem categoria",
    "slug": null,
    "image_url": null,
    "products": []
  }
]
```

Contrato final de `options`:
- `id`, `name`, `type`, `required`, `min_choices`, `max_choices`, `created_at`, `items[]`.
- `items[]` contém `id`, `name`, `price`.
- Metadado `source` (`legacy|group`) só é exposto se `PUBLIC_MENU_OPTIONS_INCLUDE_SOURCE=true` (debug).

Comportamento quando coexistirem legado + grupos (`hybrid`):
- A API combina as duas fontes.
- Faz deduplicação por nome/slug normalizado da opção.
- Em conflito, prioriza `option_groups` (fonte moderna).
- Ordenação estável: opções por `created_at` (fallback `name`) e itens por `name`.

Recomendação oficial para novos cadastros:
- Priorizar `option_groups` para novas opções.
- Manter legado apenas para compatibilidade/migração gradual.

Regras:
- Loja inexistente: retorna `404`.
- Categorias sem produtos não aparecem no agrupamento (o agrupamento é gerado a partir dos produtos visíveis).
- Produtos com `category_id = null` entram no grupo padrão `Sem categoria`.

## Deploy (Coolify)

- Definir `DATABASE_URL`
- Definir `JWT_SECRET`
- Definir `PG_SSL` se necessário
- Porta padrão: `4000`
