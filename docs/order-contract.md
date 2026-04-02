# Contrato canônico de pedidos (backend)

Este documento consolida o contrato de pedidos deste backend como **fonte de verdade** para integração com `pdv-loja` e `loja-online`, mantendo compatibilidade com payloads legados já aceitos.

## Endpoints mapeados

- `POST /api/orders` → `createOrder` (pedido público, `identifyStore` via `X-LOJA-KEY`).  
- `POST /api/orders/pdv-transactional` → `createPdvTransactional` (pedido PDV transacional, também via `X-LOJA-KEY`).  
- `GET /api/orders` → `listOrders` (painel autenticado, opcional `include=items`).  
- `GET /api/orders/:id` → `getOrder` (painel autenticado, busca por `id` **ou** `external_id`).  

---

## 1) Shape canônico de entrada (recomendado)

### 1.1 Order (request)

```json
{
  "external_id": "string|null",
  "customer_name": "string|null",
  "customer_whatsapp": "string|null",
  "delivery_address": "string|null",
  "delivery_fee": 0,
  "delivery_distance_km": 0,
  "delivery_estimated_time_minutes": 0,
  "order_type": "entrega|retirada|local",
  "payment_method": "string|null",
  "origin": "cliente|pdv",
  "total": 0,
  "notes": "string|null",
  "items": ["order item"]
}
```

Regras:

- `items` é obrigatório e precisa ter pelo menos 1 item.
- `order_type`, quando informado, aceita apenas: `entrega`, `retirada`, `local`.
- `origin`, quando informado em `POST /api/orders`, aceita: `cliente`, `pdv`.
- Em `POST /api/orders/pdv-transactional`, `origin` persistido é sempre `pdv`.
- `total` é opcional; quando enviado, precisa ser número válido e não negativo.
- Quando `total` não é enviado, o backend calcula automaticamente.

### 1.2 Order item (request)

```json
{
  "product_name": "string",
  "quantity": 1,
  "unit_price": 10,
  "observation": "string|null",
  "options": ["item option canônica"]
}
```

Normalizações:

- `quantity` default: `1`.
- `unit_price` default: `0`.
- `total_price` persistido:
  - usa `item.total_price` se vier válido (compatibilidade legado), ou
  - calcula `quantity * (unit_price + soma(options[].price))`.
- `observation` pode vir por aliases legados e é consolidado no campo canônico.

### 1.3 Item options (request)

Shape canônico normalizado internamente:

```json
[
  {
    "option_id": "string (opcional)",
    "option_name": "string (opcional)",
    "item_id": "string (opcional)",
    "item_name": "string (opcional)",
    "price": 0
  }
]
```

Regras:

- Apenas os campos acima são mantidos.
- Strings passam por `trim`.
- `price` é numérico e arredondado para 2 casas.
- Entrada sem `option_name` **e** sem `item_name` é descartada.

### 1.4 Regra monetária canônica (sem breaking change)

- `unit_price` = preço base unitário do produto.
- `options[].price` = acréscimo unitário da opção.
- `order_items.total_price` = `item.total_price` válido informado **ou** cálculo canônico do item.
- `orders.total` = `total` válido informado **ou** `soma(order_items.total_price)` + `delivery_fee` somente quando `order_type = entrega`.
- `delivery_fee` continua salvo no pedido para auditoria; em `retirada` e `local`, não é somado automaticamente ao total calculado.

---

## 2) Shape canônico de saída (GET)

### 2.1 `GET /api/orders?include=items`

Retorna array de pedidos. Cada pedido contém `items` com item normalizado:

```json
{
  "id": "...",
  "order_id": "...",
  "product_name": "...",
  "quantity": 1,
  "unit_price": 10,
  "total_price": 10,
  "observation": "...",
  "options": ["item option canônica"],
  "options_json": ["item option canônica"] | null,
  "optionsJson": ["item option canônica"] | null
}
```

### 2.2 `GET /api/orders/:id`

Retorna um pedido com o mesmo shape de item acima.

Compatibilidade de leitura:

- `options` é o campo canônico recomendado para leitura.
- `options_json` e `optionsJson` continuam no response como espelho compatível.
- Sem opções válidas: `options = []`, `options_json = null`, `optionsJson = null`.

