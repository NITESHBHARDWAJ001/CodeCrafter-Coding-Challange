import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { publicRoutes } from './routes/public.routes';
import { studentRoutes } from './routes/student.routes';
import { adminRoutes } from './routes/admin.routes';
import { errorHandler, notFoundHandler } from './middleware/http';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: false, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '3mb' })); // bulk CSV can be large
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

  app.use('/api', publicRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', studentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
