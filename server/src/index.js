
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
const { runAdminAgent } = require("./services/adminAgentAi");
const { generateSupportAgentReply } = require("./services/supportAgentAi");
const { ADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require("./permissions");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 4000);
const BEGINNER_DAYS = Number(process.env.BEGINNER_DAYS || 30);
const PARTNER_MONTHLY_BONUS = Number(process.env.PARTNER_MONTHLY_BONUS || 100);
const MASTER_KEY = String(process.env.MASTER_KEY || "03142911");
const WOMENS_CAMPAIGN_NAME = String(process.env.WOMENS_CAMPAIGN_NAME || "Especial Dia da Mulher");
const WOMENS_CAMPAIGN_START = String(process.env.WOMENS_CAMPAIGN_START || "2026-03-08T00:00:00-03:00");
const WOMENS_CAMPAIGN_END = String(process.env.WOMENS_CAMPAIGN_END || "2026-03-10T00:00:00-03:00");
const WOMENS_CAMPAIGN_DISCOUNT_PERCENT = Math.max(0, Math.min(80, Number(process.env.WOMENS_CAMPAIGN_DISCOUNT_PERCENT || 10)));
const WOMENS_CAMPAIGN_MARKUP_PERCENT = Math.max(0, Math.min(80, Number(process.env.WOMENS_CAMPAIGN_MARKUP_PERCENT || 12)));
const CHECKOUT_CREDIT_COUPON_COST = Math.max(1, Math.min(1000, Number(process.env.CHECKOUT_CREDIT_COUPON_COST || 50)));
const CHECKOUT_CREDIT_COUPON_PERCENT = Math.max(0, Math.min(30, Number(process.env.CHECKOUT_CREDIT_COUPON_PERCENT || 5)));
const LOW_STOCK_THRESHOLD_DEFAULT = Math.max(1, Math.min(100, Number(process.env.LOW_STOCK_THRESHOLD_DEFAULT || 5)));
const SUPPORT_AGENT_AUTOREPLY_ENABLED = boolFromEnv(process.env.SUPPORT_AGENT_AUTOREPLY_ENABLED, true);
const SUPPORT_AGENT_RESPONSE_DELAY_MINUTES = Math.max(
  1,
  Math.min(120, Number(process.env.SUPPORT_AGENT_RESPONSE_DELAY_MINUTES || 5))
);
const SUPPORT_AGENT_MAX_REPLIES_PER_RUN = Math.max(
  1,
  Math.min(50, Number(process.env.SUPPORT_AGENT_MAX_REPLIES_PER_RUN || 8))
);
const SUPPORT_AGENT_CRON = String(process.env.SUPPORT_AGENT_CRON || "* * * * *").trim();
const SUPPORT_AGENT_INSTANT_REPLY_ENABLED = boolFromEnv(process.env.SUPPORT_AGENT_INSTANT_REPLY_ENABLED, true);

const ORDER_STATUS_COLUMNS = Object.freeze([
  "PENDING",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED"
]);

const ORDER_STATUS_ALIAS = Object.freeze({
  APPROVED: "PAID",
  ANSWERED: "PROCESSING"
});

