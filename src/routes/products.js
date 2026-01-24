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

// DELETE (hard delete)
router.delete('/:id', authenticate, productsController.disableProduct);

/**
 * ROTAS DE GRUPOS DE OPÇÕES
 */

router.post(
  '/option-groups/bulk-attach',
  authenticate,
  productsController.bulkAttachOptionGroups
);

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

// Atualizar opção de um produto
router.put(
  '/:productId/options/:optionId',
  authenticate,
  productsController.updateProductOption
);

// Remover opção de um produto (hard delete)
router.delete(
  '/:productId/options/:optionId',
  authenticate,
  productsController.deleteProductOption
);

// Criar item de opção (ex: sabores, adicionais...)
router.post(
  '/options/:optionId/items',
  authenticate,
  productsController.createProductOptionItem
);

// Listar itens de opção (ex: mussarela, bacon...)
router.get(
  '/options/:optionId/items',
  authenticate,
  productsController.listProductOptionItems
);

// Atualizar item de opção
router.put(
  '/options/:optionId/items/:itemId',
  authenticate,
  productsController.updateProductOptionItem
);

// Remover item de opção (hard delete)
router.delete(
  '/options/:optionId/items/:itemId',
  authenticate,
  productsController.deleteProductOptionItem
);

module.exports = router;
