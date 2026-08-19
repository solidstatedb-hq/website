const nodemailer = require('nodemailer');

// Basic in-memory rate limit per Vercel function instance — not durable across
// cold starts or multiple instances, but cheap insurance against simple bot
// bursts without adding an external dependency.
const submissions = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = submissions.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    submissions.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many submissions. Please try again in a minute.' });
    return;
  }

  const { name, email, service, message, website } = req.body || {};

  // Honeypot: a hidden field real visitors never fill in. Bots that
  // autofill every field trip this silently — return success without
  // sending mail, so the bot gets no signal that it was caught.
  if (website) {
    res.status(200).json({ ok: true });
    return;
  }

  if (!name || !email || typeof name !== 'string' || typeof email !== 'string') {
    res.status(400).json({ error: 'Name and email are required.' });
    return;
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_SMTP_USER,
      pass: process.env.ZOHO_SMTP_PASSWORD,
    },
  });

  const safe = (s) => String(s || '').replace(/[<>]/g, '');

  try {
    await transporter.sendMail({
      from: `"SolidStateDB Contact Form" <${process.env.ZOHO_SMTP_USER}>`,
      to: process.env.ZOHO_SMTP_USER,
      replyTo: email,
      subject: `New contact form submission from ${safe(name)}`,
      text: [
        `Name: ${safe(name)}`,
        `Email: ${safe(email)}`,
        `Service: ${safe(service)}`,
        '',
        'Message:',
        safe(message),
      ].join('\n'),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact form send failed:', err);
    res.status(500).json({ error: 'Something went wrong sending your message. Please email us directly.' });
  }
};