const SEED_PRODUCTS = [
  { title: "Redmi Note 14", brand: "Xiaomi", storage: "128GB", price: 1318.8, image: "https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi Note 14", brand: "Xiaomi", storage: "256GB", price: 1438.8, image: "https://images.unsplash.com/photo-1610792516307-ea5acd9c3b00?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi Note 14 Pro", brand: "Xiaomi", storage: "128GB", price: 1678.8, image: "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi Note 15 Pro 5G", brand: "Xiaomi", storage: "256GB", price: 2518.8, image: "https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi Note 14 Pro 5G", brand: "Xiaomi", storage: "256GB", price: 2278.8, image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi Note 13", brand: "Xiaomi", storage: "128GB", price: 1198.8, image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi Note 13", brand: "Xiaomi", storage: "256GB", price: 1378.8, image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi 13C", brand: "Xiaomi", storage: "128GB", price: 898.8, image: "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi 14C", brand: "Xiaomi", storage: "256GB", price: 1078.8, image: "https://images.unsplash.com/photo-1610945264799-9f1e94c9b8cd?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi 14C", brand: "Xiaomi", storage: "256GB", price: 1138.8, image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi 15C", brand: "Xiaomi", storage: "256GB", price: 1198.8, image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi 15C", brand: "Xiaomi", storage: "128GB", price: 1050, image: "https://images.unsplash.com/photo-1523475472560-d2df97ec485c?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi A5", brand: "Xiaomi", storage: "64GB", price: 838.8, image: "https://images.unsplash.com/photo-1510554310700-42d6557f97d3?auto=format&fit=crop&w=900&q=70" },
  { title: "Redmi A5", brand: "Xiaomi", storage: "128GB", price: 930, image: "https://images.unsplash.com/photo-1483478550801-ceba5fe50e8e?auto=format&fit=crop&w=900&q=70" },
  { title: "Realme C63", brand: "Realme", storage: "256GB", price: 1258.8, image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=70" },
  { title: "Realme C67", brand: "Realme", storage: "256GB", price: 1318.8, image: "https://images.unsplash.com/photo-1508896694512-1eade5586796?auto=format&fit=crop&w=900&q=70" },
  { title: "Realme C75", brand: "Realme", storage: "256GB", price: 1498.8, image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco M7 Pro 5G", brand: "Poco", storage: "256GB", price: 1798.8, image: "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=900&q=70" },
  { title: "Realme Note 60X", brand: "Realme", storage: "64GB", price: 778.8, image: "https://images.unsplash.com/photo-1481277542470-605612bd2d61?auto=format&fit=crop&w=900&q=70" },
  { title: "Realme Note 60", brand: "Realme", storage: "128GB", price: 930, image: "https://images.unsplash.com/photo-1526045612212-70caf35c14df?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco X7 5G", brand: "Poco", storage: "512GB", price: 2338.8, image: "https://images.unsplash.com/photo-1481277542470-605612bd2d61?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco X7 Pro 5G", brand: "Poco", storage: "256GB", price: 2518.8, image: "https://images.unsplash.com/photo-1506617420156-8e4536971650?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco X7 Pro 5G", brand: "Poco", storage: "512GB", price: 2878.8, image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco X7 5G", brand: "Poco", storage: "256GB", price: 2038.8, image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco C71", brand: "Poco", storage: "128GB", price: 930, image: "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=900&q=70" },
  { title: "Poco C71", brand: "Poco", storage: "64GB", price: 810, image: "https://images.unsplash.com/photo-1508896694512-1eade5586796?auto=format&fit=crop&w=900&q=70" }
];

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getWomensCampaignWindow(referenceDate = new Date()) {
  const startAt = new Date(WOMENS_CAMPAIGN_START);
  const endAt = new Date(WOMENS_CAMPAIGN_END);
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  const invalidWindow = Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt;
  if (invalidWindow) {
    return {
      name: WOMENS_CAMPAIGN_NAME,
      active: false,
      campaign_markup_percent: WOMENS_CAMPAIGN_MARKUP_PERCENT,
      discount_percent: WOMENS_CAMPAIGN_DISCOUNT_PERCENT,
      start_at: WOMENS_CAMPAIGN_START,
      end_at: WOMENS_CAMPAIGN_END
    };
  }

  return {
    name: WOMENS_CAMPAIGN_NAME,
    active: now >= startAt && now < endAt,
    campaign_markup_percent: WOMENS_CAMPAIGN_MARKUP_PERCENT,
    discount_percent: WOMENS_CAMPAIGN_DISCOUNT_PERCENT,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString()
  };
}

function applyCampaignMarkup(priceCash, campaign) {
  if (!campaign?.active) {
    return roundMoney(priceCash);
  }

  const marked = Number(priceCash || 0) * (1 + Number(campaign.campaign_markup_percent || 0) / 100);
  return roundMoney(marked);
}

function applyCampaignDiscount(priceCash, campaign) {
  if (!campaign?.active) {
    return roundMoney(priceCash);
  }

  const discounted = Number(priceCash || 0) * (1 - Number(campaign.discount_percent || 0) / 100);
  return roundMoney(discounted);
}

function normalizeOrderStatus(rawStatus) {
  const normalized = String(rawStatus || "").trim().toUpperCase();
  if (ORDER_STATUS_ALIAS[normalized]) {
    return ORDER_STATUS_ALIAS[normalized];
  }
  return normalized;
}

function isValidOrderStatus(rawStatus) {
  const status = normalizeOrderStatus(rawStatus);
  return ORDER_STATUS_COLUMNS.includes(status);
}

function isPurchasedStatus(rawStatus) {
  const status = normalizeOrderStatus(rawStatus);
  return ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status);
}

async function getActiveCampaign(db, referenceDate = new Date()) {
  const fallback = getWomensCampaignWindow(referenceDate);
  const nowIso = (referenceDate instanceof Date ? referenceDate : new Date(referenceDate)).toISOString();

  try {
    const campaign = await db.get(
      `
      SELECT id, name, discount_percent, campaign_markup_percent, start_at, end_at, is_active, priority
      FROM campaigns
      WHERE is_active = 1
        AND datetime(start_at) <= datetime(?)
        AND datetime(end_at) > datetime(?)
      ORDER BY priority DESC, id DESC
      LIMIT 1
      `,
      [nowIso, nowIso]
    );

    if (!campaign) {
      return fallback;
    }

    return {
      id: campaign.id,
      name: String(campaign.name || fallback.name),
      active: true,
      campaign_markup_percent: Math.max(0, Math.min(80, Number(campaign.campaign_markup_percent || 0))),
      discount_percent: Math.max(0, Math.min(80, Number(campaign.discount_percent || 0))),
      start_at: campaign.start_at,
      end_at: campaign.end_at,
      source: "admin_campaign"
    };
  } catch (_error) {
    return fallback;
  }
}

async function seedProducts(db, force = false) {
  const existing = await db.get("SELECT COUNT(*) as total FROM products");
  if (!force && existing && existing.total > 0) {
    return false;
  }

  await db.exec("BEGIN");
  await db.run("DELETE FROM products");

  const stmt = await db.prepare(
    `
    INSERT INTO products (title, brand, category, description, technical_specs, price_cash, price_credits, beginner_price, discount_percent, image_url, video_url, stock, is_beginner_offer, promoted, is_active)
    VALUES (?, ?, 'CELULAR', ?, ?, ?, ?, NULL, 0, ?, NULL, ?, 1, ?, 1)
    `
  );

  for (const [index, p] of SEED_PRODUCTS.entries()) {
    const desc = `${p.title} ${p.storage} - lançamento Smart Choice Vendas`;
    const specs = `Armazenamento ${p.storage}`;
    const promoted = index < 4 ? 1 : 0;
    await stmt.run(p.title, p.brand, desc, specs, p.price, 3000, p.image, 25, promoted);
  }

  await stmt.finalize();
  await db.exec("COMMIT");
  return true;
}

async function ensureDefaultCampaign(db) {
  const count = await db.get("SELECT COUNT(*) AS total FROM campaigns").catch(() => ({ total: 0 }));
  if (Number(count?.total || 0) > 0) {
    return;
  }

  const startAt = new Date(WOMENS_CAMPAIGN_START);
  const endAt = new Date(WOMENS_CAMPAIGN_END);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return;
  }

  await db.run(
    `
    INSERT INTO campaigns (name, discount_percent, campaign_markup_percent, start_at, end_at, is_active, priority, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 10, datetime('now'))
    `,
    [WOMENS_CAMPAIGN_NAME, WOMENS_CAMPAIGN_DISCOUNT_PERCENT, WOMENS_CAMPAIGN_MARKUP_PERCENT, startAt.toISOString(), endAt.toISOString()]
  ).catch(() => {});
}

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

function toBool(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes", "sim"].includes(normalized);
  }

  return false;
}

function normalizePaymentMethod(value) {
  const normalized = String(value || "PIX").trim().toUpperCase();
  const allowed = ["PIX", "WHATSAPP", "CARTAO", "BOLETO"];
  return allowed.includes(normalized) ? normalized : "PIX";
}

function normalizeCheckoutChannel(value) {
  const normalized = String(value || "CHAT_HUMANO").trim().toUpperCase();
  const allowed = ["CHAT_HUMANO", "WHATSAPP"];
  return allowed.includes(normalized) ? normalized : "CHAT_HUMANO";
}

