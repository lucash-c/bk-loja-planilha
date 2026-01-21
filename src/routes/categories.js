const express = require('express');
const router = express.Router();

const categoriesController = require('../controllers/categoriesController');
const { optionalAuthenticate } = require('../middleware/optionalAuth');

router.get('/', optionalAuthenticate, categoriesController.listCategories);
router.get(
  '/:id/products',
  optionalAuthenticate,
  categoriesController.listCategoryProducts
);

module.exports = router;
