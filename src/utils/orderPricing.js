function normalizeMoney(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;
  return Number(numberValue.toFixed(2));
}

function normalizeQuantity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function calculateOptionsUnitTotal(options = []) {
  if (!Array.isArray(options)) return 0;

  return Number(
    options
      .reduce((sum, option) => {
        const optionPrice = normalizeMoney(option?.price);
        return sum + (optionPrice || 0);
      }, 0)
      .toFixed(2)
  );
}

/**
 * Regras canônicas de cálculo monetário (compatibilidade loja-online + PDV):
 * - unit_price representa o preço base unitário do produto.
 * - options[].price representa acréscimo unitário (quando informado).
 * - total_price do item é:
 *   1) item.total_price informado e válido (prioridade para legado), OU
 *   2) quantity * (unit_price + soma(options[].price)).
 * - total do pedido é:
 *   1) order.total informado e válido (prioridade para legado), OU
 *   2) soma(item.total_price) + delivery_fee apenas quando order_type = 'entrega'.
 */
function calculateOrderMonetarySummary({ items = [], total, delivery_fee, order_type }) {
  const normalizedItems = items.map(item => {
    const quantity = normalizeQuantity(item?.quantity);
    const unitPrice = normalizeMoney(item?.unit_price) || 0;
    const optionsUnitTotal = calculateOptionsUnitTotal(item?.resolvedOptions || item?.options || []);
    const calculatedTotal = Number((quantity * (unitPrice + optionsUnitTotal)).toFixed(2));
    const informedTotalPrice = normalizeMoney(item?.total_price);
    const totalPrice = informedTotalPrice ?? calculatedTotal;

    return {
      ...item,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      pricing_meta: {
        options_unit_total: optionsUnitTotal,
        used_informed_total_price: informedTotalPrice !== null
      }
    };
  });

  const itemsSubtotal = Number(
    normalizedItems
      .reduce((sum, item) => sum + (normalizeMoney(item.total_price) || 0), 0)
      .toFixed(2)
  );

  const normalizedDeliveryFee = normalizeMoney(delivery_fee) || 0;
  const normalizedOrderType = order_type || 'entrega';
  const appliesDeliveryFee = normalizedOrderType === 'entrega';
  const deliveryFeeApplied = appliesDeliveryFee ? normalizedDeliveryFee : 0;
  const calculatedTotal = Number((itemsSubtotal + deliveryFeeApplied).toFixed(2));
  const informedTotal = normalizeMoney(total);
  const orderTotal = informedTotal ?? calculatedTotal;

  return {
    items: normalizedItems,
    items_subtotal: itemsSubtotal,
    delivery_fee: normalizedDeliveryFee,
    delivery_fee_applied: deliveryFeeApplied,
    order_total: orderTotal,
    used_informed_order_total: informedTotal !== null
  };
}

module.exports = {
  normalizeMoney,
  calculateOrderMonetarySummary
};
