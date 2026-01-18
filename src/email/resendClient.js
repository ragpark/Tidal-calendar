const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is required to send transactional emails.');
}

const RESEND_API_BASE = 'https://api.resend.com';

const sendEmail = async (payload) => {
  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      error: {
        message: data?.message || `Resend API error (${res.status})`,
        statusCode: res.status,
      },
    };
  }

  return { data };
};

export const resend = {
  emails: {
    send: sendEmail,
  },
};

export const EMAIL_FROM =
  process.env.EMAIL_FROM || 'Boat Scrub Calendar <alert@boatscrubcalendar.com>';

export const RESEND_USE_TEMPLATES = process.env.RESEND_USE_TEMPLATES === 'true';

export const RESEND_WELCOME_TEMPLATE_ID =
  process.env.RESEND_WELCOME_TEMPLATE_ID || '';

export const RESEND_RESET_TEMPLATE_ID =
  process.env.RESEND_RESET_TEMPLATE_ID || '';
