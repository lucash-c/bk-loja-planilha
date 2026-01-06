const express = require('express');
const router = express.Router();

const lojasCtrl = require('../controllers/lojasController');
const { authenticate } = require('../middleware/authMiddleware');

/**
 * TODAS AS ROTAS DE LOJA SÃO PROTEGIDAS
 * Requisitos:
 * - usuário autenticado
 * - loja selecionada no token (quando aplicável)
 */

router.post('/', authenticate, lojasCtrl.createLoja);
router.get('/', authenticate, lojasCtrl.listLojas);
router.get('/current', authenticate, lojasCtrl.getLoja);
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
