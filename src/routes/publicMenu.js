const express = require('express');
const router = express.Router();

const publicMenuCtrl = require('../controllers/publicMenuController');
const publicPixCtrl = require('../controllers/publicPixController');

/**
 * CARDÁPIO PÚBLICO
 * Acesso por public_key
 */
router.get('/menu/:public_key', publicMenuCtrl.getPublicMenu);
router.post('/pix/:public_key', publicPixCtrl.generateCheckoutPix);

module.exports = router;
