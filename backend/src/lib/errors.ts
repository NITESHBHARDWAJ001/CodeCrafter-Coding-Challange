export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', m, details);
export const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Forbidden') => new AppError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string, code = 'CONFLICT') => new AppError(409, code, m);
export const unprocessable = (m: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', m, details);
export const unavailable = (m: string) => new AppError(503, 'SERVICE_UNAVAILABLE', m);
