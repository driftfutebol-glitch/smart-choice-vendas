
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
const jwt = require("jsonwebtoken");

const { getDb } = require("./db");
const { signToken, authRequired, adminRequired } = require("./auth");
const { adjustCredits, logActivity } = require("./services/ledger");
const { addMinutes, generateCode, isBeginnerAccount, monthRef } = require("./services/utils");
const { triageFaq } = require("./services/triage");
const { sendVerificationCodeEmail, boolFromEnv } = require("./services/messaging");
const { ADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require("./permissions");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 4000);
const BEGINNER_DAYS = Number(process.env.BEGINNER_DAYS || 30);
const PARTNER_MONTHLY_BONUS = Number(process.env.PARTNER_MONTHLY_BONUS || 100);
const MASTER_KEY = String(process.env.MASTER_KEY || "03142911");

function sanitizePermissions(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((item) => String(item || "").trim()).filter((item) => ADMIN_PERMISSIONS.includes(item)))];
}

async function getAdminContext(db, userId) {
  const user = await db.get("SELECT id, role, is_owner FROM users WHERE id = ?", [userId]);
  if (!user || user.role !== "ADMIN") {
    return null;
  }

  if (Number(user.is_owner) === 1) {
    return {
      userId: user.id,
      isOwner: true,
      permissions: new Set(ADMIN_PERMISSIONS)
    };
  }

  const rows = await db.all("SELECT permission FROM admin_permissions WHERE user_id = ?", [user.id]);
  return {
    userId: user.id,
    isOwner: false,
    permissions: new Set(rows.map((row) => row.permission))
  };
}

function requireAdminPermission(permission) {
  return async (req, res, next) => {
    try {
      const db = await getDb();
      const context = await getAdminContext(db, req.auth.sub);

      if (!context) {
        return res.status(403).json({ error: "Acesso restrito ao admin" });
      }

      req.adminContext = context;

      if (context.isOwner || context.permissions.has(permission)) {
        return next();
      }

      return res.status(403).json({ error: `Permissao obrigatoria: ${permission}` });
    } catch (error) {
      return res.status(500).json({ error: "Falha ao validar permissao" });
    }
  };
}

async function setAdminPermissions(db, userId, permissions, grantedBy = null) {
  const normalized = sanitizePermissions(permissions);

  await db.run("DELETE FROM admin_permissions WHERE user_id = ?", [userId]);
  for (const permission of normalized) {
    await db.run(
      "INSERT OR IGNORE INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)",
      [userId, permission, grantedBy]
    );
  }

  return normalized;
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
  } catch (_error) {
    req.auth = null;
  }

  return next();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isStrongPassword(password) {
  const candidate = String(password || "");
  // At least 8 chars with upper, lower, number and special char.
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(candidate);
}

function buildAutoPhoneTag(seed = "") {
  const safeSeed = String(seed).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "user";
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 8);
  return `AUTO-${timePart}-${randPart}-${safeSeed}`;
}

async function getUserById(db, userId) {
  return db.get(
    `
    SELECT id, name, email, phone, role, status_usuario, credits, first_login, created_at, is_banned, partner_active, is_owner
    FROM users
    WHERE id = ?
    `,
    [userId]
  );
}

async function monthlyPartnerBonusJob() {
  const db = await getDb();
  const ref = monthRef();
  const reason = `Bonus mensal parceiro ${ref}`;

  const partners = await db.all("SELECT id FROM users WHERE partner_active = 1 AND status_usuario = 'ATIVO' AND is_banned = 0");
  for (const partner of partners) {
    const alreadyGranted = await db.get(
      `
      SELECT id
      FROM credit_transactions
      WHERE user_id = ? AND reason = ?
      LIMIT 1
      `,
      [partner.id, reason]
    );

    if (!alreadyGranted) {
      await adjustCredits(db, {
        userId: partner.id,
        delta: PARTNER_MONTHLY_BONUS,
        reason,
        createdBy: null
      });

      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [partner.id, "Bonus mensal", `Voce recebeu ${PARTNER_MONTHLY_BONUS} creditos de parceiro.`]
      );
    }
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Smart Choice Vendas API" });
});

