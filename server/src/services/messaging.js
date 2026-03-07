const nodemailer = require("nodemailer");

let cachedTransporter = null;

function boolFromEnv(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function getMailConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolFromEnv(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || "Smart Choice Vendas <no-reply@smartchoicevendas.com>"
  };
}

function isMailConfigured(config) {
  return Boolean(config.host && config.port && config.user && config.pass);
}

function getTransporter(config) {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  return cachedTransporter;
}

function mapSmtpError(error, config) {
  const detail = String(error?.message || "");
  const code = String(error?.code || "");
  const host = String(config?.host || "").toLowerCase();

  if (
    host.includes("gmail") &&
    (detail.includes("BadCredentials") ||
      detail.includes("Username and Password not accepted") ||
      code === "EAUTH")
  ) {
    return {
      reason: "SMTP_AUTH_FAILED",
      hint: "Gmail exige Senha de App (16 caracteres). Ative 2FA na conta e use essa senha no SMTP_PASS.",
      detail
    };
  }

  if (code === "ESOCKET" || code === "ECONNECTION" || detail.includes("connect ECONNREFUSED")) {
    return {
      reason: "SMTP_CONNECTION_FAILED",
      hint: "Nao foi possivel conectar ao servidor SMTP. Verifique host, porta e firewall.",
      detail
    };
  }

  return {
    reason: "SMTP_SEND_FAILED",
    detail
  };
}

async function sendVerificationCodeEmail({ email, name, code }) {
  const config = getMailConfig();
  if (!isMailConfigured(config)) {
    return {
      sent: false,
      channel: "EMAIL",
      reason: "SMTP_NOT_CONFIGURED"
    };
  }

  try {
    const transporter = getTransporter(config);
    await transporter.sendMail({
      from: config.from,
      to: email,
      subject: "Seu codigo de verificacao - Smart Choice Vendas",
      text: `Ola ${name || "cliente"}, seu codigo de verificacao e: ${code}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1b2434;">
          <h2>Smart Choice Vendas</h2>
          <p>Ola <strong>${name || "cliente"}</strong>,</p>
          <p>Seu codigo de verificacao e:</p>
          <p style="font-size:24px;font-weight:700;letter-spacing:3px;">${code}</p>
          <p>Se voce nao solicitou este cadastro, ignore este e-mail.</p>
        </div>
      `
    });

    return {
      sent: true,
      channel: "EMAIL"
    };
  } catch (error) {
    const mappedError = mapSmtpError(error, config);
    return {
      sent: false,
      channel: "EMAIL",
      reason: mappedError.reason,
      hint: mappedError.hint,
      detail: mappedError.detail
    };
  }
}

module.exports = {
  sendVerificationCodeEmail,
  boolFromEnv
};
