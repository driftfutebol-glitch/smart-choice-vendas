const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcryptjs");
const { ADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require("./permissions");

const DB_PATH = path.join(__dirname, "..", "data.sqlite");
let db;

async function connectDb() {
  if (db) {
    return db;
  }

  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec("PRAGMA foreign_keys = ON;");
  await initSchema(db);
  return db;
}

async function setPermissionsForUser(conn, userId, permissions, grantedBy = null) {
  await conn.run("DELETE FROM admin_permissions WHERE user_id = ?", [userId]);

  const normalized = [...new Set((permissions || []).filter((item) => ADMIN_PERMISSIONS.includes(item)))];
  for (const permission of normalized) {
    await conn.run(
      "INSERT OR IGNORE INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)",
      [userId, permission, grantedBy]
    );
  }
}

async function ensureDefaultPermissionsForAdmins(conn, ownerId) {
  const admins = await conn.all("SELECT id FROM users WHERE role = 'ADMIN' AND id <> ?", [ownerId]);

  for (const admin of admins) {
    const permissionCount = await conn.get("SELECT COUNT(*) AS total FROM admin_permissions WHERE user_id = ?", [admin.id]);
    if (!permissionCount || permissionCount.total === 0) {
      for (const permission of DEFAULT_ADMIN_PERMISSIONS) {
        await conn.run(
          "INSERT OR IGNORE INTO admin_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)",
          [admin.id, permission, ownerId]
        );
      }
    }
  }
}

async function initSchema(conn) {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'USER',
      status_usuario TEXT NOT NULL DEFAULT 'PENDING',
      credits INTEGER NOT NULL DEFAULT 0,
      first_login INTEGER NOT NULL DEFAULT 1,
      activation_bonus_granted INTEGER NOT NULL DEFAULT 0,
      verify_code TEXT,
      verify_code_expires_at TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      partner_active INTEGER NOT NULL DEFAULT 0,
      is_owner INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'CELULAR',
      description TEXT NOT NULL,
      technical_specs TEXT,
      price_cash REAL NOT NULL,
      price_credits INTEGER NOT NULL,
      beginner_price REAL,
      discount_percent INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      video_url TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      is_beginner_offer INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      promoted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      photo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_cash REAL NOT NULL DEFAULT 0,
      total_credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      credit_reward INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      target_user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      order_number TEXT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      ai_attempted INTEGER NOT NULL DEFAULT 1,
      ai_resolution TEXT,
      admin_response TEXT,
      responded_by INTEGER,
      responded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(responded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('USER','ADMIN')),
      sender_id INTEGER,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS partner_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      doc_value TEXT NOT NULL,
      region TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS partner_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_sales INTEGER NOT NULL DEFAULT 10,
      current_sales INTEGER NOT NULL DEFAULT 0,
      month_ref TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, month_ref),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS faq_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      granted_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, permission),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(granted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_admin_permissions_user ON admin_permissions(user_id);
  `);

  await conn.exec("ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await conn.exec("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'CELULAR'").catch(() => {});
  await conn.exec("ALTER TABLE products ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await conn.exec("ALTER TABLE products ADD COLUMN promoted INTEGER NOT NULL DEFAULT 0").catch(() => {});

  const faqCount = await conn.get("SELECT COUNT(*) AS total FROM faq_entries");
  if (!faqCount || faqCount.total === 0) {
    await conn.run(
      `
      INSERT INTO faq_entries (question, answer, keywords)
      VALUES
      (?, ?, ?),
      (?, ?, ?),
      (?, ?, ?),
      (?, ?, ?)
      `,
      [
        "Qual o prazo de entrega?",
        "Os prazos variam por regiao e sao informados no checkout. Media: 3 a 10 dias uteis.",
        "prazo,entrega,frete,demora",
        "Como funciona reembolso?",
        "Reembolso pode ser solicitado em ate 7 dias corridos apos recebimento, conforme politica da loja.",
        "reembolso,devolucao,estorno",
        "Como funciona garantia?",
        "Todos os aparelhos possuem garantia legal e suporte tecnico conforme fabricante.",
        "garantia,defeito,assistencia",
        "Como falar com humano?",
        "Se a IA nao resolver, um ticket e criado automaticamente para o time responder no painel admin.",
        "humano,atendente,ticket,suporte"
      ]
    );
  }

  const adminName = "pedro dono";
  const adminEmail = "pedro@smartchoicevendas.com";
  const adminPhone = "+556684330286";
  const adminPasswordHash = await bcrypt.hash("12345678", 10);

  const specificAdmin = await conn.get("SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1", [adminEmail]);
  const fallbackAdmin = await conn.get("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id ASC LIMIT 1");
  const targetAdminId = specificAdmin?.id || fallbackAdmin?.id || null;

  let ownerId = targetAdminId;

  if (!targetAdminId) {
    const created = await conn.run(
      `
      INSERT INTO users (name, email, phone, password_hash, role, status_usuario, credits, first_login, activation_bonus_granted, is_owner)
      VALUES (?, ?, ?, ?, 'ADMIN', 'ATIVO', 0, 0, 1, 1)
      `,
      [adminName, adminEmail, adminPhone, adminPasswordHash]
    );

    ownerId = created.lastID;
  } else {
    const emailConflict = await conn.get(
      "SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ? LIMIT 1",
      [adminEmail, targetAdminId]
    );

    if (emailConflict) {
      await conn.run("UPDATE users SET email = ? WHERE id = ?", [`legacy_${emailConflict.id}@smartchoicevendas.local`, emailConflict.id]);
    }

    const phoneConflict = await conn.get(
      "SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1",
      [adminPhone, targetAdminId]
    );

    if (phoneConflict) {
      await conn.run(
        "UPDATE users SET phone = ? WHERE id = ?",
        [`+550000${String(phoneConflict.id).padStart(6, "0")}`, phoneConflict.id]
      );
    }

    await conn.run(
      `
      UPDATE users
      SET name = ?, email = ?, phone = ?, password_hash = ?, role = 'ADMIN', status_usuario = 'ATIVO', is_banned = 0, is_owner = 1
      WHERE id = ?
      `,
      [adminName, adminEmail, adminPhone, adminPasswordHash, targetAdminId]
    );
  }

  await conn.run("UPDATE users SET is_owner = 0 WHERE id <> ?", [ownerId]);

  await setPermissionsForUser(conn, ownerId, ADMIN_PERMISSIONS, ownerId);
  await ensureDefaultPermissionsForAdmins(conn, ownerId);

  const productCount = await conn.get("SELECT COUNT(*) AS total FROM products");
  if (!productCount || productCount.total === 0) {
    await conn.run(
      `
      INSERT INTO products (title, brand, category, description, technical_specs, price_cash, price_credits, beginner_price, discount_percent, image_url, video_url, stock, is_beginner_offer, promoted)
      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "Redmi Note 13",
        "Redmi",
        "CELULAR",
        "Smartphone custo-beneficio com tela AMOLED e bateria forte.",
        "8GB RAM, 256GB, AMOLED 120Hz",
        1599,
        850,
        1399,
        12,
        "https://images.unsplash.com/photo-1616348436168-de43ad0db179?auto=format&fit=crop&w=900&q=60",
        "",
        40,
        1,
        1,
        "Xiaomi 13 Lite",
        "Xiaomi",
        "CELULAR",
        "Modelo premium intermediario da Xiaomi para performance diaria.",
        "8GB RAM, 256GB",
        2199,
        1100,
        1999,
        10,
        "https://images.unsplash.com/photo-1610792516307-ea5acd9c3b00?auto=format&fit=crop&w=900&q=60",
        "",
        22,
        1,
        1,
        "Realme 12 Pro",
        "Realme",
        "CELULAR",
        "Camera destacada com bom desempenho para redes sociais.",
        "8GB RAM, 256GB",
        2399,
        1200,
        2199,
        8,
        "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=900&q=60",
        "",
        19,
        1,
        1,
        "iPhone 14",
        "iPhone",
        "CELULAR",
        "Performance premium com ecossistema Apple.",
        "6GB RAM, 128GB",
        3999,
        1900,
        3799,
        5,
        "https://images.unsplash.com/photo-1678652197831-2d180705cd2c?auto=format&fit=crop&w=900&q=60",
        "",
        18,
        0,
        0,
        "Galaxy S24",
        "Samsung",
        "CELULAR",
        "Camera e IA para uso profissional e pessoal.",
        "8GB RAM, 256GB",
        4299,
        2050,
        4099,
        4,
        "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?auto=format&fit=crop&w=900&q=60",
        "",
        15,
        0,
        0,
        "Fone Bluetooth Pro",
        "Xiaomi",
        "ACESSORIO",
        "Acessorio com cancelamento de ruido para dia a dia.",
        "Bluetooth 5.3, ANC",
        299,
        180,
        259,
        10,
        "https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=900&q=60",
        "",
        80,
        1,
        1
      ]
    );
  }
}

async function getDb() {
  return connectDb();
}

module.exports = {
  getDb
};