app.post("/api/track/visit", async (req, res) => {
  try {
    const db = await getDb();
    const sessionId = String(req.body.sessionId || "anon").slice(0, 128);

    await db.run("INSERT INTO visits (session_id) VALUES (?)", [sessionId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Falha ao registrar visita" });
  }
});

app.post("/api/auth/register/start", async (req, res) => {
  try {
    const db = await getDb();
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const requestedPhone = String(req.body.phone || "").trim();

    if (!name || !email) {
      return res.status(400).json({ error: "Nome e email sao obrigatorios" });
    }

    const existing = await db.get("SELECT id, status_usuario, phone FROM users WHERE email = ?", [email]);
    if (requestedPhone) {
      const phoneInUse = await db.get("SELECT id FROM users WHERE phone = ? AND email <> ?", [requestedPhone, email]);
      if (phoneInUse) {
        return res.status(400).json({ error: "Telefone ja cadastrado" });
      }
    }

    if (existing && existing.status_usuario === "ATIVO") {
      return res.status(409).json({ error: "Conta ja ativa para este email" });
    }

    const code = generateCode();
    const expiresAt = addMinutes(new Date(), 15).toISOString();
    const phone = requestedPhone || existing?.phone || buildAutoPhoneTag(email);

    if (existing) {
      await db.run(
        `
        UPDATE users
        SET name = ?, phone = ?, verify_code = ?, verify_code_expires_at = ?, updated_at = datetime('now')
        WHERE id = ?
        `,
        [name, phone, code, expiresAt, existing.id]
      );

      await logActivity(db, {
        actorUserId: null,
        targetUserId: existing.id,
        action: "REGISTER_RESTART",
        details: "Novo codigo enviado"
      });
    } else {
      const result = await db.run(
        `
        INSERT INTO users (name, email, phone, status_usuario, verify_code, verify_code_expires_at)
        VALUES (?, ?, ?, 'PENDING', ?, ?)
        `,
        [name, email, phone, code, expiresAt]
      );

      await logActivity(db, {
        actorUserId: null,
        targetUserId: result.lastID,
        action: "REGISTER_START",
        details: "Cadastro iniciado"
      });
    }

    const emailDelivery = await sendVerificationCodeEmail({ email, name, code });
    const showDevCode = boolFromEnv(process.env.SHOW_DEV_CODE, false);

    let message = "Codigo enviado para validacao no e-mail cadastrado.";
    if (!emailDelivery.sent && emailDelivery.reason === "SMTP_TIMEOUT") {
      message = "Codigo gerado. Envio por e-mail em processamento, verifique sua caixa de entrada em instantes.";
    } else if (!emailDelivery.sent) {
      message = "Codigo gerado. Envio de e-mail nao configurado ou falhou, use o codigo dev para teste.";
    }

    const response = {
      ok: true,
      message,
      delivery: emailDelivery
    };

    if (showDevCode) {
      response.dev_code = code;
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ error: "Falha ao iniciar cadastro" });
  }
});

app.post("/api/auth/register/complete", async (req, res) => {
  try {
    const db = await getDb();
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    const password = String(req.body.password || "");

    if (!email || !code || !password) {
      return res.status(400).json({ error: "Email, codigo e senha sao obrigatorios" });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: "Senha fraca. Use no minimo 8 caracteres com letra maiuscula, minuscula, numero e simbolo."
      });
    }

    const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }

    if (user.verify_code !== code) {
      return res.status(400).json({ error: "Codigo invalido" });
    }

    if (!user.verify_code_expires_at || new Date(user.verify_code_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Codigo expirado" });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.exec("BEGIN TRANSACTION");
    try {
      await db.run(
        `
        UPDATE users
        SET password_hash = ?,
            status_usuario = 'ATIVO',
            verify_code = NULL,
            verify_code_expires_at = NULL,
            updated_at = datetime('now')
        WHERE id = ?
        `,
        [hash, user.id]
      );

      if (!user.activation_bonus_granted) {
        await adjustCredits(db, {
          userId: user.id,
          delta: 50,
          reason: "Cadastro inicial",
          createdBy: null
        });

        await db.run("UPDATE users SET activation_bonus_granted = 1 WHERE id = ?", [user.id]);
      }

      await logActivity(db, {
        actorUserId: null,
        targetUserId: user.id,
        action: "REGISTER_COMPLETE",
        details: "Conta ativada e bonus inicial aplicado"
      });

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    return res.json({ ok: true, message: "Cadastro validado com sucesso" });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao concluir cadastro" });
  }
});

app.post("/api/auth/resend-code", async (req, res) => {
  try {
    const db = await getDb();
    const email = String(req.body.email || "").trim().toLowerCase();
    const channel = String(req.body.channel || "email").toUpperCase();

    const user = await db.get("SELECT id, status_usuario, name, email FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }

    if (user.status_usuario === "ATIVO") {
      return res.status(400).json({ error: "Conta ja ativa" });
    }

    const code = generateCode();
    const expiresAt = addMinutes(new Date(), 15).toISOString();

    await db.run(
      "UPDATE users SET verify_code = ?, verify_code_expires_at = ?, updated_at = datetime('now') WHERE id = ?",
      [code, expiresAt, user.id]
    );

    await logActivity(db, {
      actorUserId: null,
      targetUserId: user.id,
      action: "VERIFY_CODE_RESEND",
      details: `Canal: ${channel}`
    });

    const emailDelivery = await sendVerificationCodeEmail({ email: user.email, name: user.name, code });
    const showDevCode = boolFromEnv(process.env.SHOW_DEV_CODE, false);

    let message = `Codigo reenviado via ${channel}`;
    if (!emailDelivery.sent && emailDelivery.reason === "SMTP_TIMEOUT") {
      message = `Codigo gerado e envio via ${channel} em processamento. Aguarde alguns instantes.`;
    } else if (!emailDelivery.sent) {
      message = "Codigo gerado, mas o envio de e-mail nao foi concluido. Use o codigo dev para teste.";
    }

    const response = {
      ok: true,
      message,
      delivery: emailDelivery
    };

    if (showDevCode) {
      response.dev_code = code;
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ error: "Falha ao reenviar codigo" });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const db = await getDb();
    const identifier = String(req.body.identifier || req.body.email || req.body.phone || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await db.get(
      "SELECT * FROM users WHERE lower(email) = ? OR lower(phone) = ? OR lower(name) = ? LIMIT 1",
      [identifier, identifier, identifier]
    );
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "Credenciais invalidas" });
    }

    if (user.status_usuario !== "ATIVO") {
      return res.status(403).json({ error: "Conta ainda nao ativada" });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: "Conta bloqueada" });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Credenciais invalidas" });
    }

    const token = signToken(user);
    const showWelcome = Number(user.first_login) === 1;

    if (showWelcome) {
      await db.run("UPDATE users SET first_login = 0 WHERE id = ?", [user.id]);
    }

    let permissions = [];
    if (user.role === "ADMIN") {
      if (Number(user.is_owner) === 1) {
        permissions = [...ADMIN_PERMISSIONS];
      } else {
        const permissionRows = await db.all("SELECT permission FROM admin_permissions WHERE user_id = ?", [user.id]);
        permissions = permissionRows.map((row) => row.permission);
      }
    }

    await logActivity(db, {
      actorUserId: user.id,
      targetUserId: user.id,
      action: "LOGIN_SUCCESS",
      details: "Login realizado"
    });

    return res.json({
      ok: true,
      token,
      showWelcome,
      welcomeMessage: showWelcome ? `Bem-vindo(a), ${user.name}! Seu acesso foi liberado.` : null,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_owner: Boolean(user.is_owner),
        permissions,
        credits: user.credits,
        partner_active: Boolean(user.partner_active),
        created_at: user.created_at
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha no login" });
  }
});

