// ================================================================
// app.js - Logica del panel (vanilla JS, sin frameworks)
// ================================================================

let token = localStorage.getItem("jf_token") || null;
let me = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error de red");
  return data;
}

// ---------------------------------------------------------------
// Login
// ---------------------------------------------------------------

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#loginUser").value.trim();
  const password = $("#loginPass").value;
  $("#loginError").textContent = "";
  try {
    const data = await api("/login", { method: "POST", body: { username, password } });
    token = data.token;
    me = data.user;
    localStorage.setItem("jf_token", token);
    enterApp();
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  token = null;
  me = null;
  localStorage.removeItem("jf_token");
  $("#app").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
});

async function enterApp() {
  $("#loginScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");

  if (me.role !== "superadmin") {
    $("#navSettings").classList.add("hidden");
  }

  $("#whoami").innerHTML = `<b>${me.username}</b><br>${me.role}`;
  await loadDashboard();
}

// ---------------------------------------------------------------
// Navegacion entre vistas
// ---------------------------------------------------------------

$$(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $$(".view").forEach((v) => v.classList.add("hidden"));
    $("#view-" + btn.dataset.view).classList.remove("hidden");

    if (btn.dataset.view === "dashboard") loadDashboard();
    if (btn.dataset.view === "accounts") loadAccounts();
    if (btn.dataset.view === "panelUsers") loadPanelUsers();
    if (btn.dataset.view === "settings") loadSettings();
  });
});

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------

async function loadDashboard() {
  const d = await api("/dashboard");
  $("#statActive").textContent = d.activeCount;
  $("#statDemo").textContent = d.demoCount;
  $("#statSuspended").textContent = d.suspendedCount;
  $("#statCredits").textContent = d.myCredits;

  const tbody = $("#expiringTable tbody");
  tbody.innerHTML = "";
  if (d.expiringSoon.length === 0) {
    $("#expiringEmpty").classList.remove("hidden");
  } else {
    $("#expiringEmpty").classList.add("hidden");
    for (const acc of d.expiringSoon) {
      tbody.innerHTML += `<tr>
        <td>${acc.client_name || "-"}</td>
        <td>${acc.username}</td>
        <td>${acc.service}</td>
        <td>${new Date(acc.expires_at).toLocaleString()}</td>
      </tr>`;
    }
  }
}

// ---------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------

async function loadAccounts() {
  const rows = await api("/accounts");
  const tbody = $("#accountsTable tbody");
  tbody.innerHTML = "";
  for (const acc of rows) {
    const statusBadge = acc.status === "active"
      ? `<span class="badge badge-active">Activa</span>`
      : `<span class="badge badge-suspended">Suspendida</span>`;
    const typeBadge = acc.is_demo
      ? `<span class="badge badge-demo">Demo</span>`
      : `Plan`;

    tbody.innerHTML += `<tr>
      <td>${acc.client_name || "-"}</td>
      <td>${acc.username}</td>
      <td>${acc.service}</td>
      <td>${typeBadge}</td>
      <td>${statusBadge}</td>
      <td>${new Date(acc.expires_at).toLocaleString()}</td>
      <td><button class="btn btn-danger" data-del-account="${acc.id}">Eliminar</button></td>
    </tr>`;
  }

  tbody.querySelectorAll("[data-del-account]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta cuenta? Esta accion no se puede deshacer.")) return;
      try {
        await api("/accounts/" + btn.dataset.delAccount, { method: "DELETE" });
        loadAccounts();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

$("#btnNewAccount").addEventListener("click", () => {
  $("#newAccountError").textContent = "";
  $("#modalNewAccount").classList.remove("hidden");
});
$("#btnCancelNewAccount").addEventListener("click", () => {
  $("#modalNewAccount").classList.add("hidden");
});

$("#accType").addEventListener("change", () => {
  const isDemo = $("#accType").value === "demo";
  $("#accPlanWrap").classList.toggle("hidden", isDemo);
  $("#accDemoWrap").classList.toggle("hidden", !isDemo);
});

$("#accService").addEventListener("change", () => {
  const isPlex = $("#accService").value === "plex";
  $("#accUserLabel").textContent = isPlex ? "Correo del cliente (invitación Plex)" : "Usuario";
  $("#accPassWrap").classList.toggle("hidden", isPlex);
});

$("#formNewAccount").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#newAccountError").textContent = "";
  const body = {
    service: $("#accService").value,
    is_demo: $("#accType").value === "demo",
    plan: $("#accPlan").value,
    demo_length: $("#accDemoLength").value,
    username: $("#accUsername").value.trim(),
    password: $("#accPassword").value,
    client_name: $("#accClientName").value.trim(),
  };
  try {
    await api("/accounts", { method: "POST", body });
    $("#modalNewAccount").classList.add("hidden");
    $("#formNewAccount").reset();
    loadAccounts();
    loadDashboard();
  } catch (err) {
    $("#newAccountError").textContent = err.message;
  }
});

// ---------------------------------------------------------------
// Sellers / Resellers
// ---------------------------------------------------------------

