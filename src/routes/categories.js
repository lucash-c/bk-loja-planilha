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
router.delete('/:id', authenticate, categoriesController.deleteCategory);

module.exports = router;
