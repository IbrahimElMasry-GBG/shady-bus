import type { AppErrorCode } from '@/types';

/**
 * A failure we can explain to the user in plain language, as opposed to an
 * unexpected crash. Every API route converts these into a typed JSON body.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly hint?: string;
  readonly status: number;

  constructor(code: AppErrorCode, message: string, options: { hint?: string; status?: number } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = options.hint;
    this.status = options.status ?? 400;
  }
}
