import webpush from 'web-push';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { notFound } from '../lib/errors';
import { pushRepo, type AnnouncementRow } from '../repositories/push.repo';
import { participantsRepo } from '../repositories/participants.repo';
import { programsRepo } from '../repositories/programs.repo';
import { profilesRepo } from '../repositories/profiles.repo';

/** True only when both VAPID keys are configured; otherwise announcements still save, they just aren't pushed. */
export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

export const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(2).max(140),
  body: z.string().trim().min(1).max(1000),
  audience: z.enum(['ALL', 'PROGRAM', 'STUDENT']).default('ALL'),
  program_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  url: z.string().trim().max(300).optional(),
}).refine((v) => v.audience !== 'PROGRAM' || !!v.program_id, { message: 'program_id is required for PROGRAM audience', path: ['program_id'] })
  .refine((v) => v.audience !== 'STUDENT' || !!v.user_id, { message: 'user_id is required for STUDENT audience', path: ['user_id'] });

export const notificationsService = {
  async subscribe(userId: string, body: z.infer<typeof subscribeSchema>, userAgent?: string): Promise<void> {
    await pushRepo.upsertSubscription(userId, { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent });
  },
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await pushRepo.removeSubscription(userId, endpoint);
  },
  async list(limit: number, offset: number): Promise<AnnouncementRow[]> {
    return pushRepo.list(limit, offset);
  },

  async create(input: z.infer<typeof announcementSchema>, adminId: string): Promise<{ announcement: AnnouncementRow; sent: number; failed: number; push_configured: boolean }> {
    if (input.audience === 'PROGRAM' && !(await programsRepo.get(input.program_id!))) throw notFound('Program not found');
    if (input.audience === 'STUDENT' && !(await profilesRepo.get(input.user_id!))) throw notFound('Student not found');

    const row = await pushRepo.insertAnnouncement({
      title: input.title, body: input.body, audience: input.audience,
      program_id: input.audience === 'PROGRAM' ? input.program_id! : null,
      user_id: input.audience === 'STUDENT' ? input.user_id! : null,
      url: input.url?.length ? input.url : null, created_by: adminId,
    });

    if (!pushEnabled) return { announcement: row, sent: 0, failed: 0, push_configured: false };

    const subs = input.audience === 'ALL' ? await pushRepo.listAll()
      : input.audience === 'STUDENT' ? await pushRepo.listForUsers([input.user_id!])
      : await pushRepo.listForUsers(await participantsRepo.enrolledUserIds(input.program_id!));

    const payload = JSON.stringify({ title: row.title, body: row.body, url: row.url });
    let sent = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err) {
        failed++;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) await pushRepo.removeByEndpoint(s.endpoint);
        else logger.warn({ err, endpoint: s.endpoint }, 'push send failed');
      }
    }));

    const updated = await pushRepo.updateCounts(row.id, sent, failed);
    return { announcement: updated, sent, failed, push_configured: true };
  },

  async remove(id: string): Promise<void> {
    await pushRepo.remove(id);
  },
};
