// ============================================================
// mejorar_geocoding.js — Re-geocodifica entradas fallback=true
// Uso: node mejorar_geocoding.js [--google TU_API_KEY]
// ============================================================

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const CACHE_FILE = path.join(__dirname, 'geocoding_cache.json');
const CSV_FILE   = path.join(__dirname, 'fidelizacion_clean.csv');
const USER_AGENT = 'BilboWeb-Planning/1.0 (bilboweb@bilboweb.es)';

const BBOX_BIZKAIA = { latMin: 43.0, latMax: 43.5, lonMin: -3.4, lonMax: -2.5 };

// Detectar --google KEY en argv
let googleKey = null;
const googleIdx = process.argv.indexOf('--google');
if (googleIdx !== -1 && process.argv[googleIdx + 1]) {
  googleKey = process.argv[googleIdx + 1];
} else {
  // Leer de config.json si no se pasó por argumento
  try {
    const cfg = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, 'config.json'), 'utf-8'
    ));
    if (cfg.googleApiKey) googleKey = cfg.googleApiKey;
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────
// Utilidades
// ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function splitCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields.map(f => f.trim().replace(/^"|"$/g, ''));
}

function dentroDebizkaia(lat, lon) {
  return lat >= BBOX_BIZKAIA.latMin && lat <= BBOX_BIZKAIA.latMax
      && lon >= BBOX_BIZKAIA.lonMin && lon <= BBOX_BIZKAIA.lonMax;
}

function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function limpiarDireccion(addr) {
  return addr
    .replace(/\b(pab\.|pabellón|pabellon|nave|módulo|modulo|pol\.|polígono|poligono)\b/gi, '')
    .replace(/\s+n[uú]m\.?\s*\d+/gi, '')
    .replace(/\s+\d+[a-z]?\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ──────────────────────────────────────────────────────────────
// Geocodificadores
// ──────────────────────────────────────────────────────────────
// Fetch con timeout (evita que el script se quede bloqueado si el servidor no responde)
async function fetchTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function photon(addr, ciudad) {
  const q = encodeURIComponent(`${addr} ${ciudad}`);
  const bbox = `${BBOX_BIZKAIA.lonMin},${BBOX_BIZKAIA.latMin},${BBOX_BIZKAIA.lonMax},${BBOX_BIZKAIA.latMax}`;
  const url = `https://photon.komoot.io/api/?q=${q}&limit=3&lang=es&bbox=${bbox}`;
  try {
    const res  = await fetchTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 10000);
    const data = await res.json();
    if (!data.features || data.features.length === 0) return null;
    for (const f of data.features) {
      const [lon, lat] = f.geometry.coordinates;
      if (dentroDebizkaia(lat, lon)) return { lat, lon, ok: true, fallback: false };
    }
    return null;
  } catch { return null; }
}

async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=es`;
  try {
    const res  = await fetchTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 10000);
    const data = await res.json();
    if (!data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (!dentroDebizkaia(lat, lon)) return null;
    return { lat, lon, ok: true, fallback: false };
  } catch { return null; }
}

async function google(addr, ciudad, cp, key) {
  const query = `${addr}, ${cp} ${ciudad}, Bizkaia, España`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}&region=es&language=es&components=country:ES`;
  try {
    const res  = await fetchTimeout(url, {}, 10000);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results.length) return null;
    const { lat, lng: lon } = data.results[0].geometry.location;
    if (!dentroDebizkaia(lat, lon)) return null;
    return { lat, lon, ok: true, fallback: false };
  } catch { return null; }
}