app.get("/api/me", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const user = await getUserById(db, req.auth.sub);
    if (!user) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }

    return res.json({ ok: true, user });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar perfil" });
  }
});

app.get("/api/me/transactions", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `
      SELECT id, delta, reason, created_at
      FROM credit_transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 100
      `,
      [req.auth.sub]
    );

    return res.json({ ok: true, transactions: rows });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar extrato" });
  }
});

app.get("/api/me/notifications", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      "SELECT id, title, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50",
      [req.auth.sub]
    );

    return res.json({ ok: true, notifications: rows });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar notificacoes" });
  }
});

app.post("/api/me/notifications/:id/read", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const notificationId = toInt(req.params.id);

    await db.run("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", [notificationId, req.auth.sub]);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar notificacao" });
  }
});

app.get("/api/products", optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const brand = String(req.query.brand || "").trim();
    const onlyBeginner = String(req.query.onlyBeginner || "0") === "1";

    let query = "SELECT * FROM products WHERE is_active = 1";
    const params = [];

    if (brand) {
      query += " AND brand = ?";
      params.push(brand);
    }

    if (onlyBeginner) {
      query += " AND is_beginner_offer = 1";
    }

    query += " ORDER BY id DESC";

    const products = await db.all(query, params);

    let isBeginner = false;
    if (req.auth && req.auth.sub) {
      const user = await db.get("SELECT created_at FROM users WHERE id = ?", [req.auth.sub]);
      isBeginner = user ? isBeginnerAccount(user.created_at, BEGINNER_DAYS) : false;
    }

    const normalized = products.map((item) => {
      const discountedCash = Number(item.price_cash) * (1 - Number(item.discount_percent || 0) / 100);
      const beginnerAllowed = item.is_beginner_offer && isBeginner && item.beginner_price;
      const displayPrice = beginnerAllowed ? Number(item.beginner_price) : discountedCash;

      return {
        ...item,
        display_price: displayPrice,
        beginner_eligible: beginnerAllowed
      };
    });

    return res.json({
      ok: true,
      beginner_days_limit: BEGINNER_DAYS,
      brands: ["Xiaomi", "Redmi", "Realme", "iPhone", "Samsung"],
      products: normalized
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar produtos" });
  }
});

app.get("/api/products/:id/reviews", async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.params.id);

    const rows = await db.all(
      `
      SELECT r.id, r.rating, r.comment, r.photo_url, r.created_at, u.name
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.product_id = ?
      ORDER BY r.id DESC
      `,
      [productId]
    );

    return res.json({ ok: true, reviews: rows });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar avaliacoes" });
  }
});

app.post("/api/reviews", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.body.productId);
    const rating = toInt(req.body.rating);
    const comment = String(req.body.comment || "").trim();
    const photoUrl = String(req.body.photoUrl || "").trim();

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Nota precisa ser entre 1 e 5" });
    }

    await db.run(
      `
      INSERT INTO reviews (user_id, product_id, rating, comment, photo_url)
      VALUES (?, ?, ?, ?, ?)
      `,
      [req.auth.sub, productId, rating, comment, photoUrl]
    );

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao salvar avaliacao" });
  }
});

app.post("/api/orders/cash", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.body.productId);
    const quantity = Math.max(1, toInt(req.body.quantity, 1));

    const product = await db.get("SELECT * FROM products WHERE id = ? AND is_active = 1", [productId]);
    if (!product) {
      return res.status(404).json({ error: "Produto nao encontrado" });
    }

    if (product.stock < quantity) {
      return res.status(400).json({ error: "Estoque insuficiente" });
    }

    const totalCash = Number(product.price_cash) * quantity;
    const creditReward = Math.max(10, Math.round(totalCash / 100));

    const result = await db.run(
      `
      INSERT INTO orders (user_id, product_id, quantity, total_cash, total_credits, status, credit_reward)
      VALUES (?, ?, ?, ?, 0, 'PENDING', ?)
      `,
      [req.auth.sub, productId, quantity, totalCash, creditReward]
    );

    return res.json({
      ok: true,
      order: {
        id: result.lastID,
        productId: product.id,
        productTitle: product.title,
        quantity,
        totalCash,
        creditReward,
        status: "PENDING"
      },
      message: "Pedido criado. Aprovacao de creditos sera feita pelo admin apos confirmacao."
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao criar pedido" });
  }
});