---

## 3) Formatos legacy aceitos (compatibilidade)

### 3.1 Campos legacy de item

- `observacao`, `obs`, `observação` → fallback para `observation`.
- `options_json` (snake_case) aceito na escrita.
- `optionsJson` (camelCase) aceito na escrita.

### 3.2 Formatos legacy para options na escrita

Além do array plano canônico, também são aceitos:

1. Container por chave (`options`, `option_groups`, `groups`, `selected_options`):

```json
{ "groups": [ ... ] }
```

2. Shape agrupado:

```json
[
  {
    "name": "Sabores",
    "items": [
      { "name": "Calabresa", "price": 35 }
    ]
  }
]
```

3. Objeto flat único:

```json
{ "option_name": "Adicionais", "item_name": "Bacon", "price": 5 }
```

4. Aliases aceitos em grupo/item:

- Nome grupo: `option_name`, `group_name`, `name`, `label`, `title`
- Id grupo: `option_id`, `group_id`, `id`, `optionGroupId`, `groupId`
- Itens do grupo: `items`, `selected_items`, `selectedOptions`, `selected_options`, `option_items`, `optionItems`, `selectedItems`, `itens`
- Nome item: `item_name`, `name`, `label`, `title`
- Id item: `item_id`, `id`, `option_item_id`, `optionItemId`
- Preço item: `price`, `unit_price`, `additional_price`, `extra_price`, `value`

### 3.3 Precedência de leitura de options no request item

Ordem atual (mantida por compatibilidade):

1. `item.options`  
2. `item.options_json`  
3. `item.optionsJson`

---

## 4) Exemplos concretos

### 4.1 Pedido simples (canônico)

```json
{
  "external_id": "site-1001",
  "customer_name": "Maria",
  "order_type": "entrega",
  "origin": "cliente",
  "total": 24,
  "items": [
    {
      "product_name": "X-Burger",
      "quantity": 1,
      "unit_price": 24,
      "observation": "sem cebola"
    }
  ]
}
```

### 4.2 Pedido com pizza e múltiplas opções (canônico)

```json
{
  "external_id": "site-1002",
  "order_type": "entrega",
  "origin": "cliente",
  "total": 70,
  "items": [
    {
      "product_name": "Pizza Grande",
      "quantity": 1,
      "unit_price": 60,
      "options": [
        { "option_name": "Sabores", "item_name": "Calabresa", "price": 5 },
        { "option_name": "Sabores", "item_name": "Mussarela", "price": 5 }
      ]
    }
  ]
}
```

### 4.3 Item com observação em formato legacy aceito

```json
{
  "product_name": "Lanche",
  "quantity": 1,
  "unit_price": 30,
  "observacao": "sem picles"
}
```

### 4.4 Resposta de GET com `options/options_json/optionsJson`

```json
{
  "id": "item-1",
  "order_id": "order-1",
  "product_name": "Pizza",
  "quantity": 1,
  "unit_price": 30,
  "total_price": 30,
  "observation": null,
  "options": [
    { "option_name": "Adicionais", "item_name": "Bacon", "price": 5.13 }
  ],
  "options_json": [
    { "option_name": "Adicionais", "item_name": "Bacon", "price": 5.13 }
  ],
  "optionsJson": [
    { "option_name": "Adicionais", "item_name": "Bacon", "price": 5.13 }
  ]
}
```

---

## 5) Testes de contrato relacionados

Testes já existentes e relevantes:

- `tests/order-payload-contract.integration.test.js`
  - cobre shape canônico de escrita;
  - cobre payload legacy aceito;
  - cobre precedência `options > options_json > optionsJson`;
  - cobre shape canônico de leitura em `getOrder` e `listOrders`.
- `tests/order-item-options.unit.test.js`
  - cobre sanitização e aliases de options em cenários unitários.
- `tests/orders-transactional.integration.test.js`
  - cobre fluxo transacional PDV (créditos, idempotência, rollback).

Este documento descreve o comportamento **atual** do backend e deve ser atualizado junto com qualquer mudança de contrato, preservando compatibilidade com clientes legados enquanto necessário.
