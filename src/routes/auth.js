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
