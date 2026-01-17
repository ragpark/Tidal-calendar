import { createHash, randomBytes } from 'crypto';

export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MINUTES = 45;

export const generateResetToken = () =>
  randomBytes(RESET_TOKEN_BYTES).toString('base64url');

export const hashResetToken = (token) =>
  createHash('sha256').update(token).digest('hex');

export const buildPasswordResetUrl = (publicAppUrl, token) => {
  const baseUrl = publicAppUrl?.trim();
  if (!baseUrl) {
    throw new Error('PUBLIC_APP_URL is required to build password reset links.');
  }
  return `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
};

export class InMemoryPasswordResetStore {
  constructor() {
    this.records = new Map();
  }

  async createToken({ userId, email, tokenHash, expiresAt }) {
    const id = `local-${this.records.size + 1}`;
    const record = {
      id,
      userId,
      email,
      tokenHash,
      expiresAt,
      consumedAt: null,
    };
    this.records.set(id, record);
    return record;
  }

  async findByTokenHash(tokenHash) {
    for (const record of this.records.values()) {
      if (record.tokenHash === tokenHash) {
        return record;
      }
    }
    return null;
  }

  async markConsumed(id) {
    const record = this.records.get(id);
    if (!record) return null;
    record.consumedAt = new Date().toISOString();
    this.records.set(id, record);
    return record;
  }
}

export const createResetTokenRecord = async ({
  store,
  userId,
  email,
  ttlMinutes = RESET_TOKEN_TTL_MINUTES,
  now = new Date(),
}) => {
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  await store.createToken({ userId, email, tokenHash, expiresAt });
  return { token, tokenHash, expiresAt };
};

export const validateResetToken = async ({ store, token, now = new Date() }) => {
  const tokenHash = hashResetToken(token);
  const record = await store.findByTokenHash(tokenHash);
  if (!record) return null;
  if (record.consumedAt) return null;
  if (new Date(record.expiresAt) <= now) return null;
  return record;
};

export const requestPasswordReset = async ({
  email,
  store,
  userLookup,
  sendPasswordResetEmail,
  publicAppUrl,
  ttlMinutes = RESET_TOKEN_TTL_MINUTES,
  now = new Date(),
}) => {
  const normalizedEmail = email.toLowerCase();
  const user = await userLookup(normalizedEmail);
  if (!user) {
    return { ok: true, sent: false };
  }

  const { token, expiresAt } = await createResetTokenRecord({
    store,
    userId: user.id,
    email: user.email,
    ttlMinutes,
    now,
  });
  const resetUrl = buildPasswordResetUrl(publicAppUrl, token);
  const response = await sendPasswordResetEmail({ to: user.email, resetUrl });
  return { ok: true, sent: true, token, expiresAt, emailId: response.id };
};

export const resetPasswordWithToken = async ({
  token,
  newPasswordHash,
  store,
  updatePasswordHash,
  now = new Date(),
}) => {
  const record = await validateResetToken({ store, token, now });
  if (!record) {
    return { ok: false, reason: 'invalid' };
  }
  await updatePasswordHash(record.userId, newPasswordHash);
  await store.markConsumed(record.id);
  return { ok: true, userId: record.userId };
};