app.post("/api/orders/credits/purchase", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.body.productId);
    const quantity = Math.max(1, toInt(req.body.quantity, 1));

    const user = await db.get("SELECT id, credits FROM users WHERE id = ?", [req.auth.sub]);
    const product = await db.get("SELECT * FROM products WHERE id = ? AND is_active = 1", [productId]);

    if (!user || !product) {
      return res.status(404).json({ error: "Usuario ou produto nao encontrado" });
    }

    if (product.stock < quantity) {
      return res.status(400).json({ error: "Estoque insuficiente" });
    }

    const totalCredits = Number(product.price_credits) * quantity;
    if (user.credits < totalCredits) {
      return res.status(400).json({ error: "Saldo insuficiente para troca" });
    }

    await db.exec("BEGIN TRANSACTION");
    try {
      await db.run("UPDATE users SET credits = credits - ?, updated_at = datetime('now') WHERE id = ?", [totalCredits, user.id]);
      await db.run(
        "INSERT INTO credit_transactions (user_id, delta, reason) VALUES (?, ?, ?)",
        [user.id, -totalCredits, `Troca por produto #${product.id}`]
      );
      await db.run(
        `
        INSERT INTO orders (user_id, product_id, quantity, total_cash, total_credits, status, approved_at)
        VALUES (?, ?, ?, 0, ?, 'APPROVED', datetime('now'))
        `,
        [user.id, product.id, quantity, totalCredits]
      );
      await db.run("UPDATE products SET stock = stock - ? WHERE id = ?", [quantity, product.id]);

      await logActivity(db, {
        actorUserId: user.id,
        targetUserId: user.id,
        action: "CREDIT_PURCHASE",
        details: `Produto ${product.id}, quantidade ${quantity}`
      });

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    return res.json({ ok: true, message: "Compra com creditos concluida" });
  } catch (error) {
    return res.status(500).json({ error: "Falha na compra por creditos" });
  }
});
app.post("/api/support/triage", optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const name = String(req.body.name || "").trim();
    const orderNumber = String(req.body.orderNumber || "").trim();
    const subject = String(req.body.subject || "").trim();
    const question = String(req.body.question || "").trim();
    const forceHuman = Boolean(req.body.forceHuman);

    if (!name || !subject || !question) {
      return res.status(400).json({ error: "Nome, assunto e pergunta sao obrigatorios" });
    }

    const faqRows = await db.all("SELECT question, answer, keywords FROM faq_entries");
    const result = forceHuman
      ? {
          resolved: false,
          answer: "Solicitacao encaminhada diretamente para atendimento humano."
        }
      : triageFaq(question, faqRows);

    if (result.resolved) {
      return res.json({
        ok: true,
        resolved: true,
        answer: result.answer,
        source: result.faqQuestion
      });
    }

    const created = await db.run(
      `
        INSERT INTO tickets (user_id, name, order_number, subject, message, ai_attempted, ai_resolution)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [req.auth?.sub || null, name, orderNumber, subject, question, forceHuman ? 0 : 1, result.answer]
    );

    return res.json({
      ok: true,
      resolved: false,
      message: "Ticket criado para atendimento humano",
      ticketId: created.lastID
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha na triagem" });
  }
});

app.post("/api/partner/apply", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const docType = String(req.body.docType || "").trim().toUpperCase();
    const docValue = String(req.body.docValue || "").trim();
    const region = String(req.body.region || "").trim();

    if (!["CPF", "CNPJ"].includes(docType) || !docValue || !region) {
      return res.status(400).json({ error: "Informe CPF/CNPJ e regiao" });
    }

    await db.run(
      `
      INSERT INTO partner_applications (user_id, doc_type, doc_value, region)
      VALUES (?, ?, ?, ?)
      `,
      [req.auth.sub, docType, docValue, region]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: req.auth.sub,
      action: "PARTNER_APPLICATION",
      details: `${docType} - ${region}`
    });

    return res.json({ ok: true, message: "Solicitacao enviada para analise" });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao enviar solicitacao" });
  }
});

app.get("/api/partner/dashboard", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get("SELECT partner_active, credits FROM users WHERE id = ?", [req.auth.sub]);
    const ref = monthRef();

    const goal = await db.get(
      `
      SELECT target_sales, current_sales
      FROM partner_goals
      WHERE user_id = ? AND month_ref = ?
      `,
      [req.auth.sub, ref]
    );

    return res.json({
      ok: true,
      partnerActive: Boolean(user?.partner_active),
      monthlyBonus: PARTNER_MONTHLY_BONUS,
      credits: user?.credits || 0,
      goal: goal || { target_sales: 10, current_sales: 0 }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar dashboard de parceiro" });
  }
});

app.get("/api/admin/me", authRequired, adminRequired, async (req, res) => {
  try {
    const db = await getDb();
    const context = await getAdminContext(db, req.auth.sub);
    if (!context) {
      return res.status(403).json({ error: "Acesso restrito ao admin" });
    }

    const user = await db.get("SELECT id, name, email, role, is_owner FROM users WHERE id = ?", [req.auth.sub]);
    return res.json({
      ok: true,
      user: {
        ...user,
        is_owner: Boolean(user?.is_owner),
        permissions: [...context.permissions]
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar contexto admin" });
  }
});

app.get("/api/admin/permissions/catalog", authRequired, adminRequired, requireAdminPermission("USERS_PERMISSIONS"), async (_req, res) => {
  return res.json({
    ok: true,
    permissions: ADMIN_PERMISSIONS,
    default_permissions: DEFAULT_ADMIN_PERMISSIONS
  });
});

app.post("/api/admin/users", authRequired, adminRequired, requireAdminPermission("USERS_CREATE"), async (req, res) => {
  const db = await getDb();

  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const phoneInput = String(req.body.phone || "").trim();
    const password = String(req.body.password || "");
    const roleInput = String(req.body.role || "USER").toUpperCase();
    const role = ["USER", "ADMIN"].includes(roleInput) ? roleInput : "USER";
    const statusInput = String(req.body.status_usuario || "ATIVO").toUpperCase();
    const statusUsuario = ["ATIVO", "PENDING", "INATIVO"].includes(statusInput) ? statusInput : "ATIVO";
    const initialCredits = toInt(req.body.initialCredits, 0);
    const requestedPermissions = sanitizePermissions(req.body.permissions || []);

    if (!name || !email || !isStrongPassword(password)) {
      return res.status(400).json({
        error: "Nome, email e senha forte sao obrigatorios (8+ com maiuscula, minuscula, numero e simbolo)"
      });
    }

    let phone = phoneInput || buildAutoPhoneTag(email);

    const emailExists = await db.get("SELECT id FROM users WHERE lower(email) = lower(?)", [email]);
    if (emailExists) {
      return res.status(409).json({ error: "Email ja cadastrado" });
    }

    if (phoneInput) {
      const phoneExists = await db.get("SELECT id FROM users WHERE phone = ?", [phoneInput]);
      if (phoneExists) {
        return res.status(409).json({ error: "Telefone ja cadastrado" });
      }
    } else {
      // Fallback in the unlikely case of generated collision.
      let attempts = 0;
      while (attempts < 5) {
        const collision = await db.get("SELECT id FROM users WHERE phone = ?", [phone]);
        if (!collision) {
          break;
        }
        phone = buildAutoPhoneTag(`${email}-${attempts}`);
        attempts += 1;
      }

      const stillCollision = await db.get("SELECT id FROM users WHERE phone = ?", [phone]);
      if (stillCollision) {
        return res.status(500).json({ error: "Falha ao gerar identificador de contato unico" });
      }
    }

    if (role === "ADMIN" && !req.adminContext.isOwner && !req.adminContext.permissions.has("USERS_ROLE")) {
      return res.status(403).json({ error: "Permissao obrigatoria: USERS_ROLE" });
    }

    if (requestedPermissions.length > 0 && !req.adminContext.isOwner && !req.adminContext.permissions.has("USERS_PERMISSIONS")) {
      return res.status(403).json({ error: "Permissao obrigatoria: USERS_PERMISSIONS" });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.exec("BEGIN TRANSACTION");
    try {
      const created = await db.run(
        `
        INSERT INTO users (name, email, phone, password_hash, role, status_usuario, credits, first_login, activation_bonus_granted, is_owner, is_banned)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, 0, 0)
        `,
        [name, email, phone, hash, role, statusUsuario]
      );

      const newUserId = created.lastID;
      let effectivePermissions = [];

      if (role === "ADMIN") {
        effectivePermissions = requestedPermissions.length > 0 ? requestedPermissions : DEFAULT_ADMIN_PERMISSIONS;
        await setAdminPermissions(db, newUserId, effectivePermissions, req.auth.sub);
      }

      if (initialCredits !== 0) {
        await adjustCredits(db, {
          userId: newUserId,
          delta: initialCredits,
          reason: "Credito inicial via painel admin",
          createdBy: req.auth.sub
        });
      }

      await logActivity(db, {
        actorUserId: req.auth.sub,
        targetUserId: newUserId,
        action: "ADMIN_USER_CREATE",
        details: JSON.stringify({ role, statusUsuario, initialCredits })
      });

      await db.exec("COMMIT");

      return res.json({
        ok: true,
        user: {
          id: newUserId,
          name,
          email,
          phone,
          role,
          status_usuario: statusUsuario,
          permissions: effectivePermissions
        }
      });
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    return res.status(500).json({ error: "Falha ao criar usuario/admin" });
  }
});

app.get("/api/admin/users", authRequired, adminRequired, requireAdminPermission("USERS_VIEW"), async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `
      SELECT u.id, u.name, u.email, u.phone, u.role, u.status_usuario, u.credits, u.is_banned, u.partner_active, u.is_owner, u.created_at,
             COALESCE((
               SELECT GROUP_CONCAT(ap.permission, ',')
               FROM admin_permissions ap
               WHERE ap.user_id = u.id
             ), '') AS permissions_csv
      FROM users u
      ORDER BY u.id DESC
      `
    );

    const users = rows.map((row) => ({
      ...row,
      permissions: row.permissions_csv ? row.permissions_csv.split(",").filter(Boolean) : []
    }));

    return res.json({ ok: true, users });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar usuarios" });
  }
});

app.patch("/api/admin/users/:id", authRequired, adminRequired, requireAdminPermission("USERS_EDIT"), async (req, res) => {
  try {
    const db = await getDb();
    const targetId = toInt(req.params.id);
    const roleInput = req.body.role ? String(req.body.role).toUpperCase() : null;
    const statusInput = req.body.status_usuario ? String(req.body.status_usuario).toUpperCase() : null;
    const isBanned = req.body.is_banned;
    const partnerActive = req.body.partner_active;

    const target = await db.get("SELECT id, role, is_owner FROM users WHERE id = ?", [targetId]);
    if (!target) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }

    if (Number(target.is_owner) === 1 && req.auth.sub !== targetId) {
      return res.status(403).json({ error: "Conta owner nao pode ser alterada por outro admin" });
    }

    const nextRole = roleInput && ["USER", "ADMIN"].includes(roleInput) ? roleInput : undefined;
    const nextStatus = statusInput && ["ATIVO", "PENDING", "INATIVO"].includes(statusInput) ? statusInput : undefined;

    if (nextRole !== undefined && !req.adminContext.isOwner && !req.adminContext.permissions.has("USERS_ROLE")) {
      return res.status(403).json({ error: "Permissao obrigatoria: USERS_ROLE" });
    }

    if (typeof isBanned === "boolean" && !req.adminContext.isOwner && !req.adminContext.permissions.has("USERS_BAN")) {
      return res.status(403).json({ error: "Permissao obrigatoria: USERS_BAN" });
    }

    if (typeof partnerActive === "boolean" && !req.adminContext.isOwner && !req.adminContext.permissions.has("PARTNER_MANAGE")) {
      return res.status(403).json({ error: "Permissao obrigatoria: PARTNER_MANAGE" });
    }

    if (Number(target.is_owner) === 1) {
      if (nextRole && nextRole !== "ADMIN") {
        return res.status(400).json({ error: "Owner nao pode perder perfil admin" });
      }

      if (isBanned === true) {
        return res.status(400).json({ error: "Owner nao pode ser banido" });
      }
    }

    await db.run(
      `
      UPDATE users
      SET role = COALESCE(?, role),
          status_usuario = COALESCE(?, status_usuario),
          is_banned = COALESCE(?, is_banned),
          partner_active = COALESCE(?, partner_active),
          updated_at = datetime('now')
      WHERE id = ?
      `,
      [
        nextRole === undefined ? null : nextRole,
        nextStatus === undefined ? null : nextStatus,
        typeof isBanned === "boolean" ? (isBanned ? 1 : 0) : null,
        typeof partnerActive === "boolean" ? (partnerActive ? 1 : 0) : null,
        targetId
      ]
    );

    if (typeof partnerActive === "boolean" && partnerActive) {
      const ref = monthRef();
      await db.run(
        `
        INSERT OR IGNORE INTO partner_goals (user_id, target_sales, current_sales, month_ref)
        VALUES (?, 10, 0, ?)
        `,
        [targetId, ref]
      );
    }

    if (nextRole === "ADMIN") {
      const permissionCount = await db.get("SELECT COUNT(*) AS total FROM admin_permissions WHERE user_id = ?", [targetId]);
      if (!permissionCount || permissionCount.total === 0) {
        await setAdminPermissions(db, targetId, DEFAULT_ADMIN_PERMISSIONS, req.auth.sub);
      }
    }

    if (nextRole === "USER") {
      await db.run("DELETE FROM admin_permissions WHERE user_id = ?", [targetId]);
    }

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: targetId,
      action: "ADMIN_USER_UPDATE",
      details: JSON.stringify(req.body)
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar usuario" });
  }
});

app.put("/api/admin/users/:id/permissions", authRequired, adminRequired, requireAdminPermission("USERS_PERMISSIONS"), async (req, res) => {
  try {
    const db = await getDb();
    const targetId = toInt(req.params.id);

    const target = await db.get("SELECT id, role, is_owner FROM users WHERE id = ?", [targetId]);
    if (!target || target.role !== "ADMIN") {
      return res.status(404).json({ error: "Admin alvo nao encontrado" });
    }

    if (Number(target.is_owner) === 1) {
      return res.status(400).json({ error: "Permissoes do owner nao podem ser alteradas" });
    }

    const normalizedPermissions = sanitizePermissions(req.body.permissions || []);
    const saved = await setAdminPermissions(db, targetId, normalizedPermissions, req.auth.sub);

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: targetId,
      action: "ADMIN_PERMISSIONS_UPDATE",
      details: JSON.stringify(saved)
    });

    return res.json({ ok: true, permissions: saved });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar permissoes" });
  }
});

app.post("/api/admin/credits/adjust", authRequired, adminRequired, requireAdminPermission("CREDITS_ADJUST"), async (req, res) => {
  try {
    const db = await getDb();
    const targetUserId = toInt(req.body.userId);
    const delta = toInt(req.body.delta);
    const reason = String(req.body.reason || "Ajuste manual admin").trim();
    const masterKey = String(req.body.masterKey || "");

    if (masterKey !== MASTER_KEY) {
      return res.status(401).json({ error: "Master key invalida" });
    }

    if (!targetUserId || !delta) {
      return res.status(400).json({ error: "userId e delta sao obrigatorios" });
    }

    await adjustCredits(db, {
      userId: targetUserId,
      delta,
      reason,
      createdBy: req.auth.sub
    });

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId,
      action: "ADMIN_CREDIT_ADJUST",
      details: `${delta} - ${reason}`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao ajustar creditos" });
  }
});

app.get("/api/admin/orders", authRequired, adminRequired, requireAdminPermission("ORDERS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `
      SELECT o.id, o.user_id, u.name AS user_name, o.product_id, p.title AS product_title,
             o.quantity, o.total_cash, o.total_credits, o.status, o.credit_reward, o.created_at, o.approved_at
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN products p ON p.id = o.product_id
      ORDER BY o.id DESC
      `
    );

    return res.json({ ok: true, orders: rows });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar pedidos" });
  }
});

app.post("/api/admin/orders/:id/approve", authRequired, adminRequired, requireAdminPermission("ORDERS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = toInt(req.params.id);

    const order = await db.get("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!order) {
      return res.status(404).json({ error: "Pedido nao encontrado" });
    }

    if (order.status === "APPROVED") {
      return res.status(400).json({ error: "Pedido ja aprovado" });
    }

    await db.exec("BEGIN TRANSACTION");
    try {
      await db.run("UPDATE orders SET status = 'APPROVED', approved_at = datetime('now') WHERE id = ?", [orderId]);

      if (order.credit_reward > 0) {
        await adjustCredits(db, {
          userId: order.user_id,
          delta: order.credit_reward,
          reason: `Compra aprovada pelo ADM (Pedido #${orderId})`,
          createdBy: req.auth.sub
        });
      }

      await db.run("UPDATE products SET stock = stock - ? WHERE id = ?", [order.quantity, order.product_id]);

      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [order.user_id, "Pedido aprovado", `Seu pedido #${orderId} foi aprovado.`]
      );

      const user = await db.get("SELECT partner_active FROM users WHERE id = ?", [order.user_id]);
      if (user && user.partner_active) {
        const ref = monthRef();
        await db.run(
          `
          INSERT OR IGNORE INTO partner_goals (user_id, target_sales, current_sales, month_ref)
          VALUES (?, 10, 0, ?)
          `,
          [order.user_id, ref]
        );
        await db.run(
          "UPDATE partner_goals SET current_sales = current_sales + 1 WHERE user_id = ? AND month_ref = ?",
          [order.user_id, ref]
        );
      }

      await logActivity(db, {
        actorUserId: req.auth.sub,
        targetUserId: order.user_id,
        action: "ORDER_APPROVED",
        details: `Pedido #${orderId}`
      });

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao aprovar pedido" });
  }
});

