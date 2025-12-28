const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendMail({ to, subject, text, html }) {
  const info = await transporter.sendMail({
    from: `"Painel Restaurante" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html
  });
  return info;
}

module.exports = { sendMail };
