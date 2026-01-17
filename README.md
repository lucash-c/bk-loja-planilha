============================================================
BACKEND - SISTEMA MULTI-LOJA (API)
============================================================

------------------------------------------------------------
AUTENTICAÇÃO
------------------------------------------------------------

LOGIN (ETAPA 1 - SEM TOKEN)

POST /api/auth/login
Body JSON:

{
  "email": "admin@admin.com",
  "password": "senha123"
}

Resposta:

{
  "ok": true,
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

OBS:
- Nesta etapa NÃO é gerado token
- O frontend deve listar as lojas disponíveis para o usuário


------------------------------------------------------------
SELECIONAR LOJA (ETAPA 2 - GERA TOKEN)
------------------------------------------------------------

POST /api/auth/select-store
Body JSON:

{
  "user_id": "uuid-do-usuario",
  "loja_id": "uuid-da-loja"
}

Resposta:

{
  "ok": true,
  "token": "JWT_COM_USUARIO_E_LOJA",
  "loja": {
    "id": "uuid-da-loja",
    "name": "Loja Centro"
  }
}

OBS:
- O token representa USUÁRIO + LOJA ATIVA
- Para trocar de loja, basta chamar este endpoint novamente
- Não é necessário novo login

O frontend deve armazenar o token e enviar em todas as rotas protegidas:

Authorization: Bearer <token>


------------------------------------------------------------
RECUPERAÇÃO DE SENHA
------------------------------------------------------------

POST /api/auth/forgot

POST /api/auth/reset


------------------------------------------------------------
PRODUTOS (PAINEL ADMIN / PDV)
------------------------------------------------------------

OBS GERAL:
- TODAS as rotas de produtos usam JWT
- A loja é resolvida SEMPRE via token (req.loja)
- Não é permitido informar loja_id no body
- Compatível com SQLite (dev) e PostgreSQL (prod)

------------------------------------------------------------
CRIAR PRODUTO
------------------------------------------------------------

POST /api/products

Header:
Authorization: Bearer <token>

Body JSON:

{
  "name": "Pizza Calabresa",
  "description": "Pizza grande de calabresa",
  "base_price": 39.90,
  "image_url": "https://drive.google.com/...",
  "has_options": true
}

Campos:
- name (obrigatório)
- base_price (number)
- image_url (opcional)
- has_options:
  - false → produto simples
  - true → produto com opções (pizza, lanche customizável)

------------------------------------------------------------
LISTAR PRODUTOS DA LOJA ATIVA
------------------------------------------------------------

GET /api/products

Header:
Authorization: Bearer <token>

Query Params (opcional):
- active=true → retorna apenas produtos ativos

------------------------------------------------------------
OBTER PRODUTO POR ID
------------------------------------------------------------

GET /api/products/{id}

Header:
Authorization: Bearer <token>

OBS:
- Retorna apenas se o produto pertencer à loja ativa

------------------------------------------------------------
ATUALIZAR PRODUTO
------------------------------------------------------------

PUT /api/products/{id}

Header:
Authorization: Bearer <token>

Body (parcial):

{
  "name": "Pizza Calabresa Especial",
  "base_price": 42.90,
  "has_options": true,
  "is_active": true
}

OBS:
- Atualização parcial via COALESCE
- Não é possível trocar a loja do produto

------------------------------------------------------------
DESATIVAR PRODUTO (SOFT DELETE)
------------------------------------------------------------

DELETE /api/products/{id}

Header:
Authorization: Bearer <token>

OBS:
- Apenas marca is_active = false
- Produto não é removido do banco


------------------------------------------------------------
ITENS DE OPÇÃO DE PRODUTO
------------------------------------------------------------

OBS GERAL:
- Todas as rotas abaixo exigem JWT
- A loja é validada pelo token (não informar loja_id)
- A remoção é soft delete (is_active = false)

------------------------------------------------------------
ATUALIZAR ITEM DE OPÇÃO
------------------------------------------------------------

PUT /api/products/options/{optionId}/items/{itemId}

Header:
Authorization: Bearer <token>

Body (parcial):

{
  "name": "Bacon extra",
  "price": 5.50,
  "is_active": true,
  "is_visible": true
}

OBS:
- Atualização parcial via COALESCE
- Só atualiza se a opção pertencer à loja ativa

------------------------------------------------------------
REMOVER ITEM DE OPÇÃO (SOFT DELETE)
------------------------------------------------------------

DELETE /api/products/options/{optionId}/items/{itemId}

Header:
Authorization: Bearer <token>

Resposta:

{
  "id": "uuid-item",
  "option_id": "uuid-opcao",
  "name": "Bacon extra",
  "price": "5.50",
  "is_active": false,
  "is_visible": true
}


------------------------------------------------------------
PEDIDOS
------------------------------------------------------------

CRIAR PEDIDO (CLIENTE FINAL - PÚBLICO)

POST /api/orders

Header obrigatório:
X-LOJA-KEY: chave-publica-da-loja

Body JSON:

{
  "external_id": "ABC123",
  "customer_name": "João",
  "customer_whatsapp": "+5511999000111",
  "delivery_address": "Rua A, 123",
  "payment_method": "PIX",
  "total": 45.50,
  "notes": "Sem cebola",
  "items": [
    { "product_name": "X-Bacon", "quantity": 1, "unit_price": 20.00 },
    { "product_name": "Refrigerante", "quantity": 1, "unit_price": 5.50 }
  ]
}

OBS:
- Esta rota NÃO usa JWT
- A loja é identificada via X-LOJA-KEY


------------------------------------------------------------
LISTAR PEDIDOS (PAINEL ADMIN)
------------------------------------------------------------

GET /api/orders

Header:
Authorization: Bearer <token>


------------------------------------------------------------
OBTER PEDIDO
------------------------------------------------------------

GET /api/orders/{id}

{id} pode ser:
- UUID interno
- external_id


------------------------------------------------------------
ATUALIZAR STATUS DO PEDIDO
------------------------------------------------------------

PUT /api/orders/{id}/status

Header:
Authorization: Bearer <token>

Body:

{
  "status": "delivered",
  "payment_status": "paid"
}


------------------------------------------------------------
CONFIGURAÇÕES DA LOJA
------------------------------------------------------------

GET /api/store-settings
PUT /api/store-settings


------------------------------------------------------------
BANCO DE DADOS (DEV x PRODUÇÃO)
------------------------------------------------------------

DESENVOLVIMENTO:
- SQLite automático
- Inicialização:
  node scripts/init-sqlite.js

PRODUÇÃO:
- PostgreSQL
- Ativado quando DATABASE_URL existir
- Compatível com Coolify


------------------------------------------------------------
RODAR LOCAL
------------------------------------------------------------

npm install
node scripts/init-sqlite.js
npm run dev


------------------------------------------------------------
DEPLOY (COOLIFY)
------------------------------------------------------------

- Definir DATABASE_URL
- Definir JWT_SECRET
- Definir PG_SSL se necessário
- Porta padrão: 4000


------------------------------------------------------------
PRÓXIMOS PASSOS
------------------------------------------------------------

1) Product Options (sabores, adicionais, bordas)
2) Cardápio público
3) PDV
4) Integração WhatsApp
============================================================