// ──────────────────────────────────────────────────────────────
// Leer CSV y construir mapa nombre|dir|cp → datos
// ──────────────────────────────────────────────────────────────
function leerCSV() {
  const contenido = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = contenido.split('\n').filter(l => l.trim());
  const headers = splitCSVLine(lines[0]);
  const mapa = {};
  for (let i = 1; i < lines.length; i++) {
    const f = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = f[idx] || ''; });
    const cp = String(row['Código postal'] || '').replace('.0', '');
    const clave = `${row['Nombre']}|${row['Dirección']}|${cp}.0`;
    mapa[clave] = { ...row, cpLimpio: cp };
  }
  return mapa;
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
async function main() {
  if (!googleKey) {
    console.log('ℹ️  Sin clave Google Maps. Usando Photon + Nominatim.');
    console.log('   Para mejor precisión: node mejorar_geocoding.js --google TU_API_KEY');
    console.log('   Obtén una clave en: https://console.cloud.google.com → APIs → Geocoding API\n');
  }

  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  const csvMapa = leerCSV();

  const fallbacks = Object.entries(cache).filter(([, v]) => v.fallback === true);
  const total = fallbacks.length;
  console.log(`📋 Entradas en caché: ${Object.keys(cache).length}`);
  console.log(`🔴 Con fallback=true: ${total}\n`);

  let mejoraPhoton = 0, mejoraNominatim = 0, mejoraGoogle = 0, sinMejora = 0;
  let procesadas = 0;

  for (const [clave, entrada] of fallbacks) {
    procesadas++;
    const partes = clave.split('|');
    const nombre = partes[0] || '';
    const dir    = partes[1] || '';
    const cpRaw  = partes[2] || '';

    const csvRow = csvMapa[clave];
    const ciudad = csvRow ? csvRow['Población'] : '';
    const cp     = cpRaw.replace('.0', '');

    process.stdout.write(`[${procesadas}/${total}] ${nombre.substring(0, 40).padEnd(40)} → `);

    let resultado = null;
    let metodo = null;

    await sleep(1200);
    resultado = await photon(dir, ciudad);
    if (resultado) { metodo = 'Photon'; }

    if (!resultado) {
      await sleep(1200);
      const dirLimpia = limpiarDireccion(dir);
      resultado = await nominatim(`${dirLimpia}, ${ciudad}, Bizkaia, España`);
      if (resultado) { metodo = 'Nominatim (dir. limpia)'; }
    }

    if (!resultado) {
      await sleep(1200);
      resultado = await nominatim(`${cp} ${ciudad}, Bizkaia, España`);
      if (resultado) { metodo = 'Nominatim (CP+municipio)'; }
    }

    if (!resultado && googleKey) {
      await sleep(200);
      resultado = await google(dir, ciudad, cp, googleKey);
      if (resultado) { metodo = 'Google Maps'; }
    }

    if (resultado) {
      const latActual = entrada.lat;
      const lonActual = entrada.lon;
      const distancia = (latActual && lonActual)
        ? distanciaMetros(latActual, lonActual, resultado.lat, resultado.lon)
        : Infinity;

      if (entrada.fallback === true || distancia > 500) {
        const idExistente = entrada.id;
        cache[clave] = { ...resultado };
        if (idExistente) cache[clave].id = idExistente;

        if (metodo === 'Photon') mejoraPhoton++;
        else if (metodo && metodo.startsWith('Nominatim')) mejoraNominatim++;
        else if (metodo === 'Google Maps') mejoraGoogle++;

        console.log(`encontrado con ${metodo} (${distancia === Infinity ? 'nuevo' : Math.round(distancia) + 'm'})`);
      } else {
        sinMejora++;
        console.log('sin mejora significativa');
      }
    } else {
      sinMejora++;
      console.log('sin resultado');
    }

    if (procesadas % 10 === 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
      console.log(`   💾 Guardado progreso (${procesadas}/${total})`);
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');

  console.log('\n══════════════════════════════════════════');
  console.log('RESUMEN');
  console.log('══════════════════════════════════════════');
  console.log(`  Mejoradas con Photon:     ${mejoraPhoton}`);
  console.log(`  Mejoradas con Nominatim:  ${mejoraNominatim}`);
  console.log(`  Mejoradas con Google Maps:${mejoraGoogle}`);
  console.log(`  Sin mejora / sin resultado:${sinMejora}`);
  console.log(`  Total procesadas:          ${total}`);
  console.log('══════════════════════════════════════════');
  console.log('\n✅ geocoding_cache.json actualizado.');
  console.log('   Ahora ejecuta node planning.js para regenerar el planning con las nuevas coordenadas.\n');
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});

// ──────────────────────────────────────────────────────────────
// USO:
//   node mejorar_geocoding.js
//       — Re-geocodifica con Photon + Nominatim (gratuito, sin API key)
//
//   node mejorar_geocoding.js --google TU_API_KEY
//       — Añade Google Maps como tercera estrategia (más preciso en polígonos)
//       — Clave en: https://console.cloud.google.com → APIs → Geocoding API
//       — Asegúrate de que la API de Geocoding está habilitada en tu proyecto
//
// El script es reanudable: las entradas ya mejoradas (fallback=false) se saltan.
// Guarda progreso cada 10 empresas por si se interrumpe.
// ──────────────────────────────────────────────────────────────