async function loadPanelUsers() {
  const rows = await api("/panel-users");
  const tbody = $("#panelUsersTable tbody");
  tbody.innerHTML = "";
  for (const u of rows) {
    tbody.innerHTML += `<tr>
      <td>${u.username}</td>
      <td>${u.role}</td>
      <td>${u.is_infinite ? "∞" : u.credits}</td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td><button class="btn btn-secondary" data-credits="${u.id}" data-name="${u.username}">Dar créditos</button></td>
    </tr>`;
  }
  tbody.querySelectorAll("[data-credits]").forEach((btn) => {
    btn.addEventListener("click", () => openCreditsModal(btn.dataset.credits, btn.dataset.name));
  });
}

$("#btnNewPanelUser").addEventListener("click", () => {
  $("#newPanelUserError").textContent = "";
  // Un reseller no deberia poder abrir esto, pero por si acaso:
  if (me.role === "reseller") {
    alert("Un reseller no puede crear otros usuarios del panel.");
    return;
  }
  $("#puRole").innerHTML = me.role === "seller"
    ? `<option value="reseller">Reseller</option>`
    : `<option value="reseller">Reseller</option><option value="seller">Seller</option>`;
  $("#modalNewPanelUser").classList.remove("hidden");
});
$("#btnCancelNewPanelUser").addEventListener("click", () => {
  $("#modalNewPanelUser").classList.add("hidden");
});

$("#formNewPanelUser").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#newPanelUserError").textContent = "";
  const body = {
    username: $("#puUsername").value.trim(),
    password: $("#puPassword").value,
    role: $("#puRole").value,
    credits: parseInt($("#puCredits").value, 10) || 0,
  };
  try {
    await api("/panel-users", { method: "POST", body });
    $("#modalNewPanelUser").classList.add("hidden");
    $("#formNewPanelUser").reset();
    loadPanelUsers();
  } catch (err) {
    $("#newPanelUserError").textContent = err.message;
  }
});

let creditsTargetId = null;
function openCreditsModal(userId, username) {
  creditsTargetId = userId;
  $("#creditsTargetLabel").textContent = `Para: ${username}`;
  $("#creditsError").textContent = "";
  $("#modalCredits").classList.remove("hidden");
}
$("#btnCancelCredits").addEventListener("click", () => $("#modalCredits").classList.add("hidden"));

$("#formCredits").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#creditsError").textContent = "";
  try {
    await api("/credits/transfer", {
      method: "POST",
      body: { to_user_id: parseInt(creditsTargetId, 10), amount: parseInt($("#creditsAmount").value, 10) },
    });
    $("#modalCredits").classList.add("hidden");
    $("#formCredits").reset();
    loadPanelUsers();
    loadDashboard();
  } catch (err) {
    $("#creditsError").textContent = err.message;
  }
});

// ---------------------------------------------------------------
// Configuracion (solo superadmin)
// ---------------------------------------------------------------

async function loadSettings() {
  const s = await api("/settings/servers");
  $("#cfgJellyfinUrl").value = s.jellyfin.baseUrl || "";
  $("#cfgJellyfinKey").value = s.jellyfin.apiKey || "";
  $("#cfgEmbyUrl").value = s.emby.baseUrl || "";
  $("#cfgEmbyKey").value = s.emby.apiKey || "";
  $("#cfgPlexToken").value = s.plex.token || "";
  $("#cfgPlexServerId").value = s.plex.serverId || "";
}

$("#btnSaveSettings").addEventListener("click", async () => {
  const body = {
    jellyfin: { baseUrl: $("#cfgJellyfinUrl").value.trim(), apiKey: $("#cfgJellyfinKey").value.trim() },
    emby: { baseUrl: $("#cfgEmbyUrl").value.trim(), apiKey: $("#cfgEmbyKey").value.trim() },
    plex: { token: $("#cfgPlexToken").value.trim(), serverId: $("#cfgPlexServerId").value.trim() },
  };
  try {
    await api("/settings/servers", { method: "POST", body });
    $("#settingsSaved").textContent = "Guardado ✔";
    setTimeout(() => ($("#settingsSaved").textContent = ""), 2500);
  } catch (err) {
    $("#settingsSaved").textContent = err.message;
  }
});

$("#btnTestJellyfin").addEventListener("click", () => testConnection("jellyfin", "#jellyfinTestResult"));
$("#btnTestEmby").addEventListener("click", () => testConnection("emby", "#embyTestResult"));

async function testConnection(service, resultSel) {
  $(resultSel).textContent = "Probando...";
  try {
    const r = await api("/settings/test/" + service, { method: "POST" });
    $(resultSel).textContent = `✔ ${r.serverName} (v${r.version})`;
  } catch (err) {
    $(resultSel).textContent = "✘ " + err.message;
  }
}

// ---------------------------------------------------------------
// Arranque: si ya hay token guardado, intenta entrar directo
// ---------------------------------------------------------------

(async function init() {
  if (!token) return;
  try {
    me = await api("/me");
    enterApp();
  } catch {
    token = null;
    localStorage.removeItem("jf_token");
  }
})();
