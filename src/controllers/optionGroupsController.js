const db = require('../config/db');

function normalizeName(value) {
  return String(value || '').trim();
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items;
}

function findDuplicateNames(records) {
  const seen = new Map();
  const duplicates = new Set();

  records.forEach((record, index) => {
    const name = normalizeName(record.name).toLowerCase();
    if (!name) {
      return;
    }
    if (seen.has(name)) {
      duplicates.add(index);
      duplicates.add(seen.get(name));
    } else {
      seen.set(name, index);
    }
  });

  return duplicates;
}

function findDuplicateGroupNames(groups) {
  const seen = new Map();
  const duplicates = new Set();

  groups.forEach((group, index) => {
    if (!group || group.name === undefined) {
      return;
    }
    const name = normalizeName(group.name).toLowerCase();
    if (!name) {
      return;
    }
    if (seen.has(name)) {
      duplicates.add(index);
      duplicates.add(seen.get(name));
    } else {
      seen.set(name, index);
    }
  });

  return duplicates;
}

async function listOptionGroups(req, res) {
  try {
    const lojaId = req.loja.id;

    const groupsRes = await db.query(
      `
      SELECT
        id,
        name,
        type,
        required,
        min_choices,
        max_choices,
        is_active,
        created_at
      FROM option_groups
      WHERE loja_id = $1
      ORDER BY created_at DESC
      `,
      [lojaId]
    );

    const groupIds = groupsRes.rows.map(row => row.id);

    if (!groupIds.length) {
      return res.json([]);
    }

    const placeholders = groupIds
      .map((_, index) => `$${index + 1}`)
      .join(',');

    const itemsRes = await db.query(
      `
      SELECT
        id,
        option_group_id,
        name,
        price,
        is_active,
        is_visible,
        created_at
      FROM option_group_items
      WHERE option_group_id IN (${placeholders})
      ORDER BY created_at ASC
      `,
      groupIds
    );

    const itemsByGroup = new Map();

    itemsRes.rows.forEach(item => {
      if (!itemsByGroup.has(item.option_group_id)) {
        itemsByGroup.set(item.option_group_id, []);
      }
      itemsByGroup.get(item.option_group_id).push(item);
    });

    const payload = groupsRes.rows.map(group => ({
      ...group,
      items: itemsByGroup.get(group.id) || []
    }));

    return res.json(payload);
  } catch (err) {
    console.error('Erro ao listar grupos de adicionais:', err);
    return res.status(500).json({ error: 'Erro interno ao listar grupos' });
  }
}

async function createGroupWithItems({ lojaId, group }) {
  const errors = [];
  const name = normalizeName(group.name);

  if (!name) {
    return {
      error: 'name é obrigatório'
    };
  }

  const items = normalizeItems(group.items);
  const itemDuplicates = findDuplicateNames(items);

  if (itemDuplicates.size) {
    return {
      error: 'Itens duplicados no grupo'
    };
  }

  const type = group.type || 'single';
  const required = group.required ?? false;
  const minChoices = group.min_choices ?? 0;
  const maxChoices = group.max_choices ?? 1;
  const isActive = group.is_active ?? true;

  await db.query('BEGIN');

  try {
    const conflictCheck = await db.query(
      `
      SELECT id
      FROM option_groups
      WHERE loja_id = $1
        AND lower(name) = lower($2)
      `,
      [lojaId, name]
    );

    if (conflictCheck.rows.length) {
      await db.query('ROLLBACK');
      return { error: 'Já existe um grupo com este nome para a loja' };
    }

    const groupRes = await db.query(
      `
      INSERT INTO option_groups (
        loja_id,
        name,
        type,
        required,
        min_choices,
        max_choices,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        lojaId,
        name,
        type,
        required,
        minChoices,
        maxChoices,
        isActive
      ]
    );

    const createdGroup = groupRes.rows[0];
    const itemResults = [];

    for (const item of items) {
      const itemName = normalizeName(item.name);
      if (!itemName) {
        errors.push('Item com name obrigatório');
        continue;
      }

      const price = item.price ?? 0;
      const itemIsActive = item.is_active ?? true;
      const itemIsVisible = item.is_visible ?? true;

      const itemRes = await db.query(
        `
        INSERT INTO option_group_items (
          option_group_id,
          name,
          price,
          is_active,
          is_visible
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [createdGroup.id, itemName, price, itemIsActive, itemIsVisible]
      );

      if (itemRes.rows[0]) {
        itemResults.push(itemRes.rows[0]);
      }
    }

    if (errors.length) {
      await db.query('ROLLBACK');
      return { error: errors.join(', ') };
    }

    await db.query('COMMIT');

    return {
      group: createdGroup,
      items: itemResults
    };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function bulkCreateOptionGroups(req, res) {
  const lojaId = req.loja.id;
  const groups = req.body;

  if (!Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ error: 'Payload deve ser um array de grupos' });
  }

  const response = {
    created: [],
    errors: []
  };

  const duplicates = findDuplicateGroupNames(groups);

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];

    if (duplicates.has(index)) {
      response.errors.push({
        index,
        error: 'Nome de grupo duplicado no payload'
      });
      continue;
    }

    try {
      const result = await createGroupWithItems({ lojaId, group });

      if (result.error) {
        response.errors.push({
          index,
          error: result.error
        });
        continue;
      }

      response.created.push({
        index,
        id: result.group.id,
        item_ids: result.items.map(item => item.id)
      });
    } catch (err) {
      console.error('Erro ao criar grupo de adicionais:', err);
      response.errors.push({
        index,
        error: 'Erro interno ao criar grupo'
      });
    }
  }

  return res.status(201).json(response);
}

