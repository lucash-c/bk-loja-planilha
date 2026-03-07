const express = require('express');
const router = express.Router();

const storePaymentMethodsCtrl = require('../controllers/storePaymentMethodsController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/', authenticate, storePaymentMethodsCtrl.listPaymentMethods);
router.post('/', authenticate, storePaymentMethodsCtrl.createPaymentMethod);
router.put('/:id', authenticate, storePaymentMethodsCtrl.updatePaymentMethod);
router.patch('/:id', authenticate, storePaymentMethodsCtrl.updatePaymentMethod);
router.delete('/:id', authenticate, storePaymentMethodsCtrl.deletePaymentMethod);

module.exports = router;
