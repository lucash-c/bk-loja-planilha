const express = require('express');
const router = express.Router();

const productsController = require('../controllers/productsController');
const { authenticate } = require('../middleware/authMiddleware');

/**
 * ROTAS ADMINISTRATIVAS DE PRODUTOS
 */

// CREATE
router.post('/', authenticate, productsController.createProduct);

// LIST
router.get('/', authenticate, productsController.listProducts);

// GET BY ID
router.get('/:id', authenticate, productsController.getProductById);

// UPDATE
router.put('/:id', authenticate, productsController.updateProduct);

// DELETE (soft delete)
router.delete('/:id', authenticate, productsController.disableProduct);

/**
 * ROTAS DE OPÇÕES DE PRODUTO
 */

// Criar opção para um produto
router.post(
  '/:productId/options',
  authenticate,
  productsController.createProductOption
);

// Listar opções de um produto
router.get(
  '/:productId/options',
  authenticate,
  productsController.listProductOptions
);

// Criar item de opção (ex: sabores, adicionais)
router.post(
  '/options/:optionId/items',
  authenticate,
  productsController.createProductOptionItem
);

module.exports = router;
