const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcryptjs");
const { ADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require("./permissions");

const DB_PATH = path.join(__dirname, "..", "data.sqlite");
let db;

const DEFAULT_PRODUCTS = [
  { model: "Redmi Note 14", storage: "128GB", price: 1318.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi Note 14", storage: "256GB", price: 1438.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1610792516307-ea5acd9c3b00?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi Note 14 Pro", storage: "128GB", price: 1678.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi Note 15 Pro 5G", storage: "256GB", price: 2518.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi Note 14 Pro 5G", storage: "256GB", price: 2278.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi Note 13", storage: "128GB", price: 1198.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi Note 13", storage: "256GB", price: 1378.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1610945264803-c22b62d2a7b3?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi 13C", storage: "128GB", price: 898.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi 14C", storage: "256GB", price: 1078.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi 14C", storage: "256GB", price: 1138.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi 15C", storage: "256GB", price: 1198.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1523475472560-d2df97ec485c?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi 15C", storage: "128GB", price: 1050, brand: "Redmi", image: "https://images.unsplash.com/photo-1510554310700-42d6557f97d3?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi A5", storage: "64GB", price: 838.8, brand: "Redmi", image: "https://images.unsplash.com/photo-1483478550801-ceba5fe50e8e?auto=format&fit=crop&w=900&q=80" },
  { model: "Redmi A5", storage: "128GB", price: 930, brand: "Redmi", image: "https://images.unsplash.com/photo-1508896694512-1eade5586796?auto=format&fit=crop&w=900&q=80" },
  { model: "Realme C63", storage: "256GB", price: 1258.8, brand: "Realme", image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=900&q=80" },
  { model: "Realme C67", storage: "256GB", price: 1318.8, brand: "Realme", image: "https://images.unsplash.com/photo-1526045612212-70caf35c14df?auto=format&fit=crop&w=900&q=80" },
  { model: "Realme C75", storage: "256GB", price: 1498.8, brand: "Realme", image: "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco M7 Pro 5G", storage: "256GB", price: 1798.8, brand: "Poco", image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80" },
  { model: "Realme Note 60X", storage: "64GB", price: 778.8, brand: "Realme", image: "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=900&q=80" },
  { model: "Realme Note 60", storage: "128GB", price: 930, brand: "Realme", image: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco X7 5G", storage: "512GB", price: 2338.8, brand: "Poco", image: "https://images.unsplash.com/photo-1610792516307-ea5acd9c3b00?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco X7 Pro 5G", storage: "256GB", price: 2518.8, brand: "Poco", image: "https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco X7 Pro 5G", storage: "512GB", price: 2878.8, brand: "Poco", image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco X7 5G", storage: "256GB", price: 2038.8, brand: "Poco", image: "https://images.unsplash.com/photo-1610945264803-c22b62d2a7b3?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco C71", storage: "128GB", price: 930, brand: "Poco", image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80" },
  { model: "Poco C71", storage: "64GB", price: 810, brand: "Poco", image: "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=900&q=80" }
];

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

async function seedDefaultProducts(conn) {
  const stmt = await conn.prepare(
    `
    INSERT INTO products (title, brand, category, description, technical_specs, price_cash, price_credits, beginner_price, discount_percent, image_url, video_url, stock, is_beginner_offer, promoted)
    VALUES (?, ?, 'CELULAR', ?, ?, ?, 3000, NULL, 0, ?, '', 25, 1, ?)
    `
  );

  for (const [index, product] of DEFAULT_PRODUCTS.entries()) {
    const promoted = index < 6 ? 1 : 0;
    await stmt.run(
      `${product.model} - ${product.storage}`,
      product.brand,
      `${product.model} com armazenamento de ${product.storage}.`,
      `Armazenamento: ${product.storage}`,
      product.price,
      product.image,
      promoted
    );
  }

  await stmt.finalize();
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
    await seedDefaultProducts(conn);
  }
}

async function getDb() {
  return connectDb();
}

module.exports = {
  getDb
};
