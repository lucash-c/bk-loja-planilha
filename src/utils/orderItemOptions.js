function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const OPTION_WHITELIST_FIELDS = [
  'option_id',
  'option_name',
  'item_id',
  'item_name',
  'price'
];

const OPTION_GROUP_NAME_KEYS = ['option_name', 'group_name', 'name', 'label', 'title'];
const OPTION_GROUP_ID_KEYS = ['option_id', 'group_id', 'id', 'optionGroupId', 'groupId'];
const OPTION_ITEM_ARRAY_KEYS = [
  'items',
  'selected_items',
  'selectedOptions',
  'selected_options',
  'option_items',
  'optionItems',
  'selectedItems',
  'itens'
];
const OPTION_ITEM_NAME_KEYS = ['item_name', 'name', 'label', 'title'];
const OPTION_ITEM_ID_KEYS = ['item_id', 'id', 'option_item_id', 'optionItemId'];
const OPTION_ITEM_PRICE_KEYS = ['price', 'unit_price', 'additional_price', 'extra_price', 'value'];
const OPTION_CONTAINER_KEYS = ['options', 'option_groups', 'groups', 'selected_options'];

function sanitizeStringField(value) {
  if (value === null || typeof value === 'undefined') return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function sanitizePriceField(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return null;
  return Number(normalized.toFixed(2));
}

function readFirstField(objectValue, keys) {
  if (!isPlainObject(objectValue)) return null;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(objectValue, key)) continue;
    return objectValue[key];
  }

  return null;
}

function sanitizeOptionEntry(value) {
  if (!isPlainObject(value)) return null;

  const sanitized = {};
  for (const field of OPTION_WHITELIST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;

    if (field === 'price') {
      const normalizedPrice = sanitizePriceField(value[field]);
      if (normalizedPrice !== null) {
        sanitized.price = normalizedPrice;
      }
      continue;
    }

    const normalizedString = sanitizeStringField(value[field]);
    if (normalizedString !== null) {
      sanitized[field] = normalizedString;
    }
  }

  const hasUsefulMinimumFields = Boolean(sanitized.option_name || sanitized.item_name);
  if (!hasUsefulMinimumFields) return null;

  return sanitized;
}

function normalizeFlatOptionEntry(value) {
  return sanitizeOptionEntry(value);
}

function normalizeGroupedOptionEntry(groupValue) {
  if (!isPlainObject(groupValue)) return [];

  const groupName = sanitizeStringField(readFirstField(groupValue, OPTION_GROUP_NAME_KEYS));
  const groupId = sanitizeStringField(readFirstField(groupValue, OPTION_GROUP_ID_KEYS));
  const groupedItemsRaw = readFirstField(groupValue, OPTION_ITEM_ARRAY_KEYS);

  if (!Array.isArray(groupedItemsRaw)) {
    const maybeFlat = normalizeFlatOptionEntry(groupValue);
    return maybeFlat ? [maybeFlat] : [];
  }

  return groupedItemsRaw
    .map(item => {
      if (!isPlainObject(item)) return null;

      const itemName = sanitizeStringField(readFirstField(item, OPTION_ITEM_NAME_KEYS));
      const itemId = sanitizeStringField(readFirstField(item, OPTION_ITEM_ID_KEYS));
      const priceRaw = readFirstField(item, OPTION_ITEM_PRICE_KEYS);
      const sanitized = sanitizeOptionEntry({
        option_id: groupId || readFirstField(item, OPTION_GROUP_ID_KEYS),
        option_name: groupName || sanitizeStringField(readFirstField(item, OPTION_GROUP_NAME_KEYS)),
        item_id: itemId,
        item_name: itemName,
        price: priceRaw
      });
      return sanitized;
    })
    .filter(item => item !== null);
}

function unwrapOptionCandidates(value) {
  if (Array.isArray(value)) return value;

  if (!isPlainObject(value)) return null;

  for (const key of OPTION_CONTAINER_KEYS) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }

  return [value];
}

function sanitizeOptionsArray(value) {
  const candidates = unwrapOptionCandidates(value);
  if (!candidates) return null;

  return candidates.flatMap(item => normalizeGroupedOptionEntry(item));
}

function parseOptionsJson(value) {
  if (Array.isArray(value) || isPlainObject(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) || isPlainObject(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function resolveOrderItemOptions(item = {}) {
  const options = sanitizeOptionsArray(item.options);
  if (options) return options;

  const parsedOptionsJson = parseOptionsJson(item.options_json);
  if (!parsedOptionsJson) return [];

  return sanitizeOptionsArray(parsedOptionsJson) || [];
}

function deserializeOptions(optionsJson) {
  try {
    if (Array.isArray(optionsJson)) {
      return sanitizeOptionsArray(optionsJson) || [];
    }

    if (typeof optionsJson !== 'string') {
      return [];
    }

    const trimmed = optionsJson.trim();
    if (!trimmed) {
      return [];
    }

    const parsed = JSON.parse(trimmed);
    return sanitizeOptionsArray(parsed) || [];
  } catch (err) {
    return [];
  }
}

function normalizeItemForResponse(item = {}) {
  const options = deserializeOptions(item.options_json);

  return {
    ...item,
    options_json: options.length ? options : null,
    options
  };
}

module.exports = {
  resolveOrderItemOptions,
  deserializeOptions,
  normalizeItemForResponse
};
