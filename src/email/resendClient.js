import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is required to send transactional emails.');
}

export const resend = new Resend(RESEND_API_KEY);

export const EMAIL_FROM =
  process.env.EMAIL_FROM || 'Your App <no-reply@yourdomain.com>';

export const RESEND_USE_TEMPLATES = process.env.RESEND_USE_TEMPLATES === 'true';

export const RESEND_WELCOME_TEMPLATE_ID =
  process.env.RESEND_WELCOME_TEMPLATE_ID || '';

export const RESEND_RESET_TEMPLATE_ID =
  process.env.RESEND_RESET_TEMPLATE_ID || '';
