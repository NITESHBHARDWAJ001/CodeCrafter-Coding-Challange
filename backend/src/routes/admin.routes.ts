import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, authenticate, pageParams, parse, requireAdmin } from '../middleware/http';
import { programService, programCreateSchema, programUpdateSchema, rulesSchema, withEffective } from '../services/program.service';
import { challengeInputSchema, challengeService } from '../services/challenge.service';
import { importBodySchema } from '../domain/csv';
import { adminService } from '../services/admin.service';
import { certificateService } from '../services/certificate.service';
import { syncService, syncSettingsSchema } from '../services/sync.service';
import { schedulerService } from '../jobs/scheduler';
import { programsRepo } from '../repositories/programs.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { profilesRepo } from '../repositories/profiles.repo';
import { syncRepo } from '../repositories/sync.repo';
import { progressService } from '../services/progress.service';
import { badRequest, conflict, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import { LEETCODE_USERNAME, leetcodeUserExists } from '../services/auth.service';

export const adminRoutes = Router();
adminRoutes.use(authenticate, requireAdmin);

const id = (v: unknown) => parse(z.string().uuid(), v);

adminRoutes.get('/overview', asyncHandler(async (_req, res) => { res.json(await adminService.overview()); }));

// ───── programs ─────
adminRoutes.get('/programs', asyncHandler(async (_req, res) => {
  const programs = await programsRepo.list();
  const withCounts = await Promise.all(programs.map(async (p) => ({ ...withEffective(p), participants: await participantsRepo.countEnrolled(p.id) })));
  res.json({ programs: withCounts });
}));
adminRoutes.post('/programs', asyncHandler(async (req, res) => {
  res.status(201).json({ program: withEffective(await programService.create(parse(programCreateSchema, req.body), req.user!.id)) });
}));
adminRoutes.get('/programs/:programId', asyncHandler(async (req, res) => {
  res.json({ program: await adminService.programSummary(id(req.params.programId)) });
}));
adminRoutes.patch('/programs/:programId', asyncHandler(async (req, res) => {
  res.json({ program: withEffective(await programService.update(id(req.params.programId), parse(programUpdateSchema, req.body))) });
}));
adminRoutes.delete('/programs/:programId', asyncHandler(async (req, res) => {
  await programService.remove(id(req.params.programId));
  res.status(204).end();
}));

// ───── challenges + bulk CSV ─────
adminRoutes.get('/programs/:programId/challenges', asyncHandler(async (req, res) => {
  res.json({ challenges: await challengeService.listForAdmin(id(req.params.programId)) });
}));
adminRoutes.post('/programs/:programId/challenges', asyncHandler(async (req, res) => {
  res.status(201).json({ challenge: await challengeService.create(id(req.params.programId), parse(challengeInputSchema, req.body)) });
}));
// Step 1: validate only (nothing is written). Accepts raw CSV text or already-parsed rows (after the admin edits them).
const validateBody = z.union([z.object({ csv: z.string().min(1).max(2_000_000) }), z.object({ rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))).min(1).max(1000) })]);
adminRoutes.post('/programs/:programId/challenges/bulk/validate', asyncHandler(async (req, res) => {
  const programId = id(req.params.programId);
  const body = parse(validateBody, req.body);
  if ('csv' in body) return res.json(await challengeService.validateCsv(programId, body.csv));
  res.json(challengeService.validateRows(await programService.require(programId), body.rows));
}));
// Step 2: import (re-validates server-side; the client's "valid" verdict is never trusted).
adminRoutes.post('/programs/:programId/challenges/bulk/import', asyncHandler(async (req, res) => {
  res.json(await challengeService.importRows(id(req.params.programId), parse(importBodySchema, req.body)));
}));
adminRoutes.put('/challenges/:challengeId', asyncHandler(async (req, res) => {
  res.json({ challenge: await challengeService.update(id(req.params.challengeId), parse(challengeInputSchema, req.body)) });
}));
adminRoutes.patch('/challenges/:challengeId/cancel', asyncHandler(async (req, res) => {
  const { cancelled } = parse(z.object({ cancelled: z.boolean() }), req.body);
  res.json({ challenge: await challengeService.setCancelled(id(req.params.challengeId), cancelled) });
}));
adminRoutes.delete('/challenges/:challengeId', asyncHandler(async (req, res) => {
  await challengeService.remove(id(req.params.challengeId));
  res.status(204).end();
}));

