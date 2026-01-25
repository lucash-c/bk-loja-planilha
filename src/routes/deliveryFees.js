const express = require('express');
const router = express.Router();

const deliveryFeeController = require('../controllers/deliveryFeeController');
const { authenticate } = require('../middleware/authMiddleware');

/**
 * ============================
 * FRETES / TAXAS DE ENTREGA
 * ============================
 * Todas as rotas exigem:
 * - usuário autenticado
 * - loja resolvida pelo token
 */

// LISTAR faixas de frete da loja
router.get(
  '/',
  authenticate,
  deliveryFeeController.listDeliveryFees
);

// CRIAR ou ATUALIZAR faixa de frete (por distância)
router.post(
  '/',
  authenticate,
  deliveryFeeController.upsertDeliveryFee
);

// CRIAR ou ATUALIZAR faixas de frete (em lote)
router.post(
  '/batch',
  authenticate,
  deliveryFeeController.upsertDeliveryFeesBatch
);

// REMOVER faixa de frete
router.delete(
  '/:id',
  authenticate,
  deliveryFeeController.deleteDeliveryFee
);

// REMOVER faixas de frete (em lote)
router.delete(
  '/batch',
  authenticate,
  deliveryFeeController.deleteDeliveryFeesBatch
);

module.exports = router;
