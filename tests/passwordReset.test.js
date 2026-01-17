import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryPasswordResetStore,
  createResetTokenRecord,
  requestPasswordReset,
  resetPasswordWithToken,
  validateResetToken,
} from '../src/auth/passwordResetService.js';

test('hashing and validation flow returns active token', async () => {
  const store = new InMemoryPasswordResetStore();
  const { token } = await createResetTokenRecord({
    store,
    userId: 'user-1',
    email: 'user@example.com',
    ttlMinutes: 60,
  });

  const record = await validateResetToken({ store, token });
  assert.ok(record);
  assert.equal(record.email, 'user@example.com');
});

test('password reset flow updates password and consumes token', async () => {
  const store = new InMemoryPasswordResetStore();
  let updatedUserId = null;
  let updatedHash = null;

  const sendPasswordResetEmail = async ({ to, resetUrl }) => {
    assert.equal(to, 'reset@example.com');
    assert.ok(resetUrl.includes('reset-password?token='));
    return { id: 'email_123' };
  };

  const result = await requestPasswordReset({
    email: 'reset@example.com',
    store,
    userLookup: async () => ({ id: 'user-123', email: 'reset@example.com' }),
    sendPasswordResetEmail,
    publicAppUrl: 'https://example.com',
  });

  assert.ok(result.token);
  const resetResult = await resetPasswordWithToken({
    token: result.token,
    newPasswordHash: 'hash-123',
    store,
    updatePasswordHash: async (userId, hash) => {
      updatedUserId = userId;
      updatedHash = hash;
    },
  });

  assert.equal(resetResult.ok, true);
  assert.equal(updatedUserId, 'user-123');
  assert.equal(updatedHash, 'hash-123');

  const reused = await validateResetToken({ store, token: result.token });
  assert.equal(reused, null);
});
