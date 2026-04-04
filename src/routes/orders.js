const express = require('express');
const router = express.Router();

const ordersCtrl = require('../controllers/ordersController');
const { authenticate } = require('../middleware/authMiddleware');
const { identifyStore } = require('../middleware/identifyStoreMiddleware');

/**
 * ===============================
 * PEDIDO PÚBLICO (CLIENTE FINAL)
 * ===============================
 * - SEM JWT
 * - Loja identificada por:
 *   - Header: X-LOJA-KEY
 *   - Query param
 */
router.post(
  '/',
  identifyStore,
  ordersCtrl.createOrder
);

router.get(
  '/pix/sessions/:id',
  identifyStore,
  ordersCtrl.getPublicPixSessionStatus
);

router.get(
  '/public/:id',
  identifyStore,
  ordersCtrl.getPublicOrderStatus
);

router.post(
  '/pix/callback',
  ordersCtrl.handlePixPaymentCallback
);

/**
 * ===============================
 * PAINEL ADMIN (PROTEGIDO)
 * ===============================
 * - JWT obrigatório
 * - Loja vem do token
 */
router.get(
  '/',
  authenticate,
  ordersCtrl.listOrders
);

router.get(
  '/stream',
  authenticate,
  ordersCtrl.streamOrders
);


router.post(
  '/:id/accept-transactional',
  authenticate,
  ordersCtrl.acceptTransactional
);

router.post(
  '/pdv-transactional',
  ordersCtrl.createPdvTransactional
);

router.get(
  '/:id',
  authenticate,
  ordersCtrl.getOrder
);

router.put(
  '/:id/status',
  authenticate,
  ordersCtrl.updateStatus
);

module.exports = router;
