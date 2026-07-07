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

function descendantIds(rootId) {
  const all = db.allUsers();
  const children = {};
  for (const u of all) {
    const pid = u.parent_id;
    if (pid == null) continue;
    if (!children[pid]) children[pid] = [];
    children[pid].push(u.id);
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
  return descendantIds(actingUser.id).includes(Number(targetUserId));
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.findUserById(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: "Usuario no valido" });
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

  const user = db.findUserByUsername(username);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
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

  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: "Ese usuario ya existe" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const user = db.insertUser({
    username,
    password_hash: hash,
    role,
    parent_id: req.user.id,
    credits: credits || 0,
    is_infinite: false,
  });

  res.json({ id: user.id, username: user.username, role: user.role });
});

app.get("/api/panel-users", authMiddleware, (req, res) => {
  const ids = new Set(descendantIds(req.user.id).filter((id) => id !== req.user.id));
  const rows = db.allUsers()
    .filter((u) => ids.has(u.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(({ password_hash, ...rest }) => rest);
  res.json(rows);
});

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

  if (!req.user.is_infinite) {
    db.updateUserCredits(req.user.id, -amt);
  }
  db.updateUserCredits(to_user_id, amt);
  db.insertCreditMove({ from_user_id: req.user.id, to_user_id: Number(to_user_id), amount: amt, reason: "transferencia" });

  res.json({ ok: true });
});

app.get("/api/settings/servers", authMiddleware, requireRole("superadmin"), (req, res) => {
  res.json({
    jellyfin: db.getSetting("jellyfin", { baseUrl: "", apiKey: "" }),
    emby: db.getSetting("emby", { baseUrl: "", apiKey: "" }),
    plex: db.getSetting("plex", { token: "", serverId: "" }),
  });
});

app.post("/api/settings/servers", authMiddleware, requireRole("superadmin"), (req, res) => {
  const { jellyfin, emby, plex: plexCfg } = req.body || {};
  if (jellyfin) db.setSetting("jellyfin", jellyfin);
  if (emby) db.setSetting("emby", emby);
  if (plexCfg) db.setSetting("plex", plexCfg);
  res.json({ ok: true });
});

