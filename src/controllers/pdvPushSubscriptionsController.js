const {
  upsertSubscription,
  revokeSubscription
} = require('../services/pushNotificationService');

function validText(value, max = 4000) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

async function upsert(req, res, next) {
  try {
    if (req.tokenType !== 'store' || !req.loja?.id || !req.user?.id) {
      return res.status(403).json({ error: 'Escopo de loja inválido' });
    }

    const endpoint = validText(req.body?.endpoint);
    const p256dh = validText(req.body?.p256dh, 500);
    const auth = validText(req.body?.auth, 500);

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'Payload de subscription inválido' });
    }

    const result = await upsertSubscription({
      lojaId: req.loja.id,
      userId: req.user.id,
      endpoint,
      p256dh,
      auth
    });

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      id: result.id,
      created: result.created
    });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    if (req.tokenType !== 'store' || !req.loja?.id) {
      return res.status(403).json({ error: 'Escopo de loja inválido' });
    }

    const revoked = await revokeSubscription({
      subscriptionId: req.params.id,
      lojaId: req.loja.id
    });

    if (!revoked) {
      return res.status(404).json({ error: 'Subscription não encontrada' });
    }

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  upsert,
  remove
};
