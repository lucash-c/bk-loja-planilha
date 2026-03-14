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

const POST_PATHS = ['/pdv/push-subscriptions', '/push/subscriptions'];
const DELETE_ENDPOINT_PATHS = ['/pdv/push-subscriptions', '/push/subscriptions'];
const DELETE_ID_PATHS = ['/pdv/push-subscriptions/:id', '/push/subscriptions/:id'];

router.post(POST_PATHS, authenticate, pdvPushLimiter, ctrl.upsert);
router.delete(DELETE_ENDPOINT_PATHS, authenticate, pdvPushLimiter, ctrl.remove);
router.delete(DELETE_ID_PATHS, authenticate, pdvPushLimiter, ctrl.removeById);

module.exports = router;
