import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { addHours, isValidZone, toInstant } from './time';
import type { ChallengeProvider, Difficulty } from '../types/db';
import { parseProblemUrl } from '../providers/urls';

export interface RawChallengeRow { [k: string]: string | number | null | undefined }
export interface ValidChallengeRow {
  day_number: number; title: string; provider: ChallengeProvider; external_problem_id: string;
  external_problem_url: string; category: string; difficulty: Difficulty; points_override: number | null;
  release_at: string; closes_at: string;
}
export interface RowError { row: number; field?: string; message: string }
export interface ValidationReport {
  valid: ValidChallengeRow[];
  validCount: number;
  invalidCount: number;
  errors: RowError[];
  /** the raw rows, index-aligned, so the UI can let the admin fix invalid ones and resubmit */
  rows: RawChallengeRow[];
}

export function parseCsv(text: string): RawChallengeRow[] {
  return parse(text, {
    columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
    skip_empty_lines: true, trim: true, bom: true, relax_column_count: true,
  }) as RawChallengeRow[];
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Validate raw rows. Row numbers are spreadsheet-style: header is row 1, first data row is row 2,
 * so "Row 34" in an error matches what the admin sees in their file.
 */
export function validateChallengeRows(
  rows: RawChallengeRow[],
  ctx: { timezone: string; windowHours: number },
): ValidationReport {
  const errors: RowError[] = [];
  const valid: ValidChallengeRow[] = [];
  const seenDays = new Map<number, number>();
  if (!isValidZone(ctx.timezone)) throw new Error(`Invalid timezone ${ctx.timezone}`);

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2;
    const rowErrors: RowError[] = [];
    const err = (field: string, message: string) => rowErrors.push({ row: rowNo, field, message });

    const day = Number(str(raw.day_number));
    if (!str(raw.day_number)) err('day_number', 'Missing day number');
    else if (!Number.isInteger(day) || day < 1) err('day_number', 'Day number must be a positive integer');
    else if (seenDays.has(day)) err('day_number', `Duplicate day ${day} (also row ${seenDays.get(day)})`);

    const title = str(raw.title);
    if (!title) err('title', 'Missing title');

    const url = str(raw.leetcode_url ?? raw.problem_url);
    let slug = '';
    let provider: ChallengeProvider = 'LEETCODE';
    if (!url) err('leetcode_url', 'Missing LeetCode URL');
    else {
      const parsed = parseProblemUrl(url);
      if (!parsed) err('leetcode_url', 'Not a valid problem URL (expected https://leetcode.com/problems/<slug>/)');
      else { slug = parsed.externalId; provider = parsed.provider; }
    }

    const diff = str(raw.difficulty).toUpperCase();
    if (!['EASY', 'MEDIUM', 'HARD'].includes(diff)) err('difficulty', 'Invalid difficulty (use Easy, Medium or Hard)');

    let points: number | null = null;
    if (str(raw.points) !== '') {
      points = Number(str(raw.points));
      if (!Number.isInteger(points) || points < 0 || points > 10_000) err('points', 'Points must be an integer between 0 and 10000');
    }

    const date = str(raw.release_date);
    const time = str(raw.release_time) || '00:00';
    let releaseAt: Date | null = null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err('release_date', 'Release date must be YYYY-MM-DD');
    else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) err('release_time', 'Release time must be HH:mm (24h)');
    else {
      try { releaseAt = toInstant(date, time, ctx.timezone); } catch { err('release_date', 'Invalid release date/time'); }
    }

    if (rowErrors.length === 0 && releaseAt) {
      seenDays.set(day, rowNo);
      valid.push({
        day_number: day, title, provider, external_problem_id: slug, external_problem_url: url,
        category: str(raw.category) || 'General', difficulty: diff as Difficulty, points_override: points,
        release_at: releaseAt.toISOString(), closes_at: addHours(releaseAt, ctx.windowHours).toISOString(),
      });
    } else {
      if (Number.isInteger(day) && day > 0 && !seenDays.has(day)) seenDays.set(day, rowNo);
      errors.push(...rowErrors);
    }
  });

  const invalidRows = new Set(errors.map((e) => e.row));
  return { valid, validCount: valid.length, invalidCount: invalidRows.size, errors, rows };
}

export const importBodySchema = z.object({
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))).min(1).max(1000),
  skipInvalid: z.boolean().default(false),
  onConflict: z.enum(['skip', 'replace']).default('skip'),
});
