# Contrato técnico de payload de pedidos (order / order item / item options)

> Objetivo: formalizar o contrato atualmente aceito em produção sem quebrar clientes legados (frontend público, PDV e integrações antigas).

## 1) Shape canônico — escrita (POST)

### 1.1 `order` (request)

Endpoints cobertos:
- `POST /api/orders`
- `POST /api/orders/pdv/transactional`

Campos canônicos de escrita:

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
- `order_type`, quando informado, aceita apenas `entrega`, `retirada` ou `local`.
- `origin`, quando informado, aceita apenas `cliente` ou `pdv`.

### 1.2 `order item` (request)

Shape canônico de escrita:

```json
{
  "product_name": "string",
  "quantity": 1,
  "unit_price": 10,
  "observation": "string|null",
  "options": ["item option canônico"]
}
```

Normalizações aplicadas pelo backend:
- `quantity` default = `1` quando ausente.
- `unit_price` default = `0` quando ausente.
- `total_price` persistido = `quantity * unit_price`.
- `observation` pode vir por aliases legados (`observacao`, `obs`, `observação`) e é consolidado em `observation`.

### 1.3 `item options` (request)

Shape canônico de escrita (após normalização):

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

Regras da option canônica:
- Cada entrada pode conter **somente**: `option_id`, `option_name`, `item_id`, `item_name`, `price`.
- Strings são `trim`.
- `price` é numérico com arredondamento para 2 casas.
- A entrada é descartada se, após sanitização, não tiver `option_name` **e** não tiver `item_name`.

## 2) Shape canônico — leitura (GET)

Endpoints cobertos:
- `GET /api/orders?include=items`
- `GET /api/orders/:id`

Para cada item retornado, o backend entrega shape canônico de leitura:

```json
{
  "id": "...",
  "order_id": "...",
  "product_name": "...",
  "quantity": 1,
  "unit_price": 10,
  "total_price": 10,
  "observation": "...",
  "options": ["item option canônico"],
  "options_json": ["item option canônico"] | null,
  "optionsJson": ["item option canônico"] | null
}
```

Observações importantes de compatibilidade:
- `options` é a forma canônica para leitura.
- `options_json` e `optionsJson` continuam expostos como espelho retrocompatível do mesmo conteúdo normalizado.
- Se não houver opções válidas, `options = []` e `options_json/optionsJson = null`.

## 3) Formatos legacy suportados (fallback explícito)

### 3.1 Campos legacy de item
- `observacao`, `obs`, `observação` → fallback para `observation`.
- `options_json` (snake_case) → aceito na escrita/leitura.
- `optionsJson` (camelCase) → aceito na escrita/leitura.

### 3.2 Formatos legacy de opções aceitos na escrita

Além do array plano canônico, o backend aceita:

1. **Objeto container**
```json
{ "options": [ ... ] }
```
Também aceita containers pelos aliases: `option_groups`, `groups`, `selected_options`.

2. **Shape agrupado**
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

3. **Aliases de grupo/item**
- Nome do grupo: `option_name`, `group_name`, `name`, `label`, `title`.
- Id do grupo: `option_id`, `group_id`, `id`, `optionGroupId`, `groupId`.
- Array de itens: `items`, `selected_items`, `selectedOptions`, `selected_options`, `option_items`, `optionItems`, `selectedItems`, `itens`.
- Nome do item: `item_name`, `name`, `label`, `title`.
- Id do item: `item_id`, `id`, `option_item_id`, `optionItemId`.
- Preço: `price`, `unit_price`, `additional_price`, `extra_price`, `value`.

4. **Objeto flat único**
```json
{ "option_name": "Adicionais", "item_name": "Bacon", "price": 5 }
```

### 3.3 Ordem de precedência (sem quebra de compatibilidade)
- Na escrita de item: tenta `item.options` primeiro.
- Se `item.options` não gerar opções válidas, faz fallback para `item.options_json`.
- Depois, fallback para `item.optionsJson`.

## 4) Impacto esperado na redução de regressões

- Define claramente **um shape canônico** para leitura e escrita, reduzindo ambiguidade entre frontend público, PDV e backend.
- Mantém a compatibilidade via fallbacks legados documentados, evitando ruptura em clientes antigos.
- Centraliza regras de sanitização e precedência, deixando explícito o comportamento esperado para payloads mistos.
- Permite validar mudanças futuras com testes de contrato dedicados (arquivo de testes específico).
