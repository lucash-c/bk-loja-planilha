require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
const pdvPushSubscriptionsRoutes = require('./routes/pdvPushSubscriptions');
const { errorHandler } = require('./middleware/errorHandler');
const {
  getActiveRelease,
  getReleaseMetaPath,
  getReleasesDir,
  readReleaseMeta
} = require('./config/frontendReleaseResolver');

function hasFileExtension(urlPath) {
  const lastSegment = urlPath.split('/').pop() || '';
  return lastSegment.includes('.');
}

function rewriteIndexReleasePrefix(html, releaseId) {
  return html.replace(/\/releases\/[^/]+\//g, `/releases/${releaseId}/`);
}

function sendReleaseIndex({ releasesDir, releaseId, res, next }) {
  const releaseIndexPath = path.join(releasesDir, releaseId, 'index.html');

  if (!fs.existsSync(releaseIndexPath)) {
    return next();
  }

  const rawHtml = fs.readFileSync(releaseIndexPath, 'utf8');
  const html = rewriteIndexReleasePrefix(rawHtml, releaseId);

  res.set('Cache-Control', 'no-store, must-revalidate');
  res.type('html');
  return res.send(html);
}

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

  const releasesDir = getReleasesDir();

  app.get('/release-meta.json', (req, res) => {
    const releaseMetaPath = getReleaseMetaPath();
    if (!fs.existsSync(releaseMetaPath)) {
      return res.status(404).json({ error: 'release-meta.json not found' });
    }

    res.set('Cache-Control', 'no-store, must-revalidate');
    return res.sendFile(releaseMetaPath);
  });

  app.get('/releases/:releaseId', (req, res) => res.redirect(302, `/releases/${req.params.releaseId}/`));
  app.get('/releases/:releaseId/', (req, res, next) =>
    sendReleaseIndex({ releasesDir, releaseId: req.params.releaseId, res, next })
  );
  app.get('/releases/:releaseId/index.html', (req, res, next) =>
    sendReleaseIndex({ releasesDir, releaseId: req.params.releaseId, res, next })
  );

  app.use(
    '/releases',
    express.static(releasesDir, {
      index: false,
      fallthrough: true,
      setHeaders: (res, filePath) => {
        const normalized = filePath.split(path.sep).join('/');
        if (normalized.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    })
  );

  app.get('/releases/:releaseId/*', (req, res, next) => {
    if (hasFileExtension(req.path)) {
      return next();
    }

    return sendReleaseIndex({ releasesDir, releaseId: req.params.releaseId, res, next });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/products', productsRoutes);
  app.use('/categories', categoriesRoutes);
  app.use('/option-groups', optionGroupsRoutes);
  app.use('/api/lojas', lojasRoutes);
  app.use('/api/store-settings', storeSettingsRoutes);
  app.use('/api/delivery-fees', deliveryFeesRoutes);
  app.use('/api/store-payment-methods', storePaymentMethodsRoutes);
  app.use('/api/pdv', pdvPushSubscriptionsRoutes);
  app.use('/public', publicMenuRoutes);

  app.get('/', (req, res) => {
    const activeRelease = getActiveRelease();
    if (!activeRelease) {
      return res.status(503).json({ error: 'active release unavailable' });
    }

    return res.redirect(302, `/releases/${activeRelease}/`);
  });

  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    const activeRelease = getActiveRelease();
    const releaseText = activeRelease ? `active release ${activeRelease}` : 'active release unavailable';
    const meta = readReleaseMeta();
    const releaseMetaState = meta ? 'release-meta loaded' : 'release-meta not found';
    console.log(`Server listening on ${port} (${releaseText}; ${releaseMetaState})`);
  });
}

module.exports = { createApp };
