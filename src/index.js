require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const ordersRoutes = require('./routes/orders');
const lojasRoutes = require('./routes/lojas');
const storeSettingsRoutes = require('./routes/storeSettings');
const publicMenuRoutes = require('./routes/publicMenu');
const productsRoutes = require('./routes/products');
const categoriesRoutes = require('./routes/categories');
const optionGroupsRoutes = require('./routes/optionGroups');
const deliveryFeesRoutes = require('./routes/deliveryFees');
const storePaymentMethodsRoutes = require('./routes/storePaymentMethods');
const { errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json());
  app.use(cors({ origin: '*' }));

  const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120
  });
  app.use(limiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/products', productsRoutes);
  app.use('/categories', categoriesRoutes);
  app.use('/option-groups', optionGroupsRoutes);
  app.use('/api/lojas', lojasRoutes);
  app.use('/api/store-settings', storeSettingsRoutes);
  app.use('/api/delivery-fees', deliveryFeesRoutes);
  app.use('/api/store-payment-methods', storePaymentMethodsRoutes);
  app.use('/public', publicMenuRoutes);

  app.get('/', (req, res) => res.json({ ok: true, version: '1.0' }));

  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`Server listening on ${port}`));
}

module.exports = { createApp };
