const express = require('express');
const router = express.Router();

const categoriesController = require('../controllers/categoriesController');
const { optionalAuthenticate } = require('../middleware/optionalAuth');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/', optionalAuthenticate, categoriesController.listCategories);
router.get(
  '/:id/products',
  optionalAuthenticate,
  categoriesController.listCategoryProducts
);
router.post('/', authenticate, categoriesController.createCategory);
router.put('/:id', authenticate, categoriesController.updateCategory);
router.patch('/:id/deactivate', authenticate, categoriesController.deactivateCategory);
router.patch('/:id/activate', authenticate, categoriesController.activateCategory);
router.delete('/:id/hard', authenticate, categoriesController.hardDeleteCategory);
// Compatibilidade: mantém endpoint legado de delete.
router.delete('/:id', authenticate, categoriesController.deleteCategory);

module.exports = router;