app.get("/api/admin/products", authRequired, adminRequired, requireAdminPermission("PRODUCTS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const products = await db.all(
      `
      SELECT id, title, brand, category, description, technical_specs, price_cash, price_credits, beginner_price, discount_percent,
             image_url, video_url, stock, is_beginner_offer, promoted, is_active, created_at
      FROM products
      ORDER BY id DESC
      `
    );

    return res.json({ ok: true, products });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar produtos do painel admin" });
  }
});

app.post("/api/admin/products", authRequired, adminRequired, requireAdminPermission("PRODUCTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const payload = req.body || {};

    const result = await db.run(
      `
      INSERT INTO products (title, brand, category, description, technical_specs, price_cash, price_credits, beginner_price, image_url, video_url, stock, is_beginner_offer, promoted, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        String(payload.title || ""),
        String(payload.brand || ""),
        String(payload.category || "CELULAR"),
        String(payload.description || ""),
        String(payload.technical_specs || ""),
        Number(payload.price_cash || 0),
        toInt(payload.price_credits),
        payload.beginner_price == null ? null : Number(payload.beginner_price),
        String(payload.image_url || ""),
        String(payload.video_url || ""),
        toInt(payload.stock),
        payload.is_beginner_offer ? 1 : 0,
        payload.promoted ? 1 : 0
      ]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_PRODUCT_CREATE",
      details: `Produto #${result.lastID}`
    });

    return res.json({ ok: true, productId: result.lastID });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao criar produto" });
  }
});

