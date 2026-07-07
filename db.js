// ================================================================
// db.js - Inicializacion de la base de datos SQLite del panel
// ================================================================
// Usamos better-sqlite3 (sincrono, simple, muy usado en Render sin
// problemas de compilacion). Todo vive en un solo archivo
// data/panel.db que se crea solo la primera vez que arranca.
// ================================================================

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "panel.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('superadmin','seller','reseller')),
  parent_id INTEGER REFERENCES users(id),
  credits INTEGER NOT NULL DEFAULT 0,
  is_infinite INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  service TEXT NOT NULL CHECK(service IN ('jellyfin','plex','emby')),
  service_user_id TEXT,
  username TEXT NOT NULL,
  client_name TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Crea el Super Admin la primera vez que se corre el panel, usando
// las variables de entorno ADMIN_USER / ADMIN_PASS (ver .env.example).
// Asi nunca queda una contrasena de admin fija dentro del codigo.
function ensureSuperAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
  if (existing) return;

  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASS || "cambia-esta-clave";
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO users (username, password_hash, role, parent_id, credits, is_infinite)
    VALUES (?, ?, 'superadmin', NULL, 0, 1)
  `).run(username, hash);

  console.log(`[JELLYFIMANIA] Super Admin creado: usuario="${username}" (define ADMIN_USER/ADMIN_PASS en tus variables de entorno para cambiarlo)`);
}
ensureSuperAdmin();

module.exports = db;
