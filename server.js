// ================================================================
// server.js - Panel JELLYFIMANIA
// Backend Node.js + Express + SQLite (better-sqlite3)
// ================================================================

require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("./db");
const mediaServer = require("./mediaServer");
const plex = require("./plex");

const app = express();
const PORT = process.env.PORT || 4200;
const JWT_SECRET = process.env.JWT_SECRET || "cambia-este-secreto-en-produccion";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------
// Utilidades de jerarquia
// ---------------------------------------------------------------
// superadmin -> puede crear/ver sellers, resellers, y clientes de
//               cualquiera (ve todo el arbol)
// seller     -> puede crear/ver resellers y clientes suyos y de sus
//               resellers (su sub-arbol)
// reseller   -> solo puede crear/ver clientes suyos (no crea otros
//               sellers/resellers)

function descendantIds(rootId) {
  // Devuelve [rootId, ...todos los hijos, nietos, etc.]
  const all = db.prepare("SELECT id, parent_id FROM users").all();
  const children = {};
  for (const u of all) {
    if (!children[u.parent_id]) children[u.parent_id] = [];
    if (u.parent_id != null) children[u.parent_id].push(u.id);
  }
  const result = [rootId];
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    for (const childId of children[cur] || []) {
      result.push(childId);
      queue.push(childId);
    }
  }
  return result;
}

function canManage(actingUser, targetUserId) {
  if (actingUser.role === "superadmin") return true;
  return descendantIds(actingUser.id).includes(targetUserId);
}

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(payload.id);
    if (!user) return res.status(401).json({ error: "Usuario no valido" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token invalido o vencido" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "No tienes permiso para esto" });
    }
    next();
  };
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Faltan datos" });

  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, credits: user.credits, is_infinite: !!user.is_infinite },
  });
});

app.get("/api/me", authMiddleware, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, username: u.username, role: u.role, credits: u.credits, is_infinite: !!u.is_infinite });
});

// ---------------------------------------------------------------
// Gestion de usuarios del panel (sellers / resellers)
// ---------------------------------------------------------------

// Quien puede crear que rol:
//  superadmin -> puede crear seller o reseller
//  seller     -> puede crear reseller (bajo si mismo)
//  reseller   -> no puede crear otros usuarios del panel
app.post("/api/panel-users", authMiddleware, (req, res) => {
  const { username, password, role, credits } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: "Faltan datos" });

  if (req.user.role === "reseller") {
    return res.status(403).json({ error: "Un reseller no puede crear otros usuarios del panel" });
  }
  if (req.user.role === "seller" && role !== "reseller") {
    return res.status(403).json({ error: "Un seller solo puede crear resellers" });
  }
  if (!["seller", "reseller"].includes(role)) {
    return res.status(400).json({ error: "Rol invalido" });
  }

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(409).json({ error: "Ese usuario ya existe" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, role, parent_id, credits, is_infinite)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(username, hash, role, req.user.id, credits || 0);

  res.json({ id: info.lastInsertRowid, username, role });
});

