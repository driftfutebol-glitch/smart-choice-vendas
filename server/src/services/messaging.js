const nodemailer = require("nodemailer");

let cachedTransporter = null;
let cachedTransporterKey = "";

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
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (cachedTransporter && cachedTransporterKey === key) {
    return cachedTransporter;
  }

  const connectionTimeoutMs = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 4000);
  const greetingTimeoutMs = Number(process.env.SMTP_GREETING_TIMEOUT_MS || 4000);
  const socketTimeoutMs = Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 8000);

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: connectionTimeoutMs,
    greetingTimeout: greetingTimeoutMs,
    socketTimeout: socketTimeoutMs,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
  cachedTransporterKey = key;

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

  if (code === "SMTP_TIMEOUT") {
    return {
      reason: "SMTP_TIMEOUT",
      hint: "O servidor de e-mail demorou para responder. O sistema segue tentando enviar o codigo.",
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
    const mailPromise = transporter.sendMail({
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

    const sendTimeoutMs = Number(process.env.SMTP_SEND_TIMEOUT_MS || 5000);
    const raceResult = await Promise.race([
      mailPromise.then(() => ({ ok: true })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), sendTimeoutMs))
    ]);

    if (!raceResult.ok && raceResult.timeout) {
      // Avoid unhandled rejection if SMTP fails after timeout.
      mailPromise.catch(() => {});
      return {
        sent: false,
        channel: "EMAIL",
        reason: "SMTP_TIMEOUT",
        hint: "Envio em andamento. Verifique sua caixa de entrada em instantes."
      };
    }

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
