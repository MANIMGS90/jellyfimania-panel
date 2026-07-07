// ================================================================
// db.js - Almacen de datos en JSON puro (sin SQLite / sin nada que
// compilar). Por que el cambio: better-sqlite3 necesita compilar
// codigo C++ (node-gyp) durante el "npm install", y eso fallo en el
// entorno de build de Render ("Exited with status 1 while building
// your code" / "gyp ERR!"). Con JSON no hay NADA que compilar --
// garantiza que instale igual en Render, en tu compu, o en
// cualquier otro lado.
// ================================================================

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "panel.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyDb() {
  return {
    nextId: 1,
    users: [],
    media_accounts: [],
    credit_moves: [],
    settings: {},
  };
}

let state;
try {
  state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  state = emptyDb();
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function nextId() {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

function findUserByUsername(username) {
  return state.users.find((u) => u.username === username) || null;
}

function findUserById(id) {
  return state.users.find((u) => u.id === Number(id)) || null;
}

function insertUser({ username, password_hash, role, parent_id, credits, is_infinite }) {
  const user = {
    id: nextId(),
    username,
    password_hash,
    role,
    parent_id: parent_id ?? null,
    credits: credits || 0,
    is_infinite: is_infinite ? 1 : 0,
    active: 1,
    created_at: nowIso(),
  };
  state.users.push(user);
  save();
  return user;
}

function updateUserCredits(id, delta) {
  const user = findUserById(id);
  if (!user) return;
  user.credits += delta;
  save();
}

function allUsers() {
  return state.users;
}

function insertMediaAccount(data) {
  const acc = {
    id: nextId(),
    created_at: nowIso(),
    status: "active",
    ...data,
  };
  state.media_accounts.push(acc);
  save();
  return acc;
}

function findMediaAccountById(id) {
  return state.media_accounts.find((a) => a.id === Number(id)) || null;
}

function allMediaAccounts() {
  return state.media_accounts;
}

function updateMediaAccountStatus(id, status) {
  const acc = findMediaAccountById(id);
  if (!acc) return;
  acc.status = status;
  save();
}

function deleteMediaAccount(id) {
  state.media_accounts = state.media_accounts.filter((a) => a.id !== Number(id));
  save();
}

function insertCreditMove({ from_user_id, to_user_id, amount, reason }) {
  state.credit_moves.push({
    id: nextId(),
    from_user_id,
    to_user_id,
    amount,
    reason,
    created_at: nowIso(),
  });
  save();
}

function getSetting(key, fallback) {
  return state.settings[key] || fallback;
}

function setSetting(key, value) {
  state.settings[key] = value;
  save();
}

function ensureSuperAdmin() {
  const existing = state.users.find((u) => u.role === "superadmin");
  if (existing) return;

  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASS || "cambia-esta-clave";
  const hash = bcrypt.hashSync(password, 10);

  insertUser({
    username,
    password_hash: hash,
    role: "superadmin",
    parent_id: null,
    credits: 0,
    is_infinite: true,
  });

  console.log(`[JELLYFIMANIA] Super Admin creado: usuario="${username}" (define ADMIN_USER/ADMIN_PASS en tus variables de entorno para cambiarlo)`);
}
ensureSuperAdmin();

module.exports = {
  findUserByUsername,
  findUserById,
  insertUser,
  updateUserCredits,
  allUsers,
  insertMediaAccount,
  findMediaAccountById,
  allMediaAccounts,
  updateMediaAccountStatus,
  deleteMediaAccount,
  insertCreditMove,
  getSetting,
  setSetting,
};
