const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authCtrl = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

/**
 * LOGIN
 * Retorna usuário + lista de lojas
 * NÃO gera token
 */
router.post(
  '/login',
  [
    body('email').isEmail(),
    body('password').isString().notEmpty()
  ],
  authCtrl.login
);

/**
 * SELECT STORE
 * Gera JWT com loja_id
 * REQUER usuário autenticado
 */
router.post(
  '/select-store',
  authenticate,
  [
    body('loja_id').isUUID()
  ],
  authCtrl.selectStore
);

/**
 * REGISTER
 * Cria usuário (use com cuidado em produção)
 */

/**
 * REGISTER WITH STORE
 * Cria usuário + loja + vínculo owner em uma única requisição
 */
router.post(
  '/register-with-store',
  [
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('name').optional().isString(),
    body('role')
      .optional()
      .isIn(['admin', 'owner'])
      .withMessage('Role inválido. Valores permitidos: admin, owner'),
    body('loja').isObject(),
    body('loja.name').isString().notEmpty(),
    body('loja.whatsapp').isString().notEmpty(),
    body('loja.telefone').optional().isString(),
    body('loja.responsavel_nome').isString().notEmpty(),
    body('loja.email').isEmail(),
    body('loja.cpf_cnpj').isString().notEmpty(),
    body('loja.pais').isString().notEmpty(),
    body('loja.estado').isString().notEmpty(),
    body('loja.cidade').isString().notEmpty(),
    body('loja.bairro').isString().notEmpty(),
    body('loja.rua').isString().notEmpty(),
    body('loja.numero').isString().notEmpty(),
    body('loja.cep').isString().notEmpty(),
    body('loja.facebook').optional().isString(),
    body('loja.instagram').optional().isString(),
    body('loja.tiktok').optional().isString(),
    body('loja.logo').isString().notEmpty()
  ],
  authCtrl.registerWithStore
);

router.post(
  '/register',
  [
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('name').optional().isString(),
    body('role')
      .optional()
      .isIn(['admin', 'owner'])
      .withMessage('Role inválido. Valores permitidos: admin, owner')
  ],
  authCtrl.register
);

/**
 * FORGOT PASSWORD
 * Envia código por e-mail
 */
router.post(
  '/forgot',
  [
    body('email').isEmail()
  ],
  authCtrl.forgotPassword
);

/**
 * RESET PASSWORD
 * Confirma código e altera senha
 */
router.post(
  '/reset',
  [
    body('email').isEmail(),
    body('code').isLength({ min: 5 }),
    body('newPassword').isLength({ min: 6 })
  ],
  authCtrl.resetPassword
);

module.exports = router;
