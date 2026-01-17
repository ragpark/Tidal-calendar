export const createPasswordResetStore = (pool) => ({
  async createToken({ userId, email, tokenHash, expiresAt }) {
    const { rows } = await pool.query(
      `INSERT INTO password_reset_tokens (user_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, email, token_hash, expires_at, consumed_at`,
      [userId, email, tokenHash, expiresAt],
    );
    const row = rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  },

  async findByTokenHash(tokenHash) {
    const { rows } = await pool.query(
      `SELECT id, user_id, email, token_hash, expires_at, consumed_at
       FROM password_reset_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  },

  async markConsumed(id) {
    const { rows } = await pool.query(
      `UPDATE password_reset_tokens
       SET consumed_at = now()
       WHERE id = $1
       RETURNING id, user_id, email, token_hash, expires_at, consumed_at`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  },
});
