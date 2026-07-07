// ================================================================
// plex.js - Compartir tu servidor de Plex con un cliente.
// ================================================================
// IMPORTANTE, LEE ESTO ANTES DE USARLO:
// Plex NO tiene "crear usuario con usuario/contrasena" como
// Jellyfin/Emby. Un cliente de Plex SIEMPRE necesita su PROPIA
// cuenta real de Plex.tv (con su correo), y tu le "compartes tu
// servidor" invitandolo por correo -- el aceptar la invitacion desde
// su lado. No hay forma de crear una cuenta "de la nada" para el
// cliente como en Jellyfin/Emby.
//
// Esto usa el endpoint clasico de plex.tv para compartir servidor.
// Plex ha cambiado esta API mas de una vez a lo largo de los anios y
// no siempre esta bien documentada publicamente -- pruébalo con una
// cuenta de prueba antes de usarlo con clientes reales. Si algun dia
// deja de funcionar, la alternativa segura es invitar manualmente
// desde el propio Plex Web (Configuracion > Usuarios > Invitar), el
// panel simplemente no automatiza ese paso.
//
// Necesitas:
//   - PLEX_TOKEN: tu token de autenticacion de Plex (X-Plex-Token)
//   - PLEX_SERVER_ID: el "machineIdentifier" de tu servidor
// ================================================================

async function inviteUser(plexToken, serverId, email, librarySectionIds) {
  const url = `https://plex.tv/api/servers/${serverId}/shared_servers`;

  const body = new URLSearchParams();
  body.append("shared_server[library_section_ids][]", (librarySectionIds || []).join(","));
  body.append("shared_server[invited_email]", email);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Plex-Token": plexToken,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Plex invite fallo -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return { invited: true, email };
}

// Plex tampoco permite "deshabilitar" una cuenta compartida como
// Jellyfin -- la unica accion real es quitarle el acceso (remover el
// share). Esto sirve tanto para "suspender" como para "eliminar".
async function removeAccess(plexToken, serverId, sharedServerId) {
  const url = `https://plex.tv/api/servers/${serverId}/shared_servers/${sharedServerId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "X-Plex-Token": plexToken },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Plex remove fallo -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return { removed: true };
}

module.exports = { inviteUser, removeAccess };
