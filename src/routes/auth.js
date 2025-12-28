const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authCtrl = require('../controllers/authController');

// login
router.post('/login', [
  body('email').isEmail(),
  body('password').isString().notEmpty()
], authCtrl.login);

// criar usuário admin (use só uma vez; proteja em produção)
router.post('/register', [
  body('email').isEmail(),
  body('password').isLength({ min: 6 })
], authCtrl.register);

// esqueci senha -> envia código
router.post('/forgot', [ body('email').isEmail() ], authCtrl.forgotPassword);

// reset com código
router.post('/reset', [
  body('email').isEmail(),
  body('code').isLength({ min: 5 }),
  body('newPassword').isLength({ min: 6 })
], authCtrl.resetPassword);

module.exports = router;
