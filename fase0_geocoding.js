// ============================================================
// fase0_geocoding.js — Re-geocodifica TODAS las empresas con
// Google Geocoding API para obtener coordenadas a nivel de
// portal (ROOFTOP) en vez de centroide de código postal.
//
// Uso: node fase0_geocoding.js
//
// Coste estimado: ~1,38€ para 276 empresas (una sola vez)
// La API key se lee de config.json (campo googleApiKey)
//
// El script es reanudable: las entradas con geoQuality='ROOFTOP'
// ya están perfectas y se saltan. El resto se re-geocodifica.
// Guarda progreso cada 10 empresas por si se interrumpe.
// ============================================================

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const CACHE_FILE = path.join(__dirname, 'geocoding_cache.json');
const CSV_FILE   = path.join(__dirname, 'fidelizacion_clean.csv');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Leer API key de config.json
let googleKey = null;
try {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  if (cfg.googleApiKey) googleKey = cfg.googleApiKey;
} catch (_) {}

if (!googleKey) {
  console.error('❌ No se encontró googleApiKey en config.json');
  console.error('   Edita config.json y añade tu clave de Google Maps API.');
  process.exit(1);
}

// Bounding box de Bizkaia para validar resultados
const BBOX = { latMin: 43.0, latMax: 43.5, lonMin: -3.4, lonMax: -2.5 };

// Jerarquía de calidad: mejor a peor
const QUALITY_RANK = {
  'ROOFTOP': 4,
  'RANGE_INTERPOLATED': 3,
  'GEOMETRIC_CENTER': 2,
  'APPROXIMATE': 1,
  'unknown': 0
};

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
  return lat >= BBOX.latMin && lat <= BBOX.latMax
      && lon >= BBOX.lonMin && lon <= BBOX.lonMax;
}

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
    mapa[clave] = {
      nombre: row['Nombre'],
      direccion: row['Dirección'],
      poblacion: row['Población'],
      cp
    };
  }
  return mapa;
}

async function geocodificarGoogle(direccion, poblacion, cp, key) {
  // Intentamos con dirección completa primero
  const query = `${direccion}, ${cp} ${poblacion}, Bizkaia, España`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}&region=es&language=es&components=country:ES|administrative_area:Bizkaia`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();

    if (data.status !== 'OK' || !data.results.length) {
      return { ok: false, status: data.status };
    }

    const result = data.results[0];
    const { lat, lng: lon } = result.geometry.location;
    const locationType = result.geometry.location_type || 'unknown';

    if (!dentroDebizkaia(lat, lon)) {
      return { ok: false, status: 'FUERA_DE_BIZKAIA' };
    }

    return { ok: true, lat, lon, geoQuality: locationType };
  } catch (e) {
    return { ok: false, status: 'ERROR_RED', error: e.message };
  }
}

async function geocodificarGoogleSoloCp(poblacion, cp, key) {
  // Fallback: solo municipio + CP si la dirección no funciona
  const query = `${cp} ${poblacion}, Bizkaia, España`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}&region=es&language=es`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();

    if (data.status !== 'OK' || !data.results.length) {
      return { ok: false, status: data.status };
    }

    const result = data.results[0];
    const { lat, lng: lon } = result.geometry.location;
    const locationType = result.geometry.location_type || 'unknown';

    if (!dentroDebizkaia(lat, lon)) {
      return { ok: false, status: 'FUERA_DE_BIZKAIA' };
    }

    return { ok: true, lat, lon, geoQuality: locationType };
  } catch (e) {
    return { ok: false, status: 'ERROR_RED', error: e.message };
  }
}

function guardarCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  FASE 0 — Geocodificación profesional con Google     ║');
  console.log('║  Objetivo: coordenadas nivel calle para 276 empresas ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const cache   = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  const csvMapa = leerCSV();

  const entradas = Object.entries(cache);
  const total    = entradas.length;

  // Estadísticas iniciales
  const yaRooftop  = entradas.filter(([, v]) => v.geoQuality === 'ROOFTOP').length;
  const sinQuality = entradas.filter(([, v]) => !v.geoQuality).length;

  console.log(`📋 Total empresas:          ${total}`);
  console.log(`✅ Ya con ROOFTOP (saltar): ${yaRooftop}`);
  console.log(`🔄 A re-geocodificar:       ${total - yaRooftop}`);
  console.log('');
  console.log('💡 Calidades de geocodificación:');
  console.log('   ROOFTOP           = coordenada exacta del portal ⭐⭐⭐⭐');
  console.log('   RANGE_INTERPOLATED = interpolado sobre la calle  ⭐⭐⭐');
  console.log('   GEOMETRIC_CENTER  = centroide de la zona          ⭐⭐');
  console.log('   APPROXIMATE       = aproximado (cp/municipio)     ⭐');
  console.log('');

  // Contadores
  let saltadas = 0, mejoradas = 0, sinMejora = 0, errores = 0;
  const resumen = { ROOFTOP: 0, RANGE_INTERPOLATED: 0, GEOMETRIC_CENTER: 0, APPROXIMATE: 0, SIN_RESULTADO: 0 };
  let procesadas = 0;

  for (const [clave, entrada] of entradas) {
    // Saltar si ya tenemos ROOFTOP (máxima calidad)
    if (entrada.geoQuality === 'ROOFTOP') {
      saltadas++;
      resumen.ROOFTOP++;
      continue;
    }

    procesadas++;
    const partes  = clave.split('|');
    const nombre  = partes[0] || '';
    const cpRaw   = partes[2] || '';
    const csvRow  = csvMapa[clave];
    const dir     = csvRow ? csvRow.direccion : (partes[1] || '');
    const pob     = csvRow ? csvRow.poblacion : '';
    const cp      = cpRaw.replace('.0', '');

    const progreso = `[${procesadas}/${total - yaRooftop}]`;
    process.stdout.write(`${progreso} ${nombre.substring(0, 38).padEnd(38)} → `);

    // Esperar un poco entre peticiones (Google permite ~50/s pero siendo amables)
    await sleep(250);

    let resultado = await geocodificarGoogle(dir, pob, cp, googleKey);

    // Si la dirección no funciona bien, intentar solo con CP + municipio
    if (!resultado.ok && csvRow) {
      await sleep(250);
      resultado = await geocodificarGoogleSoloCp(pob, cp, googleKey);
    }

    if (!resultado.ok) {
      console.log(`❌ Sin resultado (${resultado.status})`);
      errores++;
      resumen.SIN_RESULTADO++;
      // Mantener la entrada anterior pero marcar geoQuality como 'unknown'
      if (!entrada.geoQuality) {
        cache[clave].geoQuality = 'unknown';
      }
      continue;
    }

    // Comparar calidad: ¿es mejor que la actual?
    const calidadNueva   = QUALITY_RANK[resultado.geoQuality]  || 0;
    const calidadActual  = QUALITY_RANK[entrada.geoQuality]    || 0;

    if (calidadNueva >= calidadActual || !entrada.lat) {
      // Actualizar con la nueva geocodificación
      const idExistente = entrada.id;
      cache[clave] = {
        lat: resultado.lat,
        lon: resultado.lon,
        ok: true,
        fallback: false,
        geoQuality: resultado.geoQuality
      };
      if (idExistente) cache[clave].id = idExistente;

      mejoradas++;
      resumen[resultado.geoQuality] = (resumen[resultado.geoQuality] || 0) + 1;
      console.log(`${resultado.geoQuality} ${'⭐'.repeat(calidadNueva)}`);
    } else {
      // Google dio peor resultado — mantener el anterior
      cache[clave].geoQuality = entrada.geoQuality || resultado.geoQuality;
      sinMejora++;
      resumen[resultado.geoQuality] = (resumen[resultado.geoQuality] || 0) + 1;
      console.log(`sin mejora (ya teníamos ${entrada.geoQuality || 'desconocida'})`);
    }

    // Guardar progreso cada 10 empresas
    if (procesadas % 10 === 0) {
      guardarCache(cache);
      console.log(`   💾 Progreso guardado (${procesadas + saltadas}/${total} procesadas)`);
    }
  }

  // Guardado final
  guardarCache(cache);

  // Resumen final
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  RESUMEN FASE 0                                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Ya eran ROOFTOP (saltadas): ${saltadas}`);
  console.log(`  Re-geocodificadas:           ${procesadas}`);
  console.log(`    → ROOFTOP:                 ${resumen.ROOFTOP - saltadas < 0 ? 0 : resumen.ROOFTOP}`);
  console.log(`    → RANGE_INTERPOLATED:      ${resumen.RANGE_INTERPOLATED || 0}`);
  console.log(`    → GEOMETRIC_CENTER:        ${resumen.GEOMETRIC_CENTER  || 0}`);
  console.log(`    → APPROXIMATE:             ${resumen.APPROXIMATE       || 0}`);
  console.log(`    → Sin resultado:           ${resumen.SIN_RESULTADO     || 0}`);
  console.log('');

  // Distribución final en el caché
  const cacheActualizado = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  const dist = {};
  for (const v of Object.values(cacheActualizado)) {
    const q = v.geoQuality || 'unknown';
    dist[q] = (dist[q] || 0) + 1;
  }
  console.log('  📊 Estado final del caché:');
  for (const [q, n] of Object.entries(dist).sort((a, b) => (QUALITY_RANK[b[0]] || 0) - (QUALITY_RANK[a[0]] || 0))) {
    const estrellas = '⭐'.repeat(QUALITY_RANK[q] || 0);
    console.log(`     ${q.padEnd(22)} ${String(n).padStart(3)} empresas  ${estrellas}`);
  }

  console.log('');
  if (resumen.SIN_RESULTADO > 0) {
    console.log(`⚠️  ${resumen.SIN_RESULTADO} empresas sin geocodificar. Revisa sus direcciones en el CSV.`);
  }
  console.log('✅ geocoding_cache.json actualizado con calidades.');
  console.log('');
  console.log('▶️  Próximo paso: node planning.js para regenerar el planning');
  console.log('   (Después de implementar las Fases 1-3 del nuevo algoritmo)');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
