import {
  resend,
  EMAIL_FROM,
  RESEND_USE_TEMPLATES,
  RESEND_WELCOME_TEMPLATE_ID,
  RESEND_RESET_TEMPLATE_ID,
} from './resendClient.js';
import { buildWelcomeEmail, buildPasswordResetEmail } from './templates.js';

const ensureTemplateId = (templateId, label) => {
  if (!templateId) {
    throw new Error(`${label} template id is required when RESEND_USE_TEMPLATES=true.`);
  }
};

const handleSendResult = (emailType, result) => {
  if (result?.error) {
    throw new Error(`Resend ${emailType} email failed: ${result.error.message || result.error}`);
  }
  const id = result?.data?.id;
  if (!id) {
    throw new Error(`Resend ${emailType} email did not return an id.`);
  }
  console.info(`[email] ${emailType} email sent: ${id}`);
  return { id };
};

export const sendWelcomeEmail = async ({ to, firstName, resetUrl }) => {
  const { subject, html, text } = buildWelcomeEmail({ firstName, resetUrl });

  if (RESEND_USE_TEMPLATES) {
    ensureTemplateId(RESEND_WELCOME_TEMPLATE_ID, 'Welcome');
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      template_id: RESEND_WELCOME_TEMPLATE_ID,
      template_data: { firstName: firstName || '', resetUrl: resetUrl || '' },
    });
    return handleSendResult('welcome', result);
  }

  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
    text,
  });
  return handleSendResult('welcome', result);
};

export const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  const { subject, html, text } = buildPasswordResetEmail({ resetUrl });

  if (RESEND_USE_TEMPLATES) {
    ensureTemplateId(RESEND_RESET_TEMPLATE_ID, 'Password reset');
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      template_id: RESEND_RESET_TEMPLATE_ID,
      template_data: { resetUrl },
    });
    return handleSendResult('password reset', result);
  }

  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
    text,
  });
  return handleSendResult('password reset', result);
};

export const sendMaintenanceReminderEmail = async ({ to, subject, text }) => {
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    text,
  });
  return handleSendResult('maintenance reminder', result);
};
