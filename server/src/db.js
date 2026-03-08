const path = require("path");
const fs = require("fs");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { ADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require("./permissions");

const LEGACY_DB_PATH = path.join(__dirname, "..", "data.sqlite");

function resolveDbPath() {
  const configured = String(process.env.SQLITE_PATH || "").trim();
  if (configured) {
    return path.resolve(configured);
  }

  // Em produção no Render, prioriza /var/data (disk persistente).
  if (process.env.RENDER) {
    return "/var/data/smart-choice-data.sqlite";
  }

  return LEGACY_DB_PATH;
}

const DB_PATH = resolveDbPath();
let db;
let pgPool;

function ensureDbFileLocation() {
  const targetDir = path.dirname(DB_PATH);
  fs.mkdirSync(targetDir, { recursive: true });

  // Migração automática: se mudou para novo caminho e existe banco legado, copia uma vez.
  if (DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  }
}

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

const REVIEW_SEED_USERS = [
  { name: "Lucas Almeida", email: "lucas.cliente@smartchoicevendas.com", phone: "+5511991000001" },
  { name: "Mariana Souza", email: "mariana.cliente@smartchoicevendas.com", phone: "+5511991000002" },
  { name: "Rafael Costa", email: "rafael.cliente@smartchoicevendas.com", phone: "+5511991000003" },
  { name: "Patricia Lima", email: "patricia.cliente@smartchoicevendas.com", phone: "+5511991000004" },
  { name: "Andre Martins", email: "andre.cliente@smartchoicevendas.com", phone: "+5511991000005" },
  { name: "Camila Rocha", email: "camila.cliente@smartchoicevendas.com", phone: "+5511991000006" }
];

const REVIEW_SEED_COMMENTS = [
  {
    rating: 5,
    comment: "Chegou rapido, aparelho lacrado e desempenho excelente no dia a dia.",
    photo: "https://images.unsplash.com/photo-1592890288564-76628a30a657?auto=format&fit=crop&w=700&q=80"
  },
  {
    rating: 5,
    comment: "Atendimento muito bom, suporte respondeu no mesmo dia e tirou todas as duvidas.",
    photo: "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=700&q=80"
  },
  {
    rating: 4,
    comment: "Bom custo-beneficio. Tela e bateria superaram minhas expectativas.",
    photo: "https://images.unsplash.com/photo-1610792516307-ea5acd9c3b00?auto=format&fit=crop&w=700&q=80"
  },
  {
    rating: 5,
    comment: "Comprei para trabalho e estudo, ficou perfeito. Recomendo a loja.",
    photo: "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=700&q=80"
  },
  {
    rating: 4,
    comment: "Entrega dentro do prazo e produto original. Voltarei a comprar.",
    photo: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=700&q=80"
  },
  {
    rating: 5,
    comment: "Curti o programa de creditos e as promocoes para novos clientes.",
    photo: "https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&w=700&q=80"
  }
];

function splitSqlStatements(sqlText) {
  return String(sqlText || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function replaceQuestionPlaceholders(sql) {
  let output = "";
  let placeholderIndex = 1;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : "";

    if (ch === "'" && !inDouble && prev !== "\\") {
      if (inSingle && sql[i + 1] === "'") {
        output += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      output += ch;
      continue;
    }

    if (ch === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
      output += ch;
      continue;
    }

    if (ch === "?" && !inSingle && !inDouble) {
      output += `$${placeholderIndex}`;
      placeholderIndex += 1;
      continue;
    }

    output += ch;
  }

  return output;
}

function translateSqlForPostgres(rawSql) {
  let sql = String(rawSql || "");
  if (!sql.trim()) {
    return "";
  }

  if (/^\s*PRAGMA\s+/i.test(sql)) {
    return "";
  }

  sql = sql.replace(/\r\n/g, "\n");
  sql = sql.replace(/datetime\('now'\)/gi, "NOW()");
  sql = sql.replace(/date\('now',\s*'([+-]?\d+)\s+day'\)/gi, "(CURRENT_DATE + INTERVAL '$1 day')");
  sql = sql.replace(/date\('now'\)/gi, "CURRENT_DATE");
  sql = sql.replace(/datetime\(([^)]+)\)/gi, "$1");
  sql = sql.replace(/GROUP_CONCAT\s*\(\s*([^,]+)\s*,\s*'([^']*)'\s*\)/gi, "STRING_AGG($1, '$2')");

  if (/insert\s+or\s+ignore\s+into/i.test(sql)) {
    sql = sql.replace(/insert\s+or\s+ignore\s+into/i, "INSERT INTO");
    if (!/on\s+conflict/i.test(sql)) {
      sql = `${sql} ON CONFLICT DO NOTHING`;
    }
  }

  sql = replaceQuestionPlaceholders(sql);
  return sql;
}

function parseChangeCount(result) {
  return Number(result?.rowCount || 0);
}

function parseLastInsertId(result) {
  if (!result?.rows?.length) {
    return null;
  }
  const row = result.rows[0];
  if (row.id == null) {
    return null;
  }
  const numeric = Number(row.id);
  return Number.isFinite(numeric) ? numeric : row.id;
}

class PostgresCompatDb {
  constructor(pool) {
    this.pool = pool;
  }

  async query(sql, params = []) {
    const translated = translateSqlForPostgres(sql);
    if (!translated) {
      return { rows: [], rowCount: 0 };
    }

    return this.pool.query(translated, params);
  }

  async exec(sql) {
    const statements = splitSqlStatements(sql);
    for (const statement of statements) {
      if (/^\s*BEGIN(\s+TRANSACTION)?\s*$/i.test(statement)) {
        // Compatibilidade: em Postgres usamos autocommit para manter API simples.
        continue;
      }
      if (/^\s*(COMMIT|ROLLBACK)\s*$/i.test(statement)) {
        continue;
      }
      await this.query(statement);
    }
  }

  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0];
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async run(sql, params = []) {
    const translated = translateSqlForPostgres(sql);
    if (!translated) {
      return { lastID: null, changes: 0 };
    }

    let finalSql = translated;
    if (/^\s*insert\s+/i.test(finalSql) && !/\sreturning\s+/i.test(finalSql)) {
      finalSql = `${finalSql} RETURNING id`;
    }

    const result = await this.pool.query(finalSql, params);
    return {
      lastID: parseLastInsertId(result),
      changes: parseChangeCount(result)
    };
  }

  async prepare(sql) {
    return {
      run: async (...params) => this.run(sql, params),
      finalize: async () => {}
    };
  }
}

function envFlag(value, defaultValue = false) {
  if (value == null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

async function migrateSqliteToPostgresIfNeeded(targetConn) {
  const enabled = envFlag(process.env.MIGRATE_SQLITE_TO_POSTGRES, true);
  if (!enabled) {
    return;
  }

  const targetUsers = await targetConn.get("SELECT COUNT(*) AS total FROM users");
  if (Number(targetUsers?.total || 0) > 0) {
    return;
  }

  const sqliteSourcePath = path.resolve(String(process.env.SQLITE_MIGRATE_PATH || LEGACY_DB_PATH));
  if (!fs.existsSync(sqliteSourcePath)) {
    return;
  }

  const sourceConn = await open({
    filename: sqliteSourcePath,
    driver: sqlite3.Database
  });

  try {
    const sourceUsers = await sourceConn.get("SELECT COUNT(*) AS total FROM users").catch(() => ({ total: 0 }));
    if (Number(sourceUsers?.total || 0) === 0) {
      return;
    }

    console.log(`[db] Migrating SQLite -> PostgreSQL from ${sqliteSourcePath}`);

    const orderedTables = [
      "users",
      "products",
      "faq_entries",
      "partner_goals",
      "partner_applications",
      "admin_permissions",
      "orders",
      "reviews",
      "credit_transactions",
      "activity_logs",
      "visits",
      "tickets",
      "ticket_messages",
      "notifications"
    ];

    for (const table of orderedTables) {
      const rows = await sourceConn.all(`SELECT * FROM ${table}`).catch(() => []);
      if (!rows.length) {
        continue;
      }

      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) {
          continue;
        }

        const colSql = columns.map((col) => `"${col}"`).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map((col) => row[col]);

        await targetConn.run(
          `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
      }
    }

    for (const table of orderedTables) {
      await targetConn.exec(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`
      ).catch(() => {});
    }

    console.log("[db] SQLite -> PostgreSQL migration finished.");
  } finally {
    await sourceConn.close().catch(() => {});
  }
}

async function connectDb() {
  if (db) {
    return db;
  }

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    console.log("[db] Using PostgreSQL (DATABASE_URL).");
    pgPool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    });

    db = new PostgresCompatDb(pgPool);
    await initSchemaPostgres(db);
    return db;
  }

  ensureDbFileLocation();
  console.log(`[db] Using SQLite at ${DB_PATH}`);

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
    if (!permissionCount || Number(permissionCount.total) === 0) {
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

async function ensureDemoCustomer(conn, profile, passwordHash) {
  const existing = await conn.get("SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1", [profile.email]);
  if (existing?.id) {
    await conn.run(
      "UPDATE users SET name = ?, phone = ?, role = 'USER', status_usuario = 'ATIVO', is_banned = 0, is_owner = 0 WHERE id = ?",
      [profile.name, profile.phone, existing.id]
    );
    return existing.id;
  }

  const created = await conn.run(
    `
    INSERT INTO users (name, email, phone, password_hash, role, status_usuario, credits, first_login, activation_bonus_granted, is_owner, is_banned)
    VALUES (?, ?, ?, ?, 'USER', 'ATIVO', 50, 0, 1, 0, 0)
    `,
    [profile.name, profile.email, profile.phone, passwordHash]
  );

  return created.lastID;
}

async function seedDefaultReviews(conn) {
  const reviewCount = await conn.get("SELECT COUNT(*) AS total FROM reviews");
  if (reviewCount && Number(reviewCount.total) > 0) {
    return;
  }

  const productRows = await conn.all("SELECT id FROM products WHERE is_active = 1 ORDER BY id ASC LIMIT 12");
  if (!productRows.length) {
    return;
  }

  const customerPasswordHash = await bcrypt.hash("Cliente@123", 10);
  const userIds = [];
  for (const profile of REVIEW_SEED_USERS) {
    const userId = await ensureDemoCustomer(conn, profile, customerPasswordHash);
    userIds.push(userId);
  }

  const stmt = await conn.prepare(
    `
    INSERT INTO reviews (user_id, product_id, rating, comment, photo_url)
    VALUES (?, ?, ?, ?, ?)
    `
  );

  for (let index = 0; index < REVIEW_SEED_COMMENTS.length; index += 1) {
    const review = REVIEW_SEED_COMMENTS[index];
    const userId = userIds[index % userIds.length];
    const productId = productRows[index % productRows.length].id;
    await stmt.run(userId, productId, review.rating, review.comment, review.photo);
  }

  await stmt.finalize();
}

async function initSchemaPostgres(conn) {
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
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
      verify_code_expires_at TIMESTAMPTZ,
      is_banned INTEGER NOT NULL DEFAULT 0,
      partner_active INTEGER NOT NULL DEFAULT 0,
      is_owner INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'CELULAR',
      description TEXT NOT NULL,
      technical_specs TEXT,
      price_cash NUMERIC(12,2) NOT NULL,
      price_credits INTEGER NOT NULL,
      beginner_price NUMERIC(12,2),
      discount_percent INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      video_url TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      is_beginner_offer INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      promoted INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS reviews (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      credit_reward INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS visits (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      order_number TEXT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      ai_attempted INTEGER NOT NULL DEFAULT 1,
      ai_resolution TEXT,
      admin_response TEXT,
      responded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('USER','ADMIN')),
      sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS partner_applications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      doc_value TEXT NOT NULL,
      region TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS partner_goals (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_sales INTEGER NOT NULL DEFAULT 10,
      current_sales INTEGER NOT NULL DEFAULT 0,
      month_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, month_ref)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS faq_entries (
      id BIGSERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT NOT NULL
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS admin_permissions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, permission)
    )
    `,
    "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
    "CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)",
    "CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_admin_permissions_user ON admin_permissions(user_id)"
  ];

  for (const statement of statements) {
    await conn.exec(statement);
  }

  await migrateSqliteToPostgresIfNeeded(conn);
  await ensureCoreData(conn);
}

async function ensureCoreData(conn) {
  const faqCount = await conn.get("SELECT COUNT(*) AS total FROM faq_entries");
  if (!faqCount || Number(faqCount.total) === 0) {
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
  if (!productCount || Number(productCount.total) === 0) {
    await seedDefaultProducts(conn);
  }

  await seedDefaultReviews(conn);
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
  await ensureCoreData(conn);
}

async function getDb() {
  return connectDb();
}

module.exports = {
  getDb
};
