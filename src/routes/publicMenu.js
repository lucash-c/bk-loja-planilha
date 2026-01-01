const express = require('express');
const router = express.Router();

const publicMenuCtrl = require('../controllers/publicMenuController');

/**
 * CARDÁPIO PÚBLICO
 * Acesso por public_key
 */
router.get('/menu/:public_key', publicMenuCtrl.getPublicMenu);

module.exports = router;