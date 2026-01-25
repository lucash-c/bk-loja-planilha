const express = require('express');
const router = express.Router();

const optionGroupsController = require('../controllers/optionGroupsController');
const { authenticate } = require('../middleware/authMiddleware');

router.get('/', authenticate, optionGroupsController.listOptionGroups);
router.post('/bulk', authenticate, optionGroupsController.bulkCreateOptionGroups);
router.put('/bulk', authenticate, optionGroupsController.bulkUpdateOptionGroups);
router.delete('/bulk', authenticate, optionGroupsController.bulkDeleteOptionGroups);

module.exports = router;
