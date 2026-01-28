const express = require('express');
const router = express.Router();

const lojasCtrl = require('../controllers/lojasController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminMiddleware');

/**
 * TODAS AS ROTAS DE LOJA SÃO PROTEGIDAS
 * Requisitos:
 * - usuário autenticado
 * - loja selecionada no token (quando aplicável)
 */

router.post('/', authenticate, lojasCtrl.createLoja);
router.get('/', authenticate, lojasCtrl.listLojas);

/**
 * ROTAS ADMINISTRATIVAS (admin)
 */
router.get('/admin', authenticate, requireAdmin, lojasCtrl.adminListLojas);
router.get('/admin/:id', authenticate, requireAdmin, lojasCtrl.adminGetLoja);
router.put('/admin/:id', authenticate, requireAdmin, lojasCtrl.adminUpdateLoja);
router.patch(
  '/admin/:id/status',
  authenticate,
  requireAdmin,
  lojasCtrl.adminUpdateLojaStatus
);
router.delete('/admin/:id', authenticate, requireAdmin, lojasCtrl.adminDeleteLoja);
router.get('/current', authenticate, lojasCtrl.getLoja);
router.get('/current/summary', authenticate, lojasCtrl.getLojaSummary);
router.put('/current', authenticate, lojasCtrl.updateLoja);

router.post(
  '/current/regenerate-key',
  authenticate,
  lojasCtrl.regeneratePublicKey
);

/**
 * CRÉDITOS (por loja_id)
 */
router.get('/:id/credits', authenticate, lojasCtrl.getLojaCredits);
router.post('/:id/credits/add', authenticate, lojasCtrl.addLojaCredits);
router.post('/:id/credits/consume', authenticate, lojasCtrl.consumeLojaCredits);

module.exports = router;
