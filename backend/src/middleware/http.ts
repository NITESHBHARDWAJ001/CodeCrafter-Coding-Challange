import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';
import { authService } from '../services/auth.service';
import type { Profile } from '../types/db';

declare module 'express-serve-static-core' {
  interface Request { user?: Profile }
}

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();
  req.user = await authService.authenticate(token);
  next();
});

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') return next(forbidden('Admin access required'));
  next();
};

/** Parse + validate; throws a 400 with field errors. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', r.error.flatten());
  return r.data;
}

export const pageParams = (req: Request, max = 200) => ({
  limit: Math.min(max, Math.max(1, Number(req.query.limit) || 50)),
  offset: Math.max(0, Number(req.query.offset) || 0),
});

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten() } });
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  logger.error({ err }, 'unhandled error');
  // Never leak internals (SQL, stack traces) to clients.
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
