import { env } from '../config/env';
import { admin } from '../lib/supabase';
import { AppError, conflict, notFound, unprocessable } from '../lib/errors';
import { logger } from '../lib/logger';
import { participantsRepo } from '../repositories/participants.repo';
import { challengesRepo } from '../repositories/challenges.repo';
import { progressRepo } from '../repositories/submissions.repo';
import { certificatesRepo } from '../repositories/certificates.repo';
import { evaluateEligibility } from '../domain/eligibility';
import { effectiveProgramStatus } from '../domain/challengeState';
import { renderCertificatePdf } from '../certificates/pdf';
import { programService } from './program.service';
import type { Certificate, Program, Progress } from '../types/db';

const BUCKET = 'certificates';
const CODE_FORMAT = /^CC-[A-Z0-9]{2,8}-\d{4}-\d{6}$/;

export const certificateService = {
  /** Recomputed server-side every time; nothing about eligibility is ever accepted from the client. */
  async eligibility(programId: string) {
    const program = await programService.require(programId);
    const rules = await programService.getRules(programId);
    const [participants, challenges, progress, certs] = await Promise.all([
      participantsRepo.listEnrolled(programId), challengesRepo.listByProgram(programId),
      progressRepo.listByProgram(programId), certificatesRepo.listByProgram(programId),
    ]);
    const total = challenges.filter((c) => c.status !== 'CANCELLED').length;
    const progByUser = new Map<string, Progress>(progress.map((p) => [p.user_id, p]));
    const issued = new Map(certs.map((c) => [c.user_id, c]));

    const rows = participants.map((p) => {
      const pr = progByUser.get(p.user_id);
      const stats = { solved: pr?.solved_count ?? 0, points: pr?.total_points ?? 0, missedDays: pr?.missed_days ?? 0, totalChallenges: total };
      const res = evaluateEligibility(rules, stats);
      return {
        user_id: p.user_id, full_name: p.profile.full_name, leetcode_username: p.profile.leetcode_username, level: p.profile.level,
        ...stats, eligible: res.eligible, reasons: res.reasons, certificate_code: issued.get(p.user_id)?.certificate_code ?? null,
      };
    });
    const eligible = rows.filter((r) => r.eligible).length;
    return {
      program_id: programId, certificate_enabled: program.certificate_enabled, program_status: effectiveProgramStatus(program),
      rules, total_challenges: total, eligible, not_eligible: rows.length - eligible,
      already_issued: certs.length, participants: rows,
    };
  },

  async generate(programId: string, adminId: string, force = false) {
    const program = await programService.require(programId);
    if (!program.certificate_enabled) throw conflict('Certificates are not enabled for this program', 'CERTIFICATES_DISABLED');
    if (!force && effectiveProgramStatus(program) !== 'COMPLETED')
      throw conflict('The program has not completed yet. Certificates are generated after it ends (or pass force=true).', 'NOT_COMPLETED');

    const report = await this.eligibility(programId);
    const todo = report.participants.filter((r) => r.eligible && !r.certificate_code);
    let issued = 0;
    const failures: Array<{ user_id: string; error: string }> = [];

    for (const r of todo) {
      try {
        await this.issueOne(program, r.user_id, r.full_name, r.solved, report.total_challenges, adminId);
        issued++;
      } catch (e) {
        logger.error({ err: e, userId: r.user_id }, 'certificate generation failed');
        failures.push({ user_id: r.user_id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { issued, skipped_already_issued: report.already_issued, not_eligible: report.not_eligible, failed: failures.length, failures };
  },

  async issueOne(program: Program, userId: string, name: string, completed: number, total: number, adminId: string | null): Promise<Certificate> {
    const code = await certificatesRepo.nextCode(program.certificate_prefix);
    const pdf = await renderCertificatePdf({
      recipientName: name, programName: program.name, completed, total, code, issuedAt: new Date(),
      verifyUrl: `${env.PUBLIC_APP_URL}/verify/${code}`,
    });
    const path = `${program.id}/${code}.pdf`;
    const up = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
    if (up.error) throw new AppError(502, 'STORAGE_ERROR', `Upload failed: ${up.error.message}`);
    try {
      // UNIQUE(program_id, user_id) makes this safe against double-clicks / concurrent generation.
      return await certificatesRepo.insert({
        certificate_code: code, program_id: program.id, user_id: userId, recipient_name: name, program_name: program.name,
        challenges_completed: completed, total_challenges: total, storage_path: path, issued_by: adminId,
      });
    } catch (e) {
      await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
      throw e;
    }
  },

  /** Public verification: deliberately minimal. No email, LeetCode handle, level or user id. */
  async verify(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!CODE_FORMAT.test(normalized)) return { verified: false as const };
    const cert = await certificatesRepo.getByCode(normalized);
    if (!cert) return { verified: false as const };
    return {
      verified: true as const, certificate_code: cert.certificate_code, recipient_name: cert.recipient_name,
      program_name: cert.program_name, challenges_completed: cert.challenges_completed, total_challenges: cert.total_challenges,
      issued_at: cert.issued_at, issuer: 'CodeCrafter Club, IIT Madras',
    };
  },

  async downloadUrl(certId: string, requesterId: string, isAdmin: boolean): Promise<string> {
    const certs = isAdmin ? null : await certificatesRepo.listByUser(requesterId);
    const cert = isAdmin
      ? (await admin.from('certificates').select('*').eq('id', certId).maybeSingle<Certificate>()).data
      : certs!.find((c) => c.id === certId);
    if (!cert || !cert.storage_path) throw notFound('Certificate not found');
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(cert.storage_path, 300, { download: `${cert.certificate_code}.pdf` });
    if (error || !data) throw unprocessable('Could not create download link');
    return data.signedUrl;
  },

  async listMine(userId: string) {
    return certificatesRepo.listByUser(userId);
  },
  async listForProgram(programId: string) {
    return certificatesRepo.listByProgram(programId);
  },
};
