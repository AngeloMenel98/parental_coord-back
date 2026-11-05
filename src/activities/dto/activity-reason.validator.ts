import { validationFailed } from '../../common/errors/coded.exception';

export const ACTIVITY_REASON_MIN = 3;
export const ACTIVITY_REASON_MAX = 200;

export function parseActivityReason(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length < ACTIVITY_REASON_MIN || value.length > ACTIVITY_REASON_MAX) {
    throw validationFailed(
      `reason must be a string of ${ACTIVITY_REASON_MIN}-${ACTIVITY_REASON_MAX} characters`,
    );
  }
  return value;
}
