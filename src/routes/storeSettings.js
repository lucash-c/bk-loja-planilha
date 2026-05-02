const express = require('express');
const router = express.Router();
const storeSettingsCtrl = require('../controllers/storeSettingsController');
const { authenticate } = require('../middleware/authMiddleware');

/**
 * Configurações da loja (PAINEL)
 * Todas protegidas por JWT + loja selecionada
 */
router.get('/', authenticate, storeSettingsCtrl.getSettings);
router.put('/', authenticate, storeSettingsCtrl.upsertSettings);
router.post('/heartbeat', authenticate, storeSettingsCtrl.heartbeat);

module.exports = router;