function parseRequiredDate(value, fieldName) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data invalida para ${fieldName}`);
  }
  return date.toISOString();
}

async function loadTicketForAccess(db, ticketId, auth) {
  const ticket = await db.get("SELECT id, user_id, status FROM tickets WHERE id = ?", [ticketId]);
  if (!ticket) {
    return { error: "Ticket nao encontrado", status: 404 };
  }

  const isAdmin = auth?.role === "ADMIN";
  const isOwner = ticket.user_id && auth?.sub === ticket.user_id;

  if (!isAdmin && !isOwner) {
    return { error: "Sem acesso a este ticket", status: 403 };
  }

  return { ticket };
}

function normalizeTicketStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function isTicketClosedStatus(status) {
  return ["ANSWERED", "CLOSED", "RESOLVED"].includes(normalizeTicketStatus(status));
}

function isStrongPassword(password) {
  const candidate = String(password || "");
  // At least 8 chars with upper, lower, number and special char.
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(candidate);
}
async function buildAdminAgentServerContext(db, stockThresholdRaw = null) {
  const threshold = Math.max(1, Math.min(100, toInt(stockThresholdRaw, LOW_STOCK_THRESHOLD_DEFAULT)));
  const now = Date.now();
  const minus24hIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const minus48hIso = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  const [
    usersTotalRow,
    adminsTotalRow,
    activeProductsRow,
    outOfStockRow,
    lowStockRow,
    pendingOrdersRow,
    delayedPendingOrdersRow,
    openTicketsRow,
    sensitiveLogsRow,
    creditAdjustLogsRow
  ] = await Promise.all([
    db.get("SELECT COUNT(*) AS total FROM users"),
    db.get("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN'"),
    db.get("SELECT COUNT(*) AS total FROM products WHERE is_active = 1"),
    db.get("SELECT COUNT(*) AS total FROM products WHERE is_active = 1 AND stock <= 0"),
    db.get("SELECT COUNT(*) AS total FROM products WHERE is_active = 1 AND stock > 0 AND stock <= ?", [threshold]),
    db.get("SELECT COUNT(*) AS total FROM orders WHERE UPPER(COALESCE(status,'')) = 'PENDING'"),
    db.get(
      "SELECT COUNT(*) AS total FROM orders WHERE UPPER(COALESCE(status,'')) = 'PENDING' AND created_at <= ?",
      [minus48hIso]
    ),
    db.get(
      "SELECT COUNT(*) AS total FROM tickets WHERE UPPER(COALESCE(status,'')) NOT IN ('ANSWERED','CLOSED','RESOLVED')"
    ),
    db.get(
      `
      SELECT COUNT(*) AS total
      FROM activity_logs
      WHERE created_at >= ?
        AND (
          UPPER(COALESCE(action,'')) LIKE '%CREDIT%'
          OR UPPER(COALESCE(action,'')) LIKE '%DELETE%'
          OR UPPER(COALESCE(action,'')) LIKE '%PASSWORD%'
          OR UPPER(COALESCE(action,'')) LIKE '%PERMISSION%'
          OR UPPER(COALESCE(action,'')) LIKE '%CAMPAIGN%'
          OR UPPER(COALESCE(action,'')) LIKE '%ORDER_%'
        )
      `,
      [minus24hIso]
    ),
    db.get(
      `
      SELECT COUNT(*) AS total
      FROM activity_logs
      WHERE created_at >= ?
        AND UPPER(COALESCE(action,'')) LIKE '%CREDIT%'
      `,
      [minus24hIso]
    )
  ]);

  return {
    stockThreshold: threshold,
    usersTotal: Number(usersTotalRow?.total || 0),
    adminsTotal: Number(adminsTotalRow?.total || 0),
    activeProducts: Number(activeProductsRow?.total || 0),
    outOfStockProducts: Number(outOfStockRow?.total || 0),
    lowStockProducts: Number(lowStockRow?.total || 0),
    pendingOrders: Number(pendingOrdersRow?.total || 0),
    delayedPendingOrders: Number(delayedPendingOrdersRow?.total || 0),
    openTickets: Number(openTicketsRow?.total || 0),
    sensitiveLogs24h: Number(sensitiveLogsRow?.total || 0),
    creditAdjustLogs24h: Number(creditAdjustLogsRow?.total || 0)
  };
}

let supportAgentSweepRunning = false;

async function appendSupportAgentMessage(db, ticket, replyText, source = "fallback") {
  await db.run(
    `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES (?, 'ADMIN', NULL, ?)`,
    [ticket.id, replyText]
  );

  if (ticket.user_id) {
    await db.run("INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)", [
      ticket.user_id,
      "Agente IA respondeu seu ticket",
      `Ticket #${ticket.id}: o agente IA respondeu no chat e seguirá com você até o time humano assumir.`
    ]);
  }

  await logActivity(db, {
    actorUserId: null,
    targetUserId: ticket.user_id || null,
    action: "SUPPORT_AGENT_AUTO_REPLY",
    details: `Ticket #${ticket.id}; source=${source || "fallback"}`
  });
}

async function runSupportAutoReplySweep() {
  if (!SUPPORT_AGENT_AUTOREPLY_ENABLED) {
    return { ok: true, skipped: true, reason: "SUPPORT_AGENT_DISABLED" };
  }

  if (supportAgentSweepRunning) {
    return { ok: true, skipped: true, reason: "SUPPORT_AGENT_BUSY" };
  }

  supportAgentSweepRunning = true;

  try {
    const db = await getDb();
    const limitScan = Math.max(20, SUPPORT_AGENT_MAX_REPLIES_PER_RUN * 6);
    const nowMs = Date.now();
    const cutoffMs = nowMs - SUPPORT_AGENT_RESPONSE_DELAY_MINUTES * 60 * 1000;

    const candidates = await db.all(
      `
      SELECT t.id, t.user_id, t.name, t.order_number, t.subject, t.status, t.created_at,
             lm.sender_type AS last_sender_type, lm.body AS last_body, lm.created_at AS last_message_at
      FROM tickets t
      JOIN ticket_messages lm ON lm.id = (
        SELECT tm.id
        FROM ticket_messages tm
        WHERE tm.ticket_id = t.id
        ORDER BY tm.id DESC
        LIMIT 1
      )
      WHERE UPPER(COALESCE(t.status,'')) NOT IN ('ANSWERED','CLOSED','RESOLVED')
      ORDER BY datetime(lm.created_at) ASC, lm.id ASC
      LIMIT ?
      `,
      [limitScan]
    );

    if (!candidates.length) {
      return { ok: true, scanned: 0, replied: 0 };
    }

    const faqRows = await db.all("SELECT question, answer, keywords FROM faq_entries");
    let replied = 0;

    for (const ticket of candidates) {
      if (replied >= SUPPORT_AGENT_MAX_REPLIES_PER_RUN) {
        break;
      }

      const lastSenderType = String(ticket.last_sender_type || "").trim().toUpperCase();
      if (lastSenderType !== "USER") {
        continue;
      }

      const lastMessageAtMs = new Date(ticket.last_message_at).getTime();
      if (!Number.isFinite(lastMessageAtMs) || lastMessageAtMs > cutoffMs) {
        continue;
      }

      const aiResult = await generateSupportAgentReply({
        ticket,
        customerMessage: ticket.last_body,
        faqRows,
        delayMinutes: SUPPORT_AGENT_RESPONSE_DELAY_MINUTES
      });

      const replyText = String(aiResult?.reply || "").trim();
      if (!replyText) {
        continue;
      }

      await appendSupportAgentMessage(db, ticket, replyText, aiResult?.source || "fallback");

      replied += 1;
    }

    return { ok: true, scanned: candidates.length, replied };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Falha no sweep da agente de suporte"
    };
  } finally {
    supportAgentSweepRunning = false;
  }
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

