const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const ctrl = require('../controllers/pdvPushSubscriptionsController');
const { authenticate } = require('../middleware/authMiddleware');

const pdvPushLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: req => `${req.loja?.id || 'no-store'}:${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/push-subscriptions', authenticate, pdvPushLimiter, ctrl.upsert);
router.delete('/push-subscriptions/:id', authenticate, pdvPushLimiter, ctrl.remove);

module.exports = router;
