import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, authenticate, pageParams, parse } from '../middleware/http';
import { profileService, profileUpdateSchema, relinkStartSchema } from '../services/profile.service';
import { programService, withEffective } from '../services/program.service';
import { challengeService } from '../services/challenge.service';
import { leaderboardService, type BoardType } from '../services/leaderboard.service';
import { dashboardService } from '../services/dashboard.service';
import { certificateService } from '../services/certificate.service';
import { syncService } from '../services/sync.service';
import { participantsRepo } from '../repositories/participants.repo';
import { progressRepo } from '../repositories/submissions.repo';
import { leaderboardRepo } from '../repositories/leaderboard.repo';
import { challengesRepo } from '../repositories/challenges.repo';

export const studentRoutes = Router();
studentRoutes.use(authenticate);

const isAdmin = (req: Express.Request & { user?: { role: string } }) => req.user?.role === 'ADMIN';
const uuid = z.string().uuid();
const id = (v: unknown) => parse(uuid, v);

// ───── profile ─────
studentRoutes.get('/me', asyncHandler(async (req, res) => {
  res.json({ profile: req.user, stats: await profileService.stats(req.user!.id) });
}));
studentRoutes.patch('/me', asyncHandler(async (req, res) => {
  res.json({ profile: await profileService.update(req.user!.id, parse(profileUpdateSchema, req.body)) });
}));
studentRoutes.post('/me/leetcode/relink', asyncHandler(async (req, res) => {
  res.json(await profileService.startRelink(req.user!.id, parse(relinkStartSchema, req.body).new_username));
}));
studentRoutes.post('/me/leetcode/relink/confirm', asyncHandler(async (req, res) => {
  res.json({ profile: await profileService.confirmRelink(req.user!.id) });
}));
studentRoutes.get('/me/dashboard', asyncHandler(async (req, res) => {
  res.json(await dashboardService.forUser(req.user!.id));
}));
studentRoutes.get('/me/certificates', asyncHandler(async (req, res) => {
  res.json({ certificates: await certificateService.listMine(req.user!.id) });
}));
studentRoutes.get('/me/certificates/:certId/download', asyncHandler(async (req, res) => {
  res.json({ url: await certificateService.downloadUrl(id(req.params.certId), req.user!.id, false) });
}));
/** "Check me now": same server-side verification, only for the caller; the client cannot submit a result. */
studentRoutes.post('/me/programs/:programId/verify', asyncHandler(async (req, res) => {
  res.json(await syncService.verifySelf(req.user!.id, req.user!.leetcode_username, id(req.params.programId)));
}));

// ───── programs ─────
studentRoutes.get('/programs', asyncHandler(async (req, res) => {
  res.json({ programs: await programService.listForUser(req.user!.id, isAdmin(req)) });
}));
studentRoutes.get('/programs/:programId', asyncHandler(async (req, res) => {
  const programId = id(req.params.programId);
  const program = await programService.requireVisible(programId, isAdmin(req));
  const [enrolled, progress, rank, participants, total] = await Promise.all([
    participantsRepo.get(programId, req.user!.id), progressRepo.get(programId, req.user!.id),
    leaderboardRepo.programRank(programId, req.user!.id), participantsRepo.countEnrolled(programId),
    challengesRepo.listByProgram(programId).then((c) => c.filter((x) => x.status !== 'CANCELLED').length),
  ]);
  res.json({
    program: withEffective(program), enrolled: enrolled?.status === 'ENROLLED', participants,
    progress: { solved: progress?.solved_count ?? 0, total, points: progress?.total_points ?? 0, rank,
      current_streak: progress?.current_streak ?? 0, longest_streak: progress?.longest_streak ?? 0 },
  });
}));
studentRoutes.post('/programs/:programId/enroll', asyncHandler(async (req, res) => {
  await programService.enroll(id(req.params.programId), req.user!.id);
  res.status(204).end();
}));
studentRoutes.delete('/programs/:programId/enroll', asyncHandler(async (req, res) => {
  await programService.withdraw(id(req.params.programId), req.user!.id);
  res.status(204).end();
}));

// ───── challenges (release gating enforced in the service layer) ─────
studentRoutes.get('/programs/:programId/challenges', asyncHandler(async (req, res) => {
  res.json({ challenges: await challengeService.listForStudent(id(req.params.programId), req.user!.id, isAdmin(req)) });
}));
studentRoutes.get('/programs/:programId/today', asyncHandler(async (req, res) => {
  await programService.requireVisible(id(req.params.programId), isAdmin(req));
  res.json({ challenge: await challengeService.currentFor(id(req.params.programId), req.user!.id) });
}));
studentRoutes.get('/challenges/:challengeId', asyncHandler(async (req, res) => {
  res.json({ challenge: await challengeService.getForStudent(id(req.params.challengeId), req.user!.id, isAdmin(req)) });
}));

// ───── leaderboards ─────
const boardType = z.enum(['program', 'daily', 'weekly']).default('program');
studentRoutes.get('/programs/:programId/leaderboard', asyncHandler(async (req, res) => {
  const type = parse(boardType, req.query.type) as BoardType;
  const challengeId = req.query.challenge_id ? id(req.query.challenge_id) : undefined;
  res.json(await leaderboardService.get(type, id(req.params.programId), req.user!.id, isAdmin(req), pageParams(req, 500), challengeId));
}));
studentRoutes.get('/leaderboard/overall', asyncHandler(async (req, res) => {
  res.json(await leaderboardService.get('overall', null, req.user!.id, isAdmin(req), pageParams(req, 500)));
}));