app.put("/api/admin/products/:id", authRequired, adminRequired, requireAdminPermission("PRODUCTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.params.id);
    const payload = req.body || {};

    await db.run(
      `
      UPDATE products
      SET title = COALESCE(?, title),
          brand = COALESCE(?, brand),
          category = COALESCE(?, category),
          description = COALESCE(?, description),
          technical_specs = COALESCE(?, technical_specs),
          price_cash = COALESCE(?, price_cash),
          price_credits = COALESCE(?, price_credits),
          beginner_price = COALESCE(?, beginner_price),
          image_url = COALESCE(?, image_url),
          video_url = COALESCE(?, video_url),
          stock = COALESCE(?, stock),
          is_beginner_offer = COALESCE(?, is_beginner_offer),
          promoted = COALESCE(?, promoted),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
      `,
      [
        payload.title == null ? null : String(payload.title),
        payload.brand == null ? null : String(payload.brand),
        payload.category == null ? null : String(payload.category),
        payload.description == null ? null : String(payload.description),
        payload.technical_specs == null ? null : String(payload.technical_specs),
        payload.price_cash == null ? null : Number(payload.price_cash),
        payload.price_credits == null ? null : toInt(payload.price_credits),
        payload.beginner_price == null ? null : Number(payload.beginner_price),
        payload.image_url == null ? null : String(payload.image_url),
        payload.video_url == null ? null : String(payload.video_url),
        payload.stock == null ? null : toInt(payload.stock),
        payload.is_beginner_offer == null ? null : (payload.is_beginner_offer ? 1 : 0),
        payload.promoted == null ? null : (payload.promoted ? 1 : 0),
        payload.is_active == null ? null : (payload.is_active ? 1 : 0),
        productId
      ]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_PRODUCT_UPDATE",
      details: `Produto #${productId}`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar produto" });
  }
});

