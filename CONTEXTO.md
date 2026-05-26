# Planning Fidelización — Contexto de sesión

> Archivo de contexto para continuar el desarrollo. Léelo al inicio de cada nueva sesión.

---

## ¿Qué es esto?

Aplicación web interna para gestionar la **actividad comercial de visitas a clientes**. Permite planificar rutas semanales, exportar Excel con formato profesional, registrar el resultado de cada visita y visualizar la actividad en un dashboard. Uso exclusivo del equipo interno, sin registro público.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla (sin frameworks) |
| Base de datos | Supabase (PostgreSQL) con RLS habilitado |
| Auth | Supabase Auth (email + password) |
| Despliegue | Vercel — auto-deploy desde GitHub en cada push |
| Excel | ExcelJS (browser-side) — genera .xlsx con estilos |
| Gráficos | SVG + CSS puro — sin Chart.js ni librerías externas |

**Repo GitHub:** `anabilboweb/planning-fidelizacion`  
**URL producción:** `planning-fidelizacion.vercel.app` (o similar, ver Vercel dashboard)  
**Supabase proyecto:** `mwrkidkvjyrcuexxkhbv.supabase.co`

---

## Estructura de archivos

```
Planning fidelización/
├── public/
│   ├── index.html       → / (planning semanal + exportar Excel)
│   ├── notas.html       → /notas (registro de visitas por cliente)
│   ├── config.html      → /config (configuración del sistema)
│   └── dashboard.html   → /dashboard (dashboard comercial)
├── vercel.json          → rewrites de rutas
├── config.json          → GITIGNOREADO — contiene claves sensibles
└── CONTEXTO.md          → este archivo
```

### `config.json` (gitignoreado, NUNCA al repo)
```json
{
  "supabaseUrl": "https://mwrkidkvjyrcuexxkhbv.supabase.co",
  "supabaseServiceKey": "...service_role key...",
  "supabaseAnonKey": "...anon key..."
}
```

---

## Base de datos — Tablas Supabase

| Tabla | Uso |
|---|---|
| `planning_schedule` | Guarda el planning activo — campo `schedule` (JSON) con `{ dias: [...] }` |
| `notas` | Una fila por cliente visitado — clave: `cliente_id` (NO `id`) |
| `clientes` | Catálogo de clientes |
| `app_config` | Configuración general (incluye `github_token`) |

### Estructura de `notas`
```
cliente_id        → FK a clientes (clave de join — NO usar notas.id)
estado            → 'pendiente' | 'realizada' | 'pospuesta' | 'no-interesado'
fecha_visita      → date (ISO string)
fecha_seguimiento → date (ISO string, puede ser null)
notas             → text libre
```

### Estructura de `planning_schedule.schedule`
```json
{
  "dias": [
    {
      "fecha": "2026-05-26",
      "label": "lunes",
      "clientes": [
        { "id": "123", "nombre": "...", "poblacion": "...", "cp": "...", "llegada": "09:00", "salida": "10:00" }
      ]
    }
  ]
}
```

---

## Reglas de seguridad — CRÍTICO

- **`supabaseServiceKey`** → NUNCA en HTML ni en GitHub. Solo en `config.json` (gitignoreado). En el navegador solo va la `anonKey`.
- **`github_token`** (`bilboweb-regen`, scope workflow) → guardado en `app_config` de Supabase. Aceptable para app monousuario.
- **`config.json`** → está en `.gitignore`. Si alguna vez se sube accidentalmente, revocar claves de inmediato.
- **RLS** activo en todas las tablas — no desactivar sin pensar las consecuencias.

---

## Páginas — Funcionalidad

### `/` — Planning (index.html)
- Carga el planning activo desde `planning_schedule`
- Muestra tabla de visitas por semana
- Exporta Excel con ExcelJS:
  - **Semanal**: una pestaña con la semana seleccionada
  - **Completo**: 3 secciones en orden → Actividad Comercial (primera), Resumen, semanas individuales
- Tiene login overlay con Supabase Auth
- Genera el planning llamando al GitHub Action (via `github_token` de `app_config`)