app.get("/api/me/orders", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.max(1, Math.min(80, toInt(req.query.limit, 25)));

    const rows = await db.all(
      `
      SELECT o.id, o.product_id, p.title AS product_title, p.brand AS product_brand, p.image_url,
             o.quantity, o.total_cash, o.total_credits, o.credit_reward, o.status, o.created_at,
             o.approved_at, o.status_updated_at, o.payment_method, o.checkout_channel
      FROM orders o
      JOIN products p ON p.id = o.product_id
      WHERE o.user_id = ?
      ORDER BY o.id DESC
      LIMIT ?
      `,
      [req.auth.sub, limit]
    );

    const withReviewStatus = [];
    for (const row of rows) {
      const review = await db.get(
        "SELECT id FROM reviews WHERE user_id = ? AND product_id = ? LIMIT 1",
        [req.auth.sub, row.product_id]
      );

      withReviewStatus.push({
        ...row,
        status: normalizeOrderStatus(row.status),
        can_review: isPurchasedStatus(row.status) && !review,
        already_reviewed: Boolean(review)
      });
    }

    return res.json({ ok: true, orders: withReviewStatus });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar pedidos do usuario" });
  }
});

app.get("/api/products", optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const brand = String(req.query.brand || "").trim();
    const onlyBeginner = String(req.query.onlyBeginner || "0") === "1";
    const campaign = await getActiveCampaign(db);

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
      const discountedCash = roundMoney(Number(item.price_cash) * (1 - Number(item.discount_percent || 0) / 100));
      const campaignBasePrice = applyCampaignMarkup(discountedCash, campaign);
      const campaignPrice = applyCampaignDiscount(campaignBasePrice, campaign);
      const beginnerAllowed = item.is_beginner_offer && isBeginner && item.beginner_price;
      const beginnerPrice = beginnerAllowed ? Number(item.beginner_price) : null;
      const displayPrice = beginnerAllowed ? Math.min(beginnerPrice, campaignPrice) : campaignPrice;

      return {
        ...item,
        display_price: roundMoney(displayPrice),
        beginner_eligible: beginnerAllowed,
        campaign_applied: Boolean(campaign.active),
        price_before_campaign: campaignBasePrice
      };
    });

    const brandRows = await db.all("SELECT DISTINCT brand FROM products WHERE is_active = 1 ORDER BY brand ASC");

    return res.json({
      ok: true,
      beginner_days_limit: BEGINNER_DAYS,
      campaign,
      brands: brandRows.map((row) => row.brand),
      products: normalized
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar produtos" });
  }
});

app.get("/api/reviews", async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.query.productId);
    const limitRaw = toInt(req.query.limit, 24);
    const limit = Math.max(1, Math.min(80, limitRaw || 24));

    const whereClauses = ["p.is_active = 1"];
    const params = [];

    if (productId) {
      whereClauses.push("r.product_id = ?");
      params.push(productId);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const rows = await db.all(
      `
      SELECT r.id, r.product_id, r.rating, r.comment, r.photo_url, r.created_at, r.verified_purchase,
             u.name AS user_name, p.title AS product_title, p.brand AS product_brand
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      JOIN products p ON p.id = r.product_id
      ${whereSql}
      ORDER BY datetime(r.created_at) DESC, r.id DESC
      LIMIT ?
      `,
      [...params, limit]
    );

    const summary = await db.get(
      `
      SELECT COUNT(*) AS total, ROUND(COALESCE(AVG(r.rating), 0), 2) AS average_rating
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      ${whereSql}
      `,
      params
    );

    return res.json({
      ok: true,
      reviews: rows,
      summary: {
        total: Number(summary?.total || 0),
        average_rating: Number(summary?.average_rating || 0)
      }
    });
  } catch (error) {
    try {
      const db = await getDb();
      const productId = toInt(req.query.productId);
      const limitRaw = toInt(req.query.limit, 24);
      const limit = Math.max(1, Math.min(80, limitRaw || 24));

      const whereClauses = ["p.is_active = 1"];
      const params = [];

      if (productId) {
        whereClauses.push("r.product_id = ?");
        params.push(productId);
      }

      const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const rows = await db.all(
        `
        SELECT r.id, r.product_id, r.rating, r.comment, r.photo_url, r.created_at,
               0 AS verified_purchase,
               COALESCE(u.name, 'Cliente Smart Choice') AS user_name,
               COALESCE(p.title, 'Produto') AS product_title,
               COALESCE(p.brand, 'Smart Choice') AS product_brand
        FROM reviews r
        LEFT JOIN users u ON u.id = r.user_id
        LEFT JOIN products p ON p.id = r.product_id
        ${whereSql}
        ORDER BY datetime(r.created_at) DESC, r.id DESC
        LIMIT ?
        `,
        [...params, limit]
      );

      const total = rows.length;
      const sum = rows.reduce((acc, item) => acc + Number(item.rating || 0), 0);

      return res.json({
        ok: true,
        reviews: rows,
        summary: {
          total,
          average_rating: total ? Number((sum / total).toFixed(2)) : 0
        }
      });
    } catch (_fallbackError) {
      return res.status(500).json({ error: "Falha ao carregar avaliacoes" });
    }
  }
});

