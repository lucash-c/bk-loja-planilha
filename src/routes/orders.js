const express = require('express');
const router = express.Router();
const ordersCtrl = require('../controllers/ordersController');
const { authenticate } = require('../middleware/authMiddleware');

// criar pedido (pode ser chamado pelo frontend cliente)
router.post('/', ordersCtrl.createOrder);

// listar pedidos (protegido)
router.get('/', authenticate, ordersCtrl.listOrders);

// obter um pedido (protegido)
router.get('/:id', authenticate, ordersCtrl.getOrder);

// atualizar status (protegido)
router.put('/:id/status', authenticate, ordersCtrl.updateStatus);

module.exports = router;