app.post("/api/settings/test/:service", authMiddleware, requireRole("superadmin"), async (req, res) => {
  const { service } = req.params;
  try {
    if (service === "jellyfin" || service === "emby") {
      const cfg = db.getSetting(service, {});
      const info = await mediaServer.testConnection(cfg.baseUrl, cfg.apiKey);
      return res.json({ ok: true, serverName: info.ServerName, version: info.Version });
    }
    return res.status(400).json({ error: "Prueba de conexion no disponible para este servicio" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

const PLAN_DAYS = { "1m": 30, "2m": 60, "3m": 90, "6m": 180 };
const DEMO_HOURS = { "1h": 1, "2h": 2, "3h": 3, "12h": 12 };

function addDuration(base, { days, hours }) {
  const d = new Date(base);
  if (days) d.setDate(d.getDate() + days);
  if (hours) d.setHours(d.getHours() + hours);
  return d.toISOString();
}

app.post("/api/accounts", authMiddleware, async (req, res) => {
  const { service, username, password, client_name, plan, is_demo, demo_length } = req.body || {};
  if (!service || !username || !password) return res.status(400).json({ error: "Faltan datos" });
  if (!["jellyfin", "emby", "plex"].includes(service)) return res.status(400).json({ error: "Servicio invalido" });

  let expiresAt;
  let cost = 0;
  if (is_demo) {
    const hours = DEMO_HOURS[demo_length] || 1;
    expiresAt = addDuration(new Date(), { hours });
  } else {
    const days = PLAN_DAYS[plan] || 30;
    expiresAt = addDuration(new Date(), { days });
    cost = Math.max(1, Math.round(days / 30));
    if (!req.user.is_infinite && req.user.credits < cost) {
      return res.status(400).json({ error: "No tienes suficientes creditos" });
    }
  }

  try {
    let serviceUserId = null;

    if (service === "jellyfin" || service === "emby") {
      const cfg = db.getSetting(service, {});
      if (!cfg.baseUrl || !cfg.apiKey) {
        return res.status(400).json({ error: `Configura primero el servidor de ${service} en Configuracion` });
      }
      const created = await mediaServer.createUser(cfg.baseUrl, cfg.apiKey, username, password);
      serviceUserId = created.id;
    } else if (service === "plex") {
      const cfg = db.getSetting("plex", {});
      if (!cfg.token || !cfg.serverId) {
        return res.status(400).json({ error: "Configura primero Plex en Configuracion" });
      }
      await plex.inviteUser(cfg.token, cfg.serverId, username, []);
    }

    if (!is_demo && cost > 0 && !req.user.is_infinite) {
      db.updateUserCredits(req.user.id, -cost);
    }

    const acc = db.insertMediaAccount({
      owner_user_id: req.user.id,
      service,
      service_user_id: serviceUserId,
      username,
      client_name: client_name || "",
      is_demo: !!is_demo,
      status: "active",
      expires_at: expiresAt,
    });

    res.json({ id: acc.id, expires_at: expiresAt });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/accounts", authMiddleware, (req, res) => {
  const ids = new Set(descendantIds(req.user.id));
  const rows = db.allMediaAccounts()
    .filter((a) => ids.has(a.owner_user_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

app.delete("/api/accounts/:id", authMiddleware, async (req, res) => {
  const acc = db.findMediaAccountById(req.params.id);
  if (!acc) return res.status(404).json({ error: "No encontrada" });
  if (!canManage(req.user, acc.owner_user_id)) return res.status(403).json({ error: "Sin permiso" });

  try {
    if ((acc.service === "jellyfin" || acc.service === "emby") && acc.service_user_id) {
      const cfg = db.getSetting(acc.service, {});
      if (cfg.baseUrl && cfg.apiKey) {
        await mediaServer.deleteUser(cfg.baseUrl, cfg.apiKey, acc.service_user_id);
      }
    }
    db.deleteMediaAccount(acc.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

async function checkExpirations() {
  const now = new Date();
  const expired = db.allMediaAccounts().filter(
    (a) => a.status === "active" && new Date(a.expires_at) <= now
  );

  for (const acc of expired) {
    try {
      if ((acc.service === "jellyfin" || acc.service === "emby") && acc.service_user_id) {
        const cfg = db.getSetting(acc.service, {});
        if (cfg.baseUrl && cfg.apiKey) {
          await mediaServer.setUserDisabled(cfg.baseUrl, cfg.apiKey, acc.service_user_id, true);
        }
      }
      db.updateMediaAccountStatus(acc.id, "suspended");
      console.log(`[JELLYFIMANIA] Cuenta vencida y suspendida: ${acc.username} (${acc.service})`);
    } catch (e) {
      console.error(`[JELLYFIMANIA] Error suspendiendo cuenta ${acc.id}:`, e.message);
    }
  }
}
setInterval(checkExpirations, 5 * 60 * 1000);
checkExpirations();

app.get("/api/dashboard", authMiddleware, (req, res) => {
  const ids = new Set(descendantIds(req.user.id));
  const accounts = db.allMediaAccounts().filter((a) => ids.has(a.owner_user_id));

  const activeCount = accounts.filter((a) => a.status === "active" && !a.is_demo).length;
  const demoCount = accounts.filter((a) => a.is_demo && a.status === "active").length;
  const suspendedCount = accounts.filter((a) => a.status === "suspended").length;

  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const expiringSoon = accounts.filter(
    (a) => a.status === "active" && !a.is_demo && new Date(a.expires_at) <= soon
  );

  const panelUsers = db.allUsers().filter((u) => ids.has(u.id) && u.id !== req.user.id);
  const panelUsersByRole = {};
  for (const u of panelUsers) {
    panelUsersByRole[u.role] = (panelUsersByRole[u.role] || 0) + 1;
  }

  res.json({
    activeCount,
    demoCount,
    suspendedCount,
    totalAccounts: accounts.length,
    expiringSoon,
    panelUsers: Object.entries(panelUsersByRole).map(([role, n]) => ({ role, n })),
    myCredits: req.user.is_infinite ? "∞" : req.user.credits,
  });
});

app.listen(PORT, () => {
  console.log(`[JELLYFIMANIA] Panel escuchando en puerto ${PORT}`);
});