app.delete("/api/admin/products/:id", authRequired, adminRequired, requireAdminPermission("PRODUCTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.params.id);

    await db.run("UPDATE products SET is_active = 0 WHERE id = ?", [productId]);

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_PRODUCT_DISABLE",
      details: `Produto #${productId}`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao remover produto" });
  }
});

app.get("/api/admin/tickets", authRequired, adminRequired, requireAdminPermission("TICKETS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `
      SELECT t.id, t.user_id, t.name, t.order_number, t.subject, t.message, t.status, t.ai_resolution,
             t.admin_response, t.responded_at, t.created_at
      FROM tickets t
      ORDER BY t.id DESC
      `
    );

    return res.json({ ok: true, tickets: rows });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar tickets" });
  }
});

app.post("/api/admin/tickets/:id/respond", authRequired, adminRequired, requireAdminPermission("TICKETS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const ticketId = toInt(req.params.id);
    const responseText = String(req.body.response || "").trim();

    if (!responseText) {
      return res.status(400).json({ error: "Resposta obrigatoria" });
    }

    const ticket = await db.get("SELECT id, user_id FROM tickets WHERE id = ?", [ticketId]);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket nao encontrado" });
    }

    await db.run(
      `
      UPDATE tickets
      SET status = 'ANSWERED', admin_response = ?, responded_by = ?, responded_at = datetime('now')
      WHERE id = ?
      `,
      [responseText, req.auth.sub, ticketId]
    );

    if (ticket.user_id) {
      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [ticket.user_id, "Ticket respondido", `Seu ticket #${ticketId} recebeu resposta.`]
      );
    }

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: ticket.user_id,
      action: "ADMIN_TICKET_RESPONSE",
      details: `Ticket #${ticketId}`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao responder ticket" });
  }
});

app.get("/api/admin/logs", authRequired, adminRequired, requireAdminPermission("LOGS_VIEW"), async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `
      SELECT l.id, l.action, l.details, l.created_at,
             actor.name AS actor_name,
             target.name AS target_name
      FROM activity_logs l
      LEFT JOIN users actor ON actor.id = l.actor_user_id
      LEFT JOIN users target ON target.id = l.target_user_id
      ORDER BY l.id DESC
      LIMIT 300
      `
    );

    return res.json({ ok: true, logs: rows });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar logs" });
  }
});

