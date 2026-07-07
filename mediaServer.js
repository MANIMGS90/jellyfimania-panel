// ================================================================
// mediaServer.js - Crear/eliminar/suspender usuarios en Jellyfin y
// Emby. Ambos comparten (casi) la misma API REST porque Jellyfin
// nacio como un fork de Emby, asi que un mismo conjunto de funciones
// sirve para los dos -- solo cambia la URL base y el token.
// ================================================================
// Plex NO funciona igual: no tiene "crear usuario con
// usuario/contrasena" local, funciona invitando por correo a una
// cuenta real de Plex.tv a tu servidor compartido. Por eso Plex vive
// en su propio archivo (plex.js), con su propio flujo.
// ================================================================

async function apiCall(baseUrl, apiKey, method, pathStr, body) {
  const url = `${baseUrl.replace(/\/$/, "")}${pathStr}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Token": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${pathStr} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

// Crea un usuario nuevo. Devuelve { id, name }.
async function createUser(baseUrl, apiKey, username, password) {
  const created = await apiCall(baseUrl, apiKey, "POST", "/Users/New", {
    Name: username,
    Password: password,
  });

  // Por defecto, un usuario nuevo puede ver TODAS las bibliotecas.
  // Si mas adelante quieres limitar que solo vea ciertas carpetas,
  // aqui es donde se ajustaria via /Users/{id}/Policy
  // (EnableAllFolders: false, EnabledFolders: [...ids]).

  return { id: created.Id, name: created.Name };
}

// Habilita/deshabilita un usuario (para suspension por vencimiento,
// sin necesidad de borrar la cuenta -- asi si el cliente renueva,
// se reactiva sin tener que recrear nada).
async function setUserDisabled(baseUrl, apiKey, userId, disabled) {
  const user = await apiCall(baseUrl, apiKey, "GET", `/Users/${userId}`);
  const policy = user.Policy || {};
  policy.IsDisabled = !!disabled;
  await apiCall(baseUrl, apiKey, "POST", `/Users/${userId}/Policy`, policy);
}

// Limita cuantos dispositivos/streams puede usar el usuario al mismo
// tiempo (1, 2 o 3). Jellyfin y Emby comparten el mismo campo de
// politica para esto: Policy.MaxActiveSessions (0 = sin limite).
async function setMaxDevices(baseUrl, apiKey, userId, maxDevices) {
  const user = await apiCall(baseUrl, apiKey, "GET", `/Users/${userId}`);
  const policy = user.Policy || {};
  policy.MaxActiveSessions = Number(maxDevices) || 1;
  await apiCall(baseUrl, apiKey, "POST", `/Users/${userId}/Policy`, policy);
}

// Elimina el usuario por completo (accion definitiva).
async function deleteUser(baseUrl, apiKey, userId) {
  await apiCall(baseUrl, apiKey, "DELETE", `/Users/${userId}`);
}

// Prueba de conexion / info del servidor (para el boton "Probar
// conexion" en Configuracion).
async function testConnection(baseUrl, apiKey) {
  return apiCall(baseUrl, apiKey, "GET", "/System/Info");
}

module.exports = { createUser, setUserDisabled, setMaxDevices, deleteUser, testConnection };
