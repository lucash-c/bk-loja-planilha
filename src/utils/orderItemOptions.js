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

function sanitizeOptionsArray(value) {
  if (!Array.isArray(value)) return null;

  return value
    .map(item => sanitizeOptionEntry(item))
    .filter(item => item !== null);
}

function parseOptionsJson(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : null;
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
