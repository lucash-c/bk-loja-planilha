const { generatePublicPix } = require('../services/publicPixService');

async function generateCheckoutPix(req, res, next) {
  try {
    const result = await generatePublicPix({
      publicKey: req.params.public_key,
      amount: req.body?.amount,
      description: req.body?.description
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.status(200).json({
      ok: true,
      pix: result.pix
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  generateCheckoutPix
};