app.get("/api/products/:id/reviews", async (req, res) => {
  try {
    const db = await getDb();
    const productId = toInt(req.params.id);

    const rows = await db.all(
      `
      SELECT r.id, r.rating, r.comment, r.photo_url, r.created_at, r.verified_purchase, u.name
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      JOIN products p ON p.id = r.product_id
      WHERE r.product_id = ? AND p.is_active = 1
      ORDER BY datetime(r.created_at) DESC, r.id DESC
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
    const comment = String(req.body.comment || "").trim().slice(0, 800);
    const photoUrl = String(req.body.photoUrl || "").trim().slice(0, 500);

    if (!productId) {
      return res.status(400).json({ error: "Produto da avaliacao e obrigatorio" });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Nota precisa ser entre 1 e 5" });
    }

    const product = await db.get("SELECT id, is_active FROM products WHERE id = ?", [productId]);
    if (!product || !product.is_active) {
      return res.status(404).json({ error: "Produto nao encontrado para avaliacao" });
    }

    const existingReview = await db.get("SELECT id FROM reviews WHERE user_id = ? AND product_id = ? LIMIT 1", [
      req.auth.sub,
      productId
    ]);
    if (existingReview) {
      return res.status(400).json({ error: "Voce ja avaliou este produto." });
    }

    const purchaseOrder = await db.get(
      `
      SELECT id, status
      FROM orders
      WHERE user_id = ?
        AND product_id = ?
        AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','APPROVED')
      ORDER BY id DESC
      LIMIT 1
      `,
      [req.auth.sub, productId]
    );

    if (!purchaseOrder) {
      return res.status(403).json({ error: "Avaliacao permitida apenas para clientes que compraram este produto." });
    }

    await db.run(
      `
      INSERT INTO reviews (user_id, product_id, rating, comment, photo_url, verified_purchase, order_id)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      `,
      [req.auth.sub, productId, rating, comment, photoUrl, purchaseOrder.id]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: req.auth.sub,
      action: "USER_REVIEW_CREATE",
      details: `Avaliacao enviada para produto ${productId}`
    });

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
    const useCreditCoupon = toBool(req.body.useCreditCoupon);
    const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
    const checkoutChannel = normalizeCheckoutChannel(req.body.paymentChannel || req.body.checkoutChannel);
    const campaign = await getActiveCampaign(db);

    const product = await db.get("SELECT * FROM products WHERE id = ? AND is_active = 1", [productId]);
    if (!product) {
      return res.status(404).json({ error: "Produto nao encontrado" });
    }

    if (product.stock < quantity) {
      return res.status(400).json({ error: "Estoque insuficiente" });
    }

    const discountedCash = roundMoney(Number(product.price_cash) * (1 - Number(product.discount_percent || 0) / 100));
    const campaignBaseCash = applyCampaignMarkup(discountedCash, campaign);
    const campaignCash = applyCampaignDiscount(campaignBaseCash, campaign);

    const couponDiscountRate = useCreditCoupon ? CHECKOUT_CREDIT_COUPON_PERCENT / 100 : 0;
    const couponDiscountPerUnit = useCreditCoupon ? roundMoney(campaignCash * couponDiscountRate) : 0;
    const finalUnitCash = roundMoney(campaignCash - couponDiscountPerUnit);
    const totalCash = roundMoney(finalUnitCash * quantity);
    const creditReward = Math.max(10, Math.round(totalCash / 100));

    await db.exec("BEGIN TRANSACTION");
    try {
      const result = await db.run(
        `
        INSERT INTO orders (
          user_id, product_id, quantity, total_cash, total_credits, status, credit_reward,
          payment_method, checkout_channel, coupon_credits_used, coupon_discount_percent, status_updated_at
        )
        VALUES (?, ?, ?, ?, 0, 'PENDING', ?, ?, ?, ?, ?, datetime('now'))
        `,
        [
          req.auth.sub,
          productId,
          quantity,
          totalCash,
          creditReward,
          paymentMethod,
          checkoutChannel,
          useCreditCoupon ? CHECKOUT_CREDIT_COUPON_COST : 0,
          useCreditCoupon ? CHECKOUT_CREDIT_COUPON_PERCENT : 0
        ]
      );

      if (useCreditCoupon) {
        const debitCoupon = await db.run(
          "UPDATE users SET credits = credits - ?, updated_at = datetime('now') WHERE id = ? AND credits >= ?",
          [CHECKOUT_CREDIT_COUPON_COST, req.auth.sub, CHECKOUT_CREDIT_COUPON_COST]
        );

        if (!debitCoupon.changes) {
          throw new Error("Saldo insuficiente para usar cupom de creditos.");
        }

        await db.run(
          "INSERT INTO credit_transactions (user_id, delta, reason, created_by) VALUES (?, ?, ?, ?)",
          [req.auth.sub, -CHECKOUT_CREDIT_COUPON_COST, `Cupom checkout ${CHECKOUT_CREDIT_COUPON_PERCENT}% no pedido #${result.lastID}`, req.auth.sub]
        );

        await logActivity(db, {
          actorUserId: req.auth.sub,
          targetUserId: req.auth.sub,
          action: "CHECKOUT_COUPON_REDEEM",
          details: `Pedido ${result.lastID} com cupom de ${CHECKOUT_CREDIT_COUPON_COST} creditos`
        });
      }

      await db.exec("COMMIT");

      const user = await db.get("SELECT id, credits FROM users WHERE id = ?", [req.auth.sub]);

      return res.json({
        ok: true,
        order: {
          id: result.lastID,
          productId: product.id,
          productTitle: product.title,
          quantity,
          totalCash,
          unitCash: finalUnitCash,
          unitCashBeforeCampaignDiscount: campaignBaseCash,
          unitCashBeforeCoupon: campaignCash,
          couponApplied: Boolean(useCreditCoupon),
          couponCreditsUsed: useCreditCoupon ? CHECKOUT_CREDIT_COUPON_COST : 0,
          couponDiscountPercent: useCreditCoupon ? CHECKOUT_CREDIT_COUPON_PERCENT : 0,
          paymentMethod,
          checkoutChannel,
          campaignApplied: Boolean(campaign.active),
          creditReward,
          status: "PENDING"
        },
        user: user
          ? {
              id: user.id,
              credits: Number(user.credits || 0)
            }
          : null,
        message: "Pedido criado. Aprovacao de creditos sera feita pelo admin apos confirmacao."
      });
    } catch (error) {
      await db.exec("ROLLBACK");
      if (/Saldo insuficiente/.test(String(error.message || ""))) {
        return res.status(400).json({ error: "Saldo insuficiente para usar cupom de creditos" });
      }
      throw error;
    }

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
        INSERT INTO orders (
          user_id, product_id, quantity, total_cash, total_credits, status, approved_at,
          payment_method, checkout_channel, coupon_credits_used, coupon_discount_percent, status_updated_at
        )
        VALUES (?, ?, ?, 0, ?, 'DELIVERED', datetime('now'), 'CREDITOS', 'TROCA_CREDITOS', 0, 0, datetime('now'))
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

    await db.run(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES (?, 'USER', ?, ?)`,
      [created.lastID, req.auth?.sub || null, question]
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

app.get("/api/tickets/:id/messages", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const ticketId = toInt(req.params.id);

    const access = await loadTicketForAccess(db, ticketId, req.auth);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const messages = await db.all(
      `
        SELECT id, ticket_id, sender_type, sender_id, body, created_at
        FROM ticket_messages
        WHERE ticket_id = ?
        ORDER BY datetime(created_at) ASC, id ASC
      `,
      [ticketId]
    );

    return res.json({ ok: true, messages, ticketStatus: normalizeTicketStatus(access.ticket.status) });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao buscar mensagens do ticket" });
  }
});

app.post("/api/tickets/:id/messages", authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const ticketId = toInt(req.params.id);
    const body = String(req.body.message || "").trim();

    if (!body) {
      return res.status(400).json({ error: "Mensagem obrigatoria" });
    }

    const access = await loadTicketForAccess(db, ticketId, req.auth);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    if (isTicketClosedStatus(access.ticket.status)) {
      return res.status(409).json({ error: "Ticket finalizado no atendimento" });
    }

    const result = await db.run(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES (?, 'USER', ?, ?)`,
      [ticketId, req.auth.sub, body]
    );

    let agentMessage = null;
    if (SUPPORT_AGENT_INSTANT_REPLY_ENABLED) {
      try {
        const ticketDetails =
          (await db.get("SELECT id, user_id, name, order_number, subject FROM tickets WHERE id = ?", [ticketId])) ||
          {
            id: ticketId,
            user_id: req.auth.sub,
            name: "",
            order_number: "",
            subject: ""
          };

        const faqRows = await db.all("SELECT question, answer, keywords FROM faq_entries");
        const aiResult = await generateSupportAgentReply({
          ticket: ticketDetails,
          customerMessage: body,
          faqRows,
          delayMinutes: 0,
          instantMode: true
        });

        const replyText = String(aiResult?.reply || "").trim();
        if (replyText) {
          await appendSupportAgentMessage(db, ticketDetails, replyText, aiResult?.source || "fallback");
          agentMessage = {
            ticket_id: ticketId,
            sender_type: "ADMIN",
            sender_id: null,
            body: replyText,
            created_at: new Date().toISOString()
          };
        }
      } catch (agentError) {
        console.error("[support-agent] Falha na resposta instantanea:", agentError?.message || agentError);
      }
    }

    return res.json({
      ok: true,
      message: {
        id: result.lastID,
        ticket_id: ticketId,
        sender_type: "USER",
        sender_id: req.auth.sub,
        body,
        created_at: new Date().toISOString()
      },
      agentMessage
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao enviar mensagem" });
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


app.post("/api/admin/agent/chat", authRequired, adminRequired, async (req, res) => {
  try {
    const db = await getDb();
    const command = String(req.body.command || "").trim();
    if (!command || command.length < 2) {
      return res.status(400).json({ error: "Comando do agente e obrigatorio" });
    }

    const clientContext = req.body.context && typeof req.body.context === "object" ? req.body.context : {};
    const serverContext = await buildAdminAgentServerContext(db, clientContext.stockThreshold);
    const mergedContext = {
      ...clientContext,
      ...serverContext,
      alerts: Array.isArray(clientContext.alerts) ? clientContext.alerts : []
    };

    const agent = await runAdminAgent({
      command,
      context: mergedContext
    });

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: null,
      action: "ADMIN_AGENT_CHAT",
      details: `source=${agent.source}${agent.fallbackUsed ? ` fallback=${agent.fallbackReason || "yes"}` : ""}; cmd=${command.slice(0, 120)}`
    });

    return res.json({
      ok: true,
      ...agent,
      context: serverContext
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha no agente administrativo" });
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
             o.quantity, o.total_cash, o.total_credits, o.status, o.credit_reward, o.created_at, o.approved_at,
             o.status_updated_at, o.payment_method, o.checkout_channel, o.coupon_credits_used, o.coupon_discount_percent
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN products p ON p.id = o.product_id
      ORDER BY o.id DESC
      `
    );

    return res.json({
      ok: true,
      orders: rows.map((row) => ({
        ...row,
        status: normalizeOrderStatus(row.status)
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar pedidos" });
  }
});

app.get("/api/admin/orders/kanban", authRequired, adminRequired, requireAdminPermission("ORDERS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `
      SELECT o.id, o.user_id, u.name AS user_name, o.product_id, p.title AS product_title, p.image_url,
             o.quantity, o.total_cash, o.status, o.created_at, o.status_updated_at, o.payment_method
      FROM orders o
      JOIN users u ON u.id = o.user_id
      JOIN products p ON p.id = o.product_id
      ORDER BY o.id DESC
      `
    );

    const normalizedOrders = rows.map((row) => ({
      ...row,
      status: normalizeOrderStatus(row.status)
    }));

    const columns = ORDER_STATUS_COLUMNS.map((status) => ({
      status,
      orders: normalizedOrders.filter((item) => item.status === status)
    }));

    return res.json({ ok: true, columns, orders: normalizedOrders });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar kanban de pedidos" });
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

    const currentStatus = normalizeOrderStatus(order.status);
    if (currentStatus !== "PENDING") {
      return res.status(400).json({ error: `Pedido nao pode ser aprovado no status atual: ${currentStatus}` });
    }

    await db.exec("BEGIN TRANSACTION");
    try {
      await db.run(
        "UPDATE orders SET status = 'PAID', approved_at = datetime('now'), status_updated_at = datetime('now') WHERE id = ?",
        [orderId]
      );

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
        [order.user_id, "Pedido aprovado", `Seu pedido #${orderId} foi aprovado e marcado como pago.`]
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

app.patch("/api/admin/orders/:id/status", authRequired, adminRequired, requireAdminPermission("ORDERS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const orderId = toInt(req.params.id);
    const targetStatus = normalizeOrderStatus(req.body.status);

    if (!isValidOrderStatus(targetStatus)) {
      return res.status(400).json({ error: "Status de pedido invalido" });
    }

    const order = await db.get("SELECT * FROM orders WHERE id = ?", [orderId]);
    if (!order) {
      return res.status(404).json({ error: "Pedido nao encontrado" });
    }

    const currentStatus = normalizeOrderStatus(order.status);
    if (currentStatus === targetStatus) {
      return res.json({ ok: true, status: targetStatus });
    }

    const transitions = {
      PENDING: ["PAID", "CANCELLED"],
      PAID: ["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"],
      PROCESSING: ["SHIPPED", "DELIVERED", "CANCELLED"],
      SHIPPED: ["DELIVERED", "CANCELLED"],
      DELIVERED: [],
      CANCELLED: []
    };

    if (!transitions[currentStatus]?.includes(targetStatus)) {
      return res.status(400).json({ error: `Transicao invalida de ${currentStatus} para ${targetStatus}` });
    }

    if (currentStatus === "PENDING" && targetStatus === "PAID") {
      return res.status(400).json({ error: "Use a acao Aprovar para mover de PENDING para PAID." });
    }

    await db.run("UPDATE orders SET status = ?, status_updated_at = datetime('now') WHERE id = ?", [targetStatus, orderId]);

    if (targetStatus === "SHIPPED") {
      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [order.user_id, "Pedido enviado", `Seu pedido #${orderId} foi enviado.`]
      );
    }

    if (targetStatus === "DELIVERED") {
      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [order.user_id, "Pedido entregue", `Seu pedido #${orderId} foi marcado como entregue.`]
      );
    }

    if (targetStatus === "CANCELLED") {
      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [order.user_id, "Pedido cancelado", `Seu pedido #${orderId} foi cancelado.`]
      );
    }

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: order.user_id,
      action: "ORDER_STATUS_UPDATE",
      details: `Pedido #${orderId}: ${currentStatus} -> ${targetStatus}`
    });

    return res.json({ ok: true, status: targetStatus });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar status do pedido" });
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

app.post("/api/admin/products/seed", authRequired, adminRequired, requireAdminPermission("PRODUCTS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const seeded = await seedProducts(db, true);
    return res.json({ ok: true, seeded: seeded ? SEED_PRODUCTS.length : 0 });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao rodar seed" });
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

app.get("/api/admin/reviews", authRequired, adminRequired, requireAdminPermission("REVIEWS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const reviews = await db.all(
      `
      SELECT r.id, r.user_id, u.name AS user_name, u.email AS user_email,
             r.product_id, p.title AS product_title, p.brand AS product_brand,
             r.rating, r.comment, r.photo_url, r.created_at, r.verified_purchase, r.order_id
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      JOIN products p ON p.id = r.product_id
      ORDER BY datetime(r.created_at) DESC, r.id DESC
      `
    );

    return res.json({ ok: true, reviews });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar avaliacoes no admin" });
  }
});

app.put("/api/admin/reviews/:id", authRequired, adminRequired, requireAdminPermission("REVIEWS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const reviewId = toInt(req.params.id);
    const ratingRaw = req.body.rating;
    const commentRaw = req.body.comment;
    const photoUrlRaw = req.body.photo_url ?? req.body.photoUrl;

    const review = await db.get("SELECT id, user_id FROM reviews WHERE id = ?", [reviewId]);
    if (!review) {
      return res.status(404).json({ error: "Avaliacao nao encontrada" });
    }

    const nextRating = ratingRaw == null ? null : toInt(ratingRaw);
    if (nextRating != null && (nextRating < 1 || nextRating > 5)) {
      return res.status(400).json({ error: "Nota precisa ser entre 1 e 5" });
    }

    await db.run(
      `
      UPDATE reviews
      SET rating = COALESCE(?, rating),
          comment = COALESCE(?, comment),
          photo_url = COALESCE(?, photo_url)
      WHERE id = ?
      `,
      [
        nextRating == null ? null : nextRating,
        commentRaw == null ? null : String(commentRaw).trim().slice(0, 800),
        photoUrlRaw == null ? null : String(photoUrlRaw).trim().slice(0, 500),
        reviewId
      ]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: review.user_id,
      action: "ADMIN_REVIEW_UPDATE",
      details: `Avaliacao #${reviewId} editada`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao editar avaliacao" });
  }
});

app.delete("/api/admin/reviews/:id", authRequired, adminRequired, requireAdminPermission("REVIEWS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const reviewId = toInt(req.params.id);

    const review = await db.get("SELECT id, user_id FROM reviews WHERE id = ?", [reviewId]);
    if (!review) {
      return res.status(404).json({ error: "Avaliacao nao encontrada" });
    }

    await db.run("DELETE FROM reviews WHERE id = ?", [reviewId]);

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: review.user_id,
      action: "ADMIN_REVIEW_DELETE",
      details: `Avaliacao #${reviewId} removida`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao excluir avaliacao" });
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

app.get("/api/admin/tickets/:id/messages", authRequired, adminRequired, requireAdminPermission("TICKETS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const ticketId = toInt(req.params.id);

    const access = await loadTicketForAccess(db, ticketId, req.auth);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const messages = await db.all(
      `
        SELECT id, ticket_id, sender_type, sender_id, body, created_at
        FROM ticket_messages
        WHERE ticket_id = ?
        ORDER BY datetime(created_at) ASC, id ASC
      `,
      [ticketId]
    );

    return res.json({ ok: true, messages, ticketStatus: normalizeTicketStatus(access.ticket.status) });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar mensagens" });
  }
});

app.post("/api/admin/tickets/:id/messages", authRequired, adminRequired, requireAdminPermission("TICKETS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const ticketId = toInt(req.params.id);
    const body = String(req.body.message || "").trim();

    if (!body) {
      return res.status(400).json({ error: "Mensagem obrigatoria" });
    }

    const access = await loadTicketForAccess(db, ticketId, req.auth);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const result = await db.run(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES (?, 'ADMIN', ?, ?)`,
      [ticketId, req.auth.sub, body]
    );

    await db.run("UPDATE tickets SET status = 'ANSWERED', responded_by = ?, responded_at = datetime('now') WHERE id = ?", [
      req.auth.sub,
      ticketId
    ]);

    return res.json({
      ok: true,
      message: {
        id: result.lastID,
        ticket_id: ticketId,
        sender_type: "ADMIN",
        sender_id: req.auth.sub,
        body,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao enviar mensagem como admin" });
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

    await db.run(
      `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, body) VALUES (?, 'ADMIN', ?, ?)`,
      [ticketId, req.auth.sub, responseText]
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

app.patch("/api/admin/tickets/:id/status", authRequired, adminRequired, requireAdminPermission("TICKETS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const ticketId = toInt(req.params.id);
    const nextStatus = normalizeTicketStatus(req.body.status);
    const allowed = ["OPEN", "ANSWERED", "CLOSED"];

    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ error: "Status de ticket invalido" });
    }

    const ticket = await db.get("SELECT id, user_id, status FROM tickets WHERE id = ?", [ticketId]);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket nao encontrado" });
    }

    const currentStatus = normalizeTicketStatus(ticket.status);
    if (currentStatus === nextStatus) {
      return res.json({ ok: true, status: nextStatus });
    }

    const updateSql = nextStatus === "OPEN"
      ? "UPDATE tickets SET status = ?, responded_by = NULL, responded_at = NULL WHERE id = ?"
      : "UPDATE tickets SET status = ?, responded_by = ?, responded_at = datetime('now') WHERE id = ?";
    const updateParams = nextStatus === "OPEN"
      ? [nextStatus, ticketId]
      : [nextStatus, req.auth.sub, ticketId];

    await db.run(updateSql, updateParams);

    if (ticket.user_id) {
      const message = nextStatus === "OPEN"
        ? `Ticket #${ticketId} reaberto pela equipe.`
        : `Ticket #${ticketId} finalizado pela equipe.`;
      await db.run(
        "INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)",
        [ticket.user_id, "Atualizacao do ticket", message]
      );
    }

    await logActivity(db, {
      actorUserId: req.auth.sub,
      targetUserId: ticket.user_id,
      action: "ADMIN_TICKET_STATUS_UPDATE",
      details: `Ticket #${ticketId}: ${currentStatus} -> ${nextStatus}`
    });

    return res.json({ ok: true, status: nextStatus });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao atualizar status do ticket" });
  }
});

app.post("/api/admin/tickets/agent/run", authRequired, adminRequired, requireAdminPermission("TICKETS_MANAGE"), async (_req, res) => {
  try {
    const result = await runSupportAutoReplySweep();
    if (!result.ok) {
      return res.status(500).json({ error: result.error || "Falha ao executar agente de suporte" });
    }
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao executar agente de suporte" });
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
      WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','APPROVED')
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

app.get("/api/admin/reports/stock", authRequired, adminRequired, requireAdminPermission("ANALYTICS_VIEW"), async (req, res) => {
  try {
    const db = await getDb();
    const threshold = Math.max(1, Math.min(100, toInt(req.query.threshold, LOW_STOCK_THRESHOLD_DEFAULT)));

    const lowStock = await db.all(
      `
      SELECT id, title, brand, category, stock, is_active, price_cash
      FROM products
      WHERE is_active = 1 AND stock <= ?
      ORDER BY stock ASC, id DESC
      `,
      [threshold]
    );

    const outOfStock = lowStock.filter((item) => Number(item.stock) <= 0);
    const limitedStock = lowStock.filter((item) => Number(item.stock) > 0);

    return res.json({
      ok: true,
      threshold,
      out_of_stock: outOfStock,
      low_stock: limitedStock,
      total_alerts: lowStock.length
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao gerar relatorio de estoque" });
  }
});

app.get("/api/admin/users/:id/overview", authRequired, adminRequired, requireAdminPermission("USERS_VIEW"), async (req, res) => {
  try {
    const db = await getDb();
    const userId = toInt(req.params.id);
    const user = await db.get(
      `
      SELECT id, name, email, phone, role, status_usuario, credits, created_at, is_banned, partner_active
      FROM users
      WHERE id = ?
      `,
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }

    const [orders, transactions, tickets, reviewsCount] = await Promise.all([
      db.all(
        `
        SELECT o.id, o.status, o.total_cash, o.total_credits, o.quantity, o.created_at,
               p.title AS product_title
        FROM orders o
        JOIN products p ON p.id = o.product_id
        WHERE o.user_id = ?
        ORDER BY o.id DESC
        LIMIT 20
        `,
        [userId]
      ),
      db.all(
        `
        SELECT id, delta, reason, created_at
        FROM credit_transactions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 20
        `,
        [userId]
      ),
      db.all(
        `
        SELECT id, subject, status, created_at, responded_at
        FROM tickets
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 20
        `,
        [userId]
      ),
      db.get("SELECT COUNT(*) AS total FROM reviews WHERE user_id = ?", [userId])
    ]);

    return res.json({
      ok: true,
      user,
      crm: {
        orders: orders.map((item) => ({ ...item, status: normalizeOrderStatus(item.status) })),
        transactions,
        tickets,
        reviews_total: Number(reviewsCount?.total || 0)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao carregar CRM do usuario" });
  }
});

app.get("/api/admin/campaigns", authRequired, adminRequired, requireAdminPermission("DISCOUNTS_MANAGE"), async (_req, res) => {
  try {
    const db = await getDb();
    const campaigns = await db.all(
      `
      SELECT id, name, discount_percent, campaign_markup_percent, start_at, end_at, is_active, priority, created_at, updated_at
      FROM campaigns
      ORDER BY is_active DESC, priority DESC, id DESC
      `
    );

    return res.json({ ok: true, campaigns });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao listar campanhas" });
  }
});

app.post("/api/admin/campaigns", authRequired, adminRequired, requireAdminPermission("DISCOUNTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const name = String(req.body.name || "").trim();
    const discountPercent = Math.max(0, Math.min(80, toInt(req.body.discount_percent ?? req.body.discountPercent)));
    const markupPercent = Math.max(0, Math.min(80, toInt(req.body.campaign_markup_percent ?? req.body.campaignMarkupPercent)));
    const startAt = parseRequiredDate(req.body.start_at ?? req.body.startAt, "start_at");
    const endAt = parseRequiredDate(req.body.end_at ?? req.body.endAt, "end_at");
    const priority = Math.max(-100, Math.min(100, toInt(req.body.priority, 0)));
    const isActive = toBool(req.body.is_active ?? req.body.isActive) ? 1 : 0;

    if (!name) {
      return res.status(400).json({ error: "Nome da campanha e obrigatorio" });
    }

    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      return res.status(400).json({ error: "Data final precisa ser maior que a inicial" });
    }

    const result = await db.run(
      `
      INSERT INTO campaigns (name, discount_percent, campaign_markup_percent, start_at, end_at, is_active, priority, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      [name, discountPercent, markupPercent, startAt, endAt, isActive, priority, req.auth.sub, req.auth.sub]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_CAMPAIGN_CREATE",
      details: `Campanha #${result.lastID} - ${name}`
    });

    return res.json({ ok: true, campaignId: result.lastID });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Falha ao criar campanha" });
  }
});

app.put("/api/admin/campaigns/:id", authRequired, adminRequired, requireAdminPermission("DISCOUNTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const campaignId = toInt(req.params.id);
    const current = await db.get("SELECT id FROM campaigns WHERE id = ?", [campaignId]);
    if (!current) {
      return res.status(404).json({ error: "Campanha nao encontrada" });
    }

    const name = req.body.name == null ? null : String(req.body.name).trim();
    const discountPercent = req.body.discount_percent == null && req.body.discountPercent == null
      ? null
      : Math.max(0, Math.min(80, toInt(req.body.discount_percent ?? req.body.discountPercent)));
    const markupPercent = req.body.campaign_markup_percent == null && req.body.campaignMarkupPercent == null
      ? null
      : Math.max(0, Math.min(80, toInt(req.body.campaign_markup_percent ?? req.body.campaignMarkupPercent)));
    const startAt = req.body.start_at == null && req.body.startAt == null
      ? null
      : parseRequiredDate(req.body.start_at ?? req.body.startAt, "start_at");
    const endAt = req.body.end_at == null && req.body.endAt == null
      ? null
      : parseRequiredDate(req.body.end_at ?? req.body.endAt, "end_at");
    const priority = req.body.priority == null ? null : Math.max(-100, Math.min(100, toInt(req.body.priority, 0)));
    const isActive = req.body.is_active == null && req.body.isActive == null
      ? null
      : (toBool(req.body.is_active ?? req.body.isActive) ? 1 : 0);

    await db.run(
      `
      UPDATE campaigns
      SET name = COALESCE(?, name),
          discount_percent = COALESCE(?, discount_percent),
          campaign_markup_percent = COALESCE(?, campaign_markup_percent),
          start_at = COALESCE(?, start_at),
          end_at = COALESCE(?, end_at),
          is_active = COALESCE(?, is_active),
          priority = COALESCE(?, priority),
          updated_by = ?,
          updated_at = datetime('now')
      WHERE id = ?
      `,
      [name || null, discountPercent, markupPercent, startAt, endAt, isActive, priority, req.auth.sub, campaignId]
    );

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_CAMPAIGN_UPDATE",
      details: `Campanha #${campaignId} atualizada`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Falha ao atualizar campanha" });
  }
});

app.delete("/api/admin/campaigns/:id", authRequired, adminRequired, requireAdminPermission("DISCOUNTS_MANAGE"), async (req, res) => {
  try {
    const db = await getDb();
    const campaignId = toInt(req.params.id);
    const exists = await db.get("SELECT id FROM campaigns WHERE id = ?", [campaignId]);
    if (!exists) {
      return res.status(404).json({ error: "Campanha nao encontrada" });
    }

    await db.run("UPDATE campaigns SET is_active = 0, updated_by = ?, updated_at = datetime('now') WHERE id = ?", [
      req.auth.sub,
      campaignId
    ]);

    await logActivity(db, {
      actorUserId: req.auth.sub,
      action: "ADMIN_CAMPAIGN_DISABLE",
      details: `Campanha #${campaignId} desativada`
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao desativar campanha" });
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

  const db = await getDb();

  const seeded = await seedProducts(db, false);
  if (seeded) {
    console.log(`[seed] ${SEED_PRODUCTS.length} produtos inseridos (auto).`);
  }

  await ensureDefaultCampaign(db);

  cron.schedule(SUPPORT_AGENT_CRON, async () => {
    const result = await runSupportAutoReplySweep();
    if (!result.ok) {
      console.error("[cron] Falha no agente de suporte:", result.error || "erro desconhecido");
      return;
    }
    if (!result.skipped && result.replied > 0) {
      console.log(`[cron] Agente de suporte respondeu ${result.replied} ticket(s) automaticamente.`);
    }
  });

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


















