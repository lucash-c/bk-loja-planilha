require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const ordersRoutes = require('./routes/orders');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(express.json());

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:8080';
//app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(cors({ origin: "*" }));


const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120
});
app.use(limiter);

app.use('/api/auth', authRoutes);
app.use('/api/orders', ordersRoutes);

app.get('/', (req, res) => res.json({ ok: true, version: '1.0' }));

// error handler
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on ${port}`));
