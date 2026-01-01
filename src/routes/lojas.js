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

/**
 * Criar nova loja
 * Usuário vira OWNER da loja
 */
router.post('/', authenticate, lojasCtrl.createLoja);

/**
 * Listar lojas do usuário logado
 * Usado na tela de seleção de loja
 */
router.get('/', authenticate, lojasCtrl.listLojas);

/**
 * Obter dados da loja ativa (token)
 */
router.get('/current', authenticate, lojasCtrl.getLoja);

/**
 * Atualizar dados da loja ativa
 * Apenas OWNER
 */
router.put('/current', authenticate, lojasCtrl.updateLoja);

/**
 * Gerar nova public_key da loja
 * Apenas OWNER
 */
router.post(
  '/current/regenerate-key',
  authenticate,
  lojasCtrl.regeneratePublicKey
);

module.exports = router;