// Lista los usuarios del panel que el usuario actual puede ver
// (su propio sub-arbol, o todo si es superadmin).
app.get("/api/panel-users", authMiddleware, (req, res) => {
  const ids = descendantIds(req.user.id).filter((id) => id !== req.user.id);
  if (ids.length === 0) return res.json([]);

  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT id, username, role, parent_id, credits, is_infinite, active, created_at
    FROM users WHERE id IN (${placeholders})
    ORDER BY created_at DESC
  `).all(...ids);

  res.json(rows);
});

// Transferir creditos (venderlos) a un hijo directo o cualquier
// descendiente que el usuario actual pueda administrar.
app.post("/api/credits/transfer", authMiddleware, (req, res) => {
  const { to_user_id, amount } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!to_user_id || !amt || amt <= 0) return res.status(400).json({ error: "Datos invalidos" });

  if (!canManage(req.user, to_user_id)) {
    return res.status(403).json({ error: "No puedes dar creditos a ese usuario" });
  }

  if (!req.user.is_infinite && req.user.credits < amt) {
    return res.status(400).json({ error: "No tienes suficientes creditos" });
  }

  const tx = db.transaction(() => {
    if (!req.user.is_infinite) {
      db.prepare("UPDATE users SET credits = credits - ? WHERE id = ?").run(amt, req.user.id);
    }
    db.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").run(amt, to_user_id);
    db.prepare(`
      INSERT INTO credit_moves (from_user_id, to_user_id, amount, reason)
      VALUES (?, ?, ?, 'transferencia')
    `).run(req.user.id, to_user_id, amt);
  });
  tx();

  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Configuracion de servidores (Jellyfin/Emby/Plex) - solo Super Admin
// ---------------------------------------------------------------

function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

app.get("/api/settings/servers", authMiddleware, requireRole("superadmin"), (req, res) => {
  res.json({
    jellyfin: getSetting("jellyfin", { baseUrl: "", apiKey: "" }),
    emby: getSetting("emby", { baseUrl: "", apiKey: "" }),
    plex: getSetting("plex", { token: "", serverId: "" }),
  });
});

app.post("/api/settings/servers", authMiddleware, requireRole("superadmin"), (req, res) => {
  const { jellyfin, emby, plex: plexCfg } = req.body || {};
  if (jellyfin) setSetting("jellyfin", jellyfin);
  if (emby) setSetting("emby", emby);
  if (plexCfg) setSetting("plex", plexCfg);
  res.json({ ok: true });
});

app.post("/api/settings/test/:service", authMiddleware, requireRole("superadmin"), async (req, res) => {
  const { service } = req.params;
  try {
    if (service === "jellyfin" || service === "emby") {
      const cfg = getSetting(service, {});
      const info = await mediaServer.testConnection(cfg.baseUrl, cfg.apiKey);
      return res.json({ ok: true, serverName: info.ServerName, version: info.Version });
    }
    return res.status(400).json({ error: "Prueba de conexion no disponible para este servicio" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// Cuentas de clientes (media_accounts)
// ---------------------------------------------------------------

const PLAN_DAYS = { "1m": 30, "2m": 60, "3m": 90, "6m": 180 };
const DEMO_HOURS = { "1h": 1, "2h": 2, "3h": 3, "12h": 12 };

function addDuration(base, { days, hours }) {
  const d = new Date(base);
  if (days) d.setDate(d.getDate() + days);
  if (hours) d.setHours(d.getHours() + hours);
  return d.toISOString();
}

// Crear cuenta real (con plan) o demo.
app.post("/api/accounts", authMiddleware, async (req, res) => {
  const { service, username, password, client_name, plan, is_demo, demo_length } = req.body || {};
  if (!service || !username || !password) return res.status(400).json({ error: "Faltan datos" });
  if (!["jellyfin", "emby", "plex"].includes(service)) return res.status(400).json({ error: "Servicio invalido" });

  let expiresAt;
  if (is_demo) {
    const hours = DEMO_HOURS[demo_length] || 1;
    expiresAt = addDuration(new Date(), { hours });
  } else {
    const days = PLAN_DAYS[plan] || 30;
    expiresAt = addDuration(new Date(), { days });
    // Costo en creditos = 1 credito por cada 30 dias del plan (ajustable).
    const cost = Math.max(1, Math.round(days / 30));
    if (!req.user.is_infinite) {
      if (req.user.credits < cost) return res.status(400).json({ error: "No tienes suficientes creditos" });
      db.prepare("UPDATE users SET credits = credits - ? WHERE id = ?").run(cost, req.user.id);
    }
  }

  try {
    let serviceUserId = null;

    if (service === "jellyfin" || service === "emby") {
      const cfg = getSetting(service, {});
      if (!cfg.baseUrl || !cfg.apiKey) {
        return res.status(400).json({ error: `Configura primero el servidor de ${service} en Configuracion` });
      }
      const created = await mediaServer.createUser(cfg.baseUrl, cfg.apiKey, username, password);
      serviceUserId = created.id;
    } else if (service === "plex") {
      const cfg = getSetting("plex", {});
      if (!cfg.token || !cfg.serverId) {
        return res.status(400).json({ error: "Configura primero Plex en Configuracion" });
      }
      // En Plex, "username" en este formulario se usa como el correo
      // a invitar (Plex no soporta usuario/contraseña propios).
      await plex.inviteUser(cfg.token, cfg.serverId, username, []);
    }

    const info = db.prepare(`
      INSERT INTO media_accounts (owner_user_id, service, service_user_id, username, client_name, is_demo, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(req.user.id, service, serviceUserId, username, client_name || "", is_demo ? 1 : 0, expiresAt);

    res.json({ id: info.lastInsertRowid, expires_at: expiresAt });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Lista las cuentas que el usuario actual puede ver (las suyas y las
// de su sub-arbol de sellers/resellers).
app.get("/api/accounts", authMiddleware, (req, res) => {
  const ids = descendantIds(req.user.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT * FROM media_accounts WHERE owner_user_id IN (${placeholders})
    ORDER BY created_at DESC
  `).all(...ids);
  res.json(rows);
});

app.delete("/api/accounts/:id", authMiddleware, async (req, res) => {
  const acc = db.prepare("SELECT * FROM media_accounts WHERE id = ?").get(req.params.id);
  if (!acc) return res.status(404).json({ error: "No encontrada" });
  if (!canManage(req.user, acc.owner_user_id)) return res.status(403).json({ error: "Sin permiso" });

  try {
    if ((acc.service === "jellyfin" || acc.service === "emby") && acc.service_user_id) {
      const cfg = getSetting(acc.service, {});
      if (cfg.baseUrl && cfg.apiKey) {
        await mediaServer.deleteUser(cfg.baseUrl, cfg.apiKey, acc.service_user_id);
      }
    }
    db.prepare("DELETE FROM media_accounts WHERE id = ?").run(acc.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// Suspension automatica por vencimiento (revision cada 5 minutos)
// ---------------------------------------------------------------

async function checkExpirations() {
  const now = new Date().toISOString();
  const expired = db.prepare(`
    SELECT * FROM media_accounts WHERE status = 'active' AND expires_at <= ?
  `).all(now);

  for (const acc of expired) {
    try {
      if ((acc.service === "jellyfin" || acc.service === "emby") && acc.service_user_id) {
        const cfg = getSetting(acc.service, {});
        if (cfg.baseUrl && cfg.apiKey) {
          await mediaServer.setUserDisabled(cfg.baseUrl, cfg.apiKey, acc.service_user_id, true);
        }
      }
      db.prepare("UPDATE media_accounts SET status = 'suspended' WHERE id = ?").run(acc.id);
      console.log(`[JELLYFIMANIA] Cuenta vencida y suspendida: ${acc.username} (${acc.service})`);
    } catch (e) {
      console.error(`[JELLYFIMANIA] Error suspendiendo cuenta ${acc.id}:`, e.message);
    }
  }
}
setInterval(checkExpirations, 5 * 60 * 1000);
checkExpirations();

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------

app.get("/api/dashboard", authMiddleware, (req, res) => {
  const ids = descendantIds(req.user.id);
  const placeholders = ids.map(() => "?").join(",");

  const accounts = db.prepare(`SELECT * FROM media_accounts WHERE owner_user_id IN (${placeholders})`).all(...ids);
  const activeCount = accounts.filter((a) => a.status === "active" && !a.is_demo).length;
  const demoCount = accounts.filter((a) => a.is_demo && a.status === "active").length;
  const suspendedCount = accounts.filter((a) => a.status === "suspended").length;

  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const expiringSoon = accounts.filter(
    (a) => a.status === "active" && !a.is_demo && new Date(a.expires_at) <= soon
  );

  const panelUsers = db.prepare(`
    SELECT role, COUNT(*) as n FROM users WHERE id IN (${placeholders}) AND id != ? GROUP BY role
  `).all(...ids, req.user.id);

  res.json({
    activeCount,
    demoCount,
    suspendedCount,
    totalAccounts: accounts.length,
    expiringSoon,
    panelUsers,
    myCredits: req.user.is_infinite ? "∞" : req.user.credits,
  });
});

app.listen(PORT, () => {
  console.log(`[JELLYFIMANIA] Panel escuchando en puerto ${PORT}`);
});
