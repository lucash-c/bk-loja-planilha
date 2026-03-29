function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeOptionValue(value, seen = new WeakSet()) {
  if (value === null) return null;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value) ? value : null;
  if (
    type === 'undefined' ||
    type === 'function' ||
    type === 'symbol' ||
    type === 'bigint'
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeOptionValue(item, seen))
      .filter(item => item !== undefined);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedNested = sanitizeOptionValue(nestedValue, seen);
    if (normalizedNested !== undefined) {
      sanitized[key] = normalizedNested;
    }
  }

  seen.delete(value);
  return sanitized;
}

function sanitizeOptionsArray(value) {
  if (!Array.isArray(value)) return null;

  return value
    .map(item => sanitizeOptionValue(item))
    .filter(item => item !== undefined);
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
  if (!parsedOptionsJson) return null;

  return sanitizeOptionsArray(parsedOptionsJson);
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
