# Panel JELLYFIMANIA

Panel administrativo con jerarquía Super Admin → Sellers → Resellers →
Clientes, créditos, cuentas de Jellyfin/Emby/Plex con vencimiento
automático, y demos por tiempo limitado.

## Qué incluye

- Login con roles (superadmin / seller / reseller)
- Créditos: el Super Admin tiene créditos infinitos y se los reparte a
  sellers, que a su vez se los reparten a resellers
- Crear cuentas reales (1/2/3/6 meses) o demos (1/2/3/12 horas) en
  Jellyfin, Emby o Plex
- Suspensión automática cuando una cuenta vence (revisa cada 5 min)
- Dashboard con estadísticas y "vencen pronto"
- Diseño con tu marca JELLYFIMANIA (morado/naranja)

## Correr localmente (para probar antes de subirlo)

```bash
npm install
cp .env.example .env
# edita .env con tu usuario/clave de admin
npm start
```

Abre `http://localhost:4200` en el navegador.

El Super Admin se crea SOLO la primera vez que arranca, usando
`ADMIN_USER`/`ADMIN_PASS` de tu `.env`.

## Subir a GitHub

1. Crea un repositorio nuevo en github.com (puede ser público)
2. Sube todos estos archivos (arrastra la carpeta completa, EXCEPTO
   `node_modules` y `data` — el `.gitignore` ya se encarga de eso si
   usas git normal; si subes por la web de GitHub, simplemente no
   arrastres esas dos carpetas)

## Desplegar en Render.com (gratis, sin tarjeta)

1. Entra a render.com → "Get Started" → conecta tu cuenta de GitHub
2. Dashboard → "New +" → "Web Service"
3. Elige el repositorio que acabas de subir
4. Configura:

   | Campo | Valor |
   |---|---|
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free |

5. Antes de darle "Create", ve a la sección "Environment" y agrega:

   | Key | Value |
   |---|---|
   | `ADMIN_USER` | el usuario que quieras para el Super Admin |
   | `ADMIN_PASS` | una contraseña fuerte |
   | `JWT_SECRET` | cualquier texto largo y random |

6. Dale "Create Web Service" y espera 2-3 minutos

Render te da una URL tipo `https://tu-panel.onrender.com` — ese es tu
panel, ya en línea.

**Importante sobre el plan gratis de Render:** si nadie usa el panel
por 15 minutos, "se duerme" y la siguiente visita tarda ~20-30
segundos en despertar. Esto NO afecta la suspensión automática de
cuentas vencidas mientras el panel esté despierto revisando; si se
duerme por horas, esa revisión se pausa y se retoma en cuanto alguien
vuelve a entrar (o la siguiente vez que Render lo despierte).

## Configurar tus servidores

Una vez dentro del panel (con el Super Admin):

1. Ve a "Configuración"
2. Llena la URL y API Key de tu Jellyfin (Panel de Jellyfin → Avanzado
   → API Keys → crear una nueva)
3. Dale "Probar conexión" para confirmar que sí conecta
4. Repite para Emby si lo usas
5. Para Plex necesitas tu token (`X-Plex-Token`) y el
   "machineIdentifier" de tu servidor — ambos los puedes sacar
   inspeccionando las peticiones de la app web de Plex, o buscando
   "cómo obtener mi Plex token" (esto lo hace tu cuenta de Plex, no el
   panel)

## Limitaciones a tener en cuenta

- **Plex no crea cuentas usuario/contraseña** como Jellyfin/Emby —
  solo puede invitar por correo a tu servidor compartido. El campo
  "usuario" para Plex en el panel en realidad es el correo a invitar.
- El endpoint que usa Plex para compartir servidor no es 100% estable
  a través de los años (Plex lo ha cambiado varias veces) — pruébalo
  con una cuenta de prueba antes de usarlo con clientes reales. Si
  falla, la alternativa es invitar manualmente desde Plex Web.
- La base de datos (SQLite) vive en el disco del servicio de Render.
  En el plan gratis, el disco NO es persistente entre deploys — si
  vuelves a desplegar (subes cambios de código), la base de datos se
  reinicia. Para producción real con clientes de pago, conviene un
  plan de pago de Render con disco persistente, o mover la base de
  datos a un servicio externo (ej. Render Postgres, gratis por 90
  días, o hostear el panel en tu propia VPS con disco fijo).
