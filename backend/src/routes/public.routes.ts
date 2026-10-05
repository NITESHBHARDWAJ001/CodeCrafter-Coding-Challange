import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, parse } from '../middleware/http';
import { authService, registerSchema } from '../services/auth.service';
import { certificateService } from '../services/certificate.service';

export const publicRoutes = Router();

publicRoutes.get('/health', (_req, res) => { res.json({ ok: true, time: new Date().toISOString() }); });

const registerLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-up attempts. Try again later.' } },
});

publicRoutes.post('/auth/register', registerLimiter, asyncHandler(async (req, res) => {
  const input = parse(registerSchema, req.body);
  const { profile, emailConfirmationRequired } = await authService.register(input);
  res.status(201).json({
    profile: { id: profile.id, full_name: profile.full_name, leetcode_username: profile.leetcode_username, level: profile.level },
    email_confirmation_required: emailConfirmationRequired,
  });
}));

const verifyLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
publicRoutes.get('/verify/:code', verifyLimiter, asyncHandler(async (req, res) => {
  const result = await certificateService.verify(String(req.params.code));
  res.status(result.verified ? 200 : 404).json(result);
}));
