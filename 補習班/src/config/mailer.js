import nodemailer from 'nodemailer';

const hasSmtp = Boolean(process.env.SMTP_HOST);

export function createTransport() {
  if (!hasSmtp) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      : undefined
  });
}

export async function sendContactMail({ name, email, phone, message }) {
  const transport = createTransport();
  if (!transport) return false;
  const to = process.env.MAIL_TO;
  if (!to) return false;
  const info = await transport.sendMail({
    from: `Site CMS <no-reply@localhost>`,
    to,
    subject: `New contact from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\n\n${message}`
  });
  return Boolean(info.messageId);
}


