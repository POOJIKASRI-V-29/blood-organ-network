import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import env, { isProduction } from './config/env.js';
import routes from './routes/index.js';
import errorHandler from './middleware/errorHandler.js';
import notFound from './middleware/notFound.js';

const app = express();

// Behind a proxy (or in Docker) req.ip must come from X-Forwarded-For.
app.set('trust proxy', 1);

app.use(helmet());

/**
 * CORS: only the configured frontend origin may call the API with credentials.
 * A comma-separated CORS_ORIGIN allows several (e.g. dev + preview builds).
 */
const allowedOrigins = env.corsOrigin.split(',').map((origin) => origin.trim());

/**
 * In development the Vite dev server may land on a different port than the one
 * configured (it increments when 5173 is already taken), so any loopback origin
 * is accepted. In production only the configured origins are allowed.
 */
const isLoopbackOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);          // curl, server-to-server
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (!isProduction && isLoopbackOrigin(origin)) return callback(null, true);

    const rejection = new Error(`Origin ${origin} is not permitted by CORS policy`);
    rejection.isCorsRejection = true;
    return callback(rejection);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

if (!isProduction) app.use(morgan('dev'));

// Broad ceiling on total traffic; credential endpoints add a tighter limit.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, please slow down.' } },
}));

app.use('/api', routes);

app.get('/', (_req, res) => res.json({
  name: 'Blood & Organ Availability Network API',
  version: '1.0.0',
  documentation: '/api/health',
}));

app.use(notFound);
app.use(errorHandler);

export default app;