app.get("/api/admin/analytics", authRequired, adminRequired, requireAdminPermission("ANALYTICS_VIEW"), async (_req, res) => {
  try {
    const db = await getDb();

    const visitors = await db.all(
      `
      SELECT date(created_at) AS day, COUNT(*) AS total
      FROM visits
      WHERE date(created_at) >= date('now', '-14 day')
      GROUP BY day
      ORDER BY day ASC
      `
    );

    const signups = await db.all(
      `
      SELECT date(created_at) AS day, COUNT(*) AS total
      FROM users
      WHERE date(created_at) >= date('now', '-14 day')
      GROUP BY day
      ORDER BY day ASC
      `
    );

    const sales = await db.get(
      `
      SELECT COALESCE(SUM(total_cash), 0) AS total_sales_cash,
             COUNT(*) AS total_orders_approved
      FROM orders
      WHERE status = 'APPROVED'
      `
    );

    return res.json({
      ok: true,
      visitors,
      signups,
      total_sales_cash: sales.total_sales_cash,
      total_orders_approved: sales.total_orders_approved
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar analytics" });
  }
});

app.post("/api/admin/users/:id/password", authRequired, adminRequired, requireAdminPermission("USERS_PASSWORD_RESET"), async (req, res) => {
  try {
    const db = await getDb();
    const targetId = toInt(req.params.id);
    const newPassword = String(req.body.newPassword || "");

    if (String(req.body.masterKey || "") !== MASTER_KEY) {
      return res.status(401).json({ error: "Master key invalida" });
    }

    const target = await db.get("SELECT id, is_owner FROM users WHERE id = ?", [targetId]);
    if (!target) {
      return res.status(404).json({ error: "Usuario alvo nao encontrado" });
    }

    if (Number(target.is_owner) === 1 && !req.adminContext.isOwner && req.auth.sub !== targetId) {
      return res.status(403).json({ error: "Somente o owner pode redefinir senha do owner" });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: "Nova senha fraca. Use 8+ caracteres com maiuscula, minuscula, numero e simbolo."
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [hash, targetId]);

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: targetId,
      action: "ADMIN_PASSWORD_RESET",
      details: "Senha redefinida pelo admin"
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao redefinir senha" });
  }
});

app.delete("/api/admin/users/:id", authRequired, adminRequired, requireAdminPermission("USERS_DELETE"), async (req, res) => {
  try {
    const db = await getDb();
    const targetId = toInt(req.params.id);

    if (targetId === req.auth.sub) {
      return res.status(400).json({ error: "Nao e permitido remover o proprio admin" });
    }

    const target = await db.get("SELECT id, is_owner FROM users WHERE id = ?", [targetId]);
    if (!target) {
      return res.status(404).json({ error: "Usuario alvo nao encontrado" });
    }

    if (Number(target.is_owner) === 1) {
      return res.status(400).json({ error: "Conta owner nao pode ser removida" });
    }

    await db.exec("BEGIN TRANSACTION");
    try {
      await db.run("DELETE FROM users WHERE id = ?", [targetId]);

      await logActivity(db, {
        actorUserId: req.auth.sub,
        targetUserId: null,
        action: "ADMIN_USER_DELETE",
        details: `Usuario removido (id ${targetId})`
      });

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao remover usuario" });
  }
});

app.post("/api/admin/notifications/send", authRequired, adminRequired, requireAdminPermission("NOTIFICATIONS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const userId = toInt(req.body.userId);
    const title = String(req.body.title || "Aviso").trim();
    const message = String(req.body.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Mensagem obrigatoria" });
    }

    if (userId) {
      await db.run("INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)", [userId, title, message]);
    } else {
      const users = await db.all("SELECT id FROM users WHERE status_usuario = 'ATIVO' AND is_banned = 0");
      for (const user of users) {
        await db.run("INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)", [user.id, title, message]);
      }
    }

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: userId || null,
      action: "ADMIN_NOTIFICATION_SEND",
      details: userId ? `Notificacao para usuario ${userId}` : "Notificacao em massa"
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao enviar notificacao" });
  }
});

app.post("/api/admin/discounts", authRequired, adminRequired, requireAdminPermission("DISCOUNTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.body.productId);
    const discountPercent = Math.max(0, Math.min(80, toInt(req.body.discountPercent)));
    const beginnerOnly = Boolean(req.body.beginnerOnly);

    const product = await db.get("SELECT id, price_cash FROM products WHERE id = ?", [productId]);
    if (!product) {
      return res.status(404).json({ error: "Produto nao encontrado" });
    }

    if (discountPercent === 0) {
      await db.run(
        "UPDATE products SET discount_percent = 0, beginner_price = NULL, is_beginner_offer = 0, promoted = 0 WHERE id = ?",
        [productId]
      );

      await logActivity(db, {
        actorUserId: req.auth.sub,
        action: "ADMIN_DISCOUNT_CLEAR",
        details: `Produto ${productId} desconto removido`
      });

      return res.json({ ok: true, beginner_price: null, removed: true });
    }

    const discounted = Number(product.price_cash) * (1 - discountPercent / 100);

    await db.run(
      "UPDATE products SET discount_percent = ?, beginner_price = ?, is_beginner_offer = ?, promoted = 1 WHERE id = ?",
      [discountPercent, discounted, beginnerOnly ? 1 : 0, productId]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_DISCOUNT_UPDATE",
      details: `Produto ${productId} desconto ${discountPercent}%`
    });

    return res.json({ ok: true, beginner_price: discounted });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar desconto" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Rota nao encontrada" });
});
async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET nao configurado. Copie .env.example para .env e ajuste os valores.");
  }

  await getDb();

  cron.schedule("0 2 1 * *", async () => {
    try {
      await monthlyPartnerBonusJob();
      console.log("[cron] Bonus mensal aplicado");
    } catch (error) {
      console.error("[cron] Falha ao aplicar bonus mensal", error.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`API rodando em http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Falha ao iniciar servidor:", error.message);
  process.exit(1);
});

