// ───── participants ─────
adminRoutes.get('/participants', asyncHandler(async (req, res) => {
  const level = req.query.level ? parse(z.enum(['FOUNDATION', 'DIPLOMA', 'DEGREE']), String(req.query.level).toUpperCase()) : undefined;
  const programId = req.query.program_id ? id(req.query.program_id) : undefined;
  res.json(await adminService.searchParticipants({ q: req.query.q ? String(req.query.q) : undefined, level, programId, ...pageParams(req, 100) }));
}));
adminRoutes.get('/participants/:userId', asyncHandler(async (req, res) => {
  res.json(await adminService.participantDetail(id(req.params.userId)));
}));
// Admin edits a student's details. LeetCode username changes here are an explicit admin override and are logged.
const userPatch = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  level: z.string().transform((v) => v.trim().toUpperCase()).pipe(z.enum(['FOUNDATION', 'DIPLOMA', 'DEGREE'])).optional(),
  leetcode_username: z.string().trim().regex(LEETCODE_USERNAME, 'Invalid LeetCode username').optional(),
});
adminRoutes.patch('/users/:userId', asyncHandler(async (req, res) => {
  const userId = id(req.params.userId);
  const body = parse(userPatch, req.body);
  const current = await profilesRepo.get(userId);
  if (!current) throw notFound('User not found');
  const patch: Record<string, unknown> = { ...body };
  if (body.leetcode_username && body.leetcode_username.toLowerCase() !== current.leetcode_username.toLowerCase()) {
    const taken = await profilesRepo.findByLeetCode(body.leetcode_username);
    if (taken && taken.id !== userId) throw conflict('That LeetCode username is linked to another account', 'LEETCODE_TAKEN');
    if (!(await leetcodeUserExists(body.leetcode_username))) throw badRequest('LeetCode user not found');
    patch.leetcode_linked_at = new Date().toISOString();
    logger.info({ admin: req.user!.id, userId, from: current.leetcode_username, to: body.leetcode_username }, 'admin relinked LeetCode username');
  } else delete patch.leetcode_username;
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  res.json({ profile: await profilesRepo.update(userId, patch as Parameters<typeof profilesRepo.update>[1]) });
}));
adminRoutes.post('/programs/:programId/participants/:userId', asyncHandler(async (req, res) => {
  const programId = id(req.params.programId); const userId = id(req.params.userId);
  await programService.require(programId);
  if (!(await profilesRepo.get(userId))) throw notFound('User not found');
  await participantsRepo.enroll(programId, userId);
  res.status(204).end();
}));
adminRoutes.delete('/programs/:programId/participants/:userId', asyncHandler(async (req, res) => {
  await participantsRepo.withdraw(id(req.params.programId), id(req.params.userId));
  res.status(204).end();
}));

// ───── certificates ─────
adminRoutes.get('/programs/:programId/certificate-rules', asyncHandler(async (req, res) => {
  res.json({ rules: await programService.getRules(id(req.params.programId)) });
}));
adminRoutes.put('/programs/:programId/certificate-rules', asyncHandler(async (req, res) => {
  res.json({ rules: await programService.saveRules(id(req.params.programId), parse(rulesSchema, req.body)) });
}));
adminRoutes.get('/programs/:programId/certificates/eligibility', asyncHandler(async (req, res) => {
  res.json(await certificateService.eligibility(id(req.params.programId)));
}));
adminRoutes.post('/programs/:programId/certificates/generate', asyncHandler(async (req, res) => {
  const force = req.query.force === 'true';
  res.json(await certificateService.generate(id(req.params.programId), req.user!.id, force));
}));
adminRoutes.get('/programs/:programId/certificates', asyncHandler(async (req, res) => {
  res.json({ certificates: await certificateService.listForProgram(id(req.params.programId)) });
}));
adminRoutes.get('/certificates/:certId/download', asyncHandler(async (req, res) => {
  res.json({ url: await certificateService.downloadUrl(id(req.params.certId), req.user!.id, true) });
}));

// ───── sync ─────
adminRoutes.post('/sync', asyncHandler(async (req, res) => {
  const { program_id } = parse(z.object({ program_id: z.string().uuid().optional() }), req.body ?? {});
  const logs = await syncService.start({ type: 'MANUAL', programId: program_id, triggeredBy: req.user!.id });
  res.status(202).json({ started: logs.length, logs });
}));
adminRoutes.post('/programs/:programId/recompute', asyncHandler(async (req, res) => {
  res.json({ participants: await progressService.recomputeProgram(id(req.params.programId)) });
}));
adminRoutes.get('/sync/status', asyncHandler(async (req, res) => {
  const programId = req.query.program_id ? id(req.query.program_id) : null;
  const status = await syncService.status(programId);
  res.json({ ...status, next_run: schedulerService.nextRun() });
}));
adminRoutes.get('/sync/logs', asyncHandler(async (req, res) => {
  const programId = req.query.program_id ? id(req.query.program_id) : null;
  const { limit, offset } = pageParams(req, 100);
  const logs = await syncRepo.listLogs(programId, limit, offset);
  const programs = new Map((await programsRepo.list()).map((p) => [p.id, p.name]));
  res.json({ logs: logs.map((l) => ({ ...l, program_name: l.program_id ? programs.get(l.program_id) ?? null : null })) });
}));
adminRoutes.get('/sync/settings', asyncHandler(async (_req, res) => { res.json({ settings: await syncRepo.getSettings() }); }));
adminRoutes.put('/sync/settings', asyncHandler(async (req, res) => {
  const saved = await syncService.saveSettings(parse(syncSettingsSchema, req.body));
  await schedulerService.reload();
  res.json({ settings: saved, next_run: schedulerService.nextRun() });
}));

// ───── analytics + users ─────
adminRoutes.get('/programs/:programId/analytics', asyncHandler(async (req, res) => {
  res.json(await adminService.programAnalytics(id(req.params.programId)));
}));
adminRoutes.get('/admins', asyncHandler(async (_req, res) => {
  res.json({ admins: (await profilesRepo.listAdmins()).map((a) => ({ id: a.id, full_name: a.full_name, email: a.email })) });
}));
adminRoutes.put('/users/:userId/role', asyncHandler(async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['STUDENT', 'ADMIN']) }), req.body);
  const userId = id(req.params.userId);
  if (userId === req.user!.id && role !== 'ADMIN') throw badRequest('You cannot remove your own admin role');
  res.json({ profile: await profilesRepo.setRole(userId, role) });
}));
