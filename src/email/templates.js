const baseStyles = `
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; color: #1f2937; }
  .container { max-width: 560px; margin: 0 auto; padding: 24px; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; }
  .button { display: inline-block; padding: 12px 18px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; }
  .muted { color: #6b7280; font-size: 14px; }
`;

const wrapHtml = (content) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${baseStyles}</style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        ${content}
      </div>
    </div>
  </body>
</html>
`;

export const buildWelcomeEmail = ({ firstName, resetUrl }) => {
  const greeting = firstName ? `Hi ${firstName},` : 'Welcome!';
  const subject = 'Welcome to Tidal Calendar';
  const resetHtml = resetUrl
    ? `
    <p>Need to set or reset your password? Use the link below (expires in 45 minutes).</p>
    <p><a class="button" href="${resetUrl}">Set your password</a></p>
  `
    : '';
  const resetText = resetUrl
    ? `\n\nNeed to set or reset your password? Use the link below (expires in 45 minutes):\n${resetUrl}`
    : '';
  const html = wrapHtml(`
    <h2>${greeting}</h2>
    <p>Thanks for signing up. You can now plan your scrubbing days and manage bookings.</p>
    ${resetHtml}
    <p class="muted">If you did not create this account, you can ignore this email.</p>
  `);
  const text = `${greeting}\n\nThanks for signing up. You can now plan your scrubbing days and manage bookings.${resetText}\n\nIf you did not create this account, you can ignore this email.`;
  return { subject, html, text };
};

export const buildPasswordResetEmail = ({ resetUrl }) => {
  const subject = 'Reset your Tidal Calendar password';
  const html = wrapHtml(`
    <h2>Password reset request</h2>
    <p>Use the button below to reset your password. This link expires in 45 minutes.</p>
    <p><a class="button" href="${resetUrl}">Reset password</a></p>
    <p class="muted">If you did not request a reset, you can safely ignore this email.</p>
  `);
  const text = `Password reset request\n\nUse the link below to reset your password (expires in 45 minutes):\n${resetUrl}\n\nIf you did not request a reset, you can ignore this email.`;
  return { subject, html, text };
};