async function updateGroupWithItems({ lojaId, group }) {
  const groupId = group.id;

  if (!groupId) {
    return { error: 'id é obrigatório para atualização' };
  }

  const name = normalizeName(group.name);
  const type = group.type;
  const required = group.required;
  const minChoices = group.min_choices;
  const maxChoices = group.max_choices;
  const isActive = group.is_active;

  await db.query('BEGIN');

  try {
    const existingRes = await db.query(
      `
      SELECT id
      FROM option_groups
      WHERE id = $1
        AND loja_id = $2
      `,
      [groupId, lojaId]
    );

    if (!existingRes.rows.length) {
      await db.query('ROLLBACK');
      return { error: 'Grupo não encontrado' };
    }

    if (name) {
      const conflictRes = await db.query(
        `
        SELECT id
        FROM option_groups
        WHERE loja_id = $1
          AND lower(name) = lower($2)
          AND id <> $3
        `,
        [lojaId, name, groupId]
      );

      if (conflictRes.rows.length) {
        await db.query('ROLLBACK');
        return { error: 'Já existe um grupo com este nome para a loja' };
      }
    }

    const updateRes = await db.query(
      `
      UPDATE option_groups
      SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        required = COALESCE($3, required),
        min_choices = COALESCE($4, min_choices),
        max_choices = COALESCE($5, max_choices),
        is_active = COALESCE($6, is_active)
      WHERE id = $7
        AND loja_id = $8
      RETURNING *
      `,
      [
        name || null,
        type ?? null,
        required ?? null,
        minChoices ?? null,
        maxChoices ?? null,
        isActive ?? null,
        groupId,
        lojaId
      ]
    );

    const updatedGroup = updateRes.rows[0];

    const itemsPayload = normalizeItems(group.items);
    const createdItemIds = [];
    const updatedItemIds = [];
    const deletedItemIds = [];

    if (group.items !== undefined) {
      const itemDuplicates = findDuplicateNames(itemsPayload);
      if (itemDuplicates.size) {
        await db.query('ROLLBACK');
        return { error: 'Itens duplicados no grupo' };
      }

      const existingItemsRes = await db.query(
        `
        SELECT id
        FROM option_group_items
        WHERE option_group_id = $1
        `,
        [groupId]
      );

      const existingItems = new Set(existingItemsRes.rows.map(row => row.id));
      const payloadItemIds = new Set();

      for (const item of itemsPayload) {
        const itemName = normalizeName(item.name);
        if (!itemName) {
          await db.query('ROLLBACK');
          return { error: 'Item com name obrigatório' };
        }

        const price = item.price ?? 0;
        const itemIsActive = item.is_active ?? true;
        const itemIsVisible = item.is_visible ?? true;

        if (item.id && existingItems.has(item.id)) {
          const itemRes = await db.query(
            `
            UPDATE option_group_items
            SET
              name = COALESCE($1, name),
              price = COALESCE($2, price),
              is_active = COALESCE($3, is_active),
              is_visible = COALESCE($4, is_visible)
            WHERE id = $5
              AND option_group_id = $6
            RETURNING *
            `,
            [itemName, price, itemIsActive, itemIsVisible, item.id, groupId]
          );

          if (itemRes.rows[0]) {
            updatedItemIds.push(itemRes.rows[0].id);
            payloadItemIds.add(itemRes.rows[0].id);
          }
        } else {
          const itemRes = await db.query(
            `
            INSERT INTO option_group_items (
              option_group_id,
              name,
              price,
              is_active,
              is_visible
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `,
            [groupId, itemName, price, itemIsActive, itemIsVisible]
          );

          if (itemRes.rows[0]) {
            createdItemIds.push(itemRes.rows[0].id);
            payloadItemIds.add(itemRes.rows[0].id);
          }
        }
      }

      existingItems.forEach(existingId => {
        if (!payloadItemIds.has(existingId)) {
          deletedItemIds.push(existingId);
        }
      });

      if (deletedItemIds.length) {
        const placeholders = deletedItemIds
          .map((_, index) => `$${index + 1}`)
          .join(',');

        await db.query(
          `
          DELETE FROM option_group_items
          WHERE id IN (${placeholders})
            AND option_group_id = $${deletedItemIds.length + 1}
          `,
          [...deletedItemIds, groupId]
        );
      }
    }

    await db.query('COMMIT');

    return {
      group: updatedGroup,
      item_changes: {
        created: createdItemIds,
        updated: updatedItemIds,
        deleted: deletedItemIds
      }
    };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function bulkUpdateOptionGroups(req, res) {
  const lojaId = req.loja.id;
  const groups = req.body;

  if (!Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ error: 'Payload deve ser um array de grupos' });
  }

  const response = {
    updated: [],
    errors: []
  };

  const duplicates = findDuplicateGroupNames(groups);

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];

    if (group.name && duplicates.has(index)) {
      response.errors.push({
        index,
        error: 'Nome de grupo duplicado no payload'
      });
      continue;
    }

    try {
      const result = await updateGroupWithItems({ lojaId, group });

      if (result.error) {
        response.errors.push({
          index,
          error: result.error
        });
        continue;
      }

      response.updated.push({
        index,
        id: result.group.id,
        item_changes: result.item_changes
      });
    } catch (err) {
      console.error('Erro ao atualizar grupo de adicionais:', err);
      response.errors.push({
        index,
        error: 'Erro interno ao atualizar grupo'
      });
    }
  }

  return res.json(response);
}

async function bulkDeleteOptionGroups(req, res) {
  const lojaId = req.loja.id;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids é obrigatório' });
  }

  const response = {
    deleted: [],
    errors: []
  };

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];

    if (!id) {
      response.errors.push({
        index,
        error: 'id inválido'
      });
      continue;
    }

    await db.query('BEGIN');

    try {
      const deleteRes = await db.query(
        `
        DELETE FROM option_groups
        WHERE id = $1
          AND loja_id = $2
        RETURNING id
        `,
        [id, lojaId]
      );

      if (!deleteRes.rows.length) {
        await db.query('ROLLBACK');
        response.errors.push({
          index,
          error: 'Grupo não encontrado'
        });
        continue;
      }

      await db.query('COMMIT');

      response.deleted.push({
        index,
        id: deleteRes.rows[0].id
      });
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Erro ao excluir grupo de adicionais:', err);
      response.errors.push({
        index,
        error: 'Erro interno ao excluir grupo'
      });
    }
  }

  return res.json(response);
}

module.exports = {
  listOptionGroups,
  bulkCreateOptionGroups,
  bulkUpdateOptionGroups,
  bulkDeleteOptionGroups
};
