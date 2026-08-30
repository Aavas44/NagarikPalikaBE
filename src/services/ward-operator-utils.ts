export const WARD_INTERNAL_EMAIL_DOMAIN = "wardoperators.local";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;

export function normalizeWardUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeWardLoginIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidWardUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export function isWardInternalEmail(email: string): boolean {
  return email.endsWith(`@${WARD_INTERNAL_EMAIL_DOMAIN}`);
}

export function wardOperatorStorageEmail(
  username: string,
  email?: string | null
): string {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail) return normalizedEmail;
  return `ward.${username}@${WARD_INTERNAL_EMAIL_DOMAIN}`;
}

export function wardOperatorDisplayEmail(
  email: string | undefined | null
): string | null {
  if (!email || isWardInternalEmail(email)) return null;
  return email;
}

export type WardGenerationQuota = {
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
};

export function wardGenerationQuotaFromProfile(profile: {
  generationCount?: number;
  generationLimit?: number | null;
}): WardGenerationQuota {
  const used = profile.generationCount ?? 0;
  const limit =
    profile.generationLimit === null || profile.generationLimit === undefined
      ? null
      : profile.generationLimit;
  if (limit == null) {
    return { limit: null, used, remaining: null, unlimited: true };
  }
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    unlimited: false,
  };
}