### `/notas` — Notas de visitas
- Lista de clientes del planning activo
- Por cada cliente: formulario con estado, fecha_visita, fecha_seguimiento, texto libre
- Guarda en tabla `notas` usando `cliente_id` como clave

### `/config` — Configuración
- Gestión de parámetros del sistema desde la propia app

### `/dashboard` — Dashboard comercial
- **Render-first, auth-second**: muestra mock data síncronamente, luego carga datos reales en background → la página nunca aparece en blanco
- **KPIs**: clientes en ruta, visitas esta semana, pendientes hoy, tasa de éxito
- **Agenda**: navegable con `←` / `→` + datepicker nativo para saltar a cualquier fecha
  - `agendaGoToDate(dateStr)` → busca coincidencia exacta o día más cercano
  - `renderAgenda()` sincroniza el datepicker con el día mostrado
- **Donut SVG**: distribución de estados (pendiente/pospuesta/realizada/no-interesado)
  - Si todos están en "pendiente", muestra distribución de ejemplo (~24% realizadas, 10% pospuestas, 4% no interesadas)
- **Barras semanales**: últimas 6 semanas, CSS divs apilados por estado
  - Si no hay visitas registradas, muestra barras de ejemplo
- **Seguimientos**: próximas visitas con fecha_seguimiento, ordenadas por fecha
  - Si no hay datos, muestra 3 filas de ejemplo
- **Datos de ejemplo**: banner amarillo "Vista de ejemplo" cuando se muestran datos mock; todas las secciones tienen fallback de ejemplo
- **Supabase en try-catch**: si la CDN no carga, el dashboard sigue mostrando mock sin romperse
- **Sin Chart.js**: todos los gráficos son SVG puro o divs CSS

---

## Colores y estados

```js
const ESTADO_COLORES = {
  pendiente:       '#94a3b8',  // gris
  pospuesta:       '#f59e0b',  // ámbar
  realizada:       '#10b981',  // verde
  'no-interesado': '#ef4444'   // rojo
};
```

---

## Arquitectura del dashboard — Patrón de arranque

```js
// 1. Mock síncrono (la página NUNCA aparece en blanco)
renderConMock();

// 2. Auth y datos reales en background
(async () => {
  const ok = await checkAuth();
  if (!ok) return;
  await cargarDatos(); // si hay datos reales, reemplaza el mock
})();
```

`cargarDatos()` solo reemplaza el mock si `hayDatos === true` (hay clientes en planning o notas con cliente_id). Si no, mantiene el mock visible.

---

## CDNs en uso

- Supabase JS: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- ExcelJS: carga dinámica con fallback entre jsdelivr / cdnjs / unpkg
- Chart.js: **ELIMINADO** — reemplazado por SVG + CSS

---

## Flujo de trabajo habitual

1. Ana genera el planning semanal desde `/` (dispara GitHub Action)
2. Supabase guarda el planning en `planning_schedule`
3. Los datos aparecen en `/notas` para registrar visitas
4. El dashboard `/dashboard` muestra la actividad en tiempo real

---

## Estado actual (mayo 2026)

| Funcionalidad | Estado |
|---|---|
| Login / Auth | ✅ Operativo |
| Planning semanal + Excel | ✅ Operativo |
| Excel completo (3 secciones) | ✅ Operativo |
| Registro de notas | ✅ Operativo |
| Config | ✅ Operativo |
| Dashboard con KPIs | ✅ Operativo |
| Agenda con datepicker | ✅ Operativo |
| Donut + barras SVG | ✅ Operativo |
| Datos de ejemplo (fallback) | ✅ Operativo |

---

## Posibles próximos pasos

- Notificaciones automáticas por email (seguimientos próximos) → requiere cron job + servicio de email (ej. Resend)
- PWA / acceso móvil optimizado para registrar visitas desde el teléfono en ruta
- Exportación del dashboard a PDF
- Multi-usuario: diferentes comerciales con sus propios plannings
- Integración con Google Calendar o CRM externo
