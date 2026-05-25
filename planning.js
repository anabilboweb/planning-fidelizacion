// ============================================================
// planning.js — Planning de visitas comerciales BilboWeb
// Uso: doble clic en ejecutar.bat  (o: node planning.js [KEY_ORS])
// Para cambiar fecha u opciones: edita config.json
// ============================================================

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const XLSX  = require('xlsx');
const crypto = require('crypto');

// ──────────────────────────────────────────────────────────────
// CARGAR CONFIGURACIÓN DESDE config.json
// ──────────────────────────────────────────────────────────────
const CONFIG_FILE   = path.join(__dirname, 'config.json');
const FESTIVOS_FILE = path.join(__dirname, 'festivos.json');

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('❌ No se encuentra config.json. Créalo antes de ejecutar.');
  process.exit(1);
}

const CFG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const FESTIVOS_DATA = fs.existsSync(FESTIVOS_FILE)
  ? JSON.parse(fs.readFileSync(FESTIVOS_FILE, 'utf-8'))
  : { dias: [] };

const FESTIVOS = new Set(FESTIVOS_DATA.dias);

// Fecha de inicio: 'hoy' o fecha concreta
function parseFechaInicio(valor) {
  if (!valor || valor === 'hoy') return new Date();
  const d = new Date(valor);
  if (isNaN(d.getTime())) {
    console.warn(`⚠️  Fecha "${valor}" no válida en config.json. Se usará hoy.`);
    return new Date();
  }
  return d;
}

// Parámetros operativos
const ORS_API_KEY     = process.argv[2] || process.env.ORS_API_KEY || '';
const CSV_FILE        = path.join(__dirname, 'fidelizacion_clean.csv');
const CACHE_FILE      = path.join(__dirname, 'geocoding_cache.json');
const EXCEL_OUT       = path.join(__dirname, 'planning_visitas.xlsx');
const HTML_OUT        = path.join(__dirname, 'planning_mapa.html');

let START_DATE      = parseFechaInicio(CFG.fechaInicio);
let MAX_MIN_PER_DAY = (CFG.horasMaximaDia || 5) * 60;
let MEETING_MIN     = CFG.minutosReunion      || 30;
let PARKING_MIN     = CFG.minutosAparcamiento || 10;
let CLIENT_MIN      = MEETING_MIN + PARKING_MIN;
let RADIO_ANDANDO   = (CFG.radioAndando || 600); // metros — distancia máxima para ir andando
const WALK_KMH        = 4;                          // velocidad media andando km/h
const WALK_MIN_MIN    = 1;                          // mínimo 1 min entre visitas andando (solo para coordenadas idénticas)
const WALK_MAX_DIRECT_MIN = 20;                     // máx minutos andando directo aunque esté fuera de RADIO_ANDANDO

// ── Parámetros del nuevo algoritmo (Fases 1-3) ──────────────
const CLUSTER_DIAMETER_KM = 2.5;  // diámetro máx de un cluster geográfico en km
const CLUSTER_MIX_MAX_KM  = 8;    // máx distancia entre centroides al combinar clusters en el mismo día
const HELD_KARP_MAX       = 12;   // usar TSP exacto (Held-Karp) para días con ≤ N empresas

let [WORK_H, WORK_M] = (CFG.horaInicioJornada || '09:00').split(':').map(Number);

let BASE = CFG.base || {
  nombre: 'BilboWeb', lat: 43.2956, lon: -2.9921, direccion: 'Barakaldo, Bizkaia'
};

// Filtros
let EXCLUIR_CLIENTES = new Set((CFG.filtros?.excluirClientes || []).map(s => s.toLowerCase()));
let SOLO_MUNICIPIOS  = (CFG.filtros?.soloMunicipios  || []).map(s => s.toLowerCase());
let SOLO_CPS         = new Set(CFG.filtros?.soloCodigosPostales || []);

// ──────────────────────────────────────────────────────────────
// UTILIDADES GENERALES
// ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function isWorkDay(date) {
  const dow = date.getDay();           // 0=dom, 6=sab
  if (dow === 0 || dow === 6) return false;
  return !FESTIVOS.has(toDateKey(date));
}

function nextWorkDay(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (!isWorkDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

function fmtMin(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ──────────────────────────────────────────────────────────────
// ID ESTABLE POR CLIENTE  (hash deterministico de nombre+CP)
// ──────────────────────────────────────────────────────────────
function clienteId(c) {
  const seed = `${c['Nombre']}|${(c['Código postal'] || '').replace('.0', '')}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

// Distancia Haversine en km
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
            Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Tiempo estimado conducción (min) sin API
// Modelo calibrado para Bizkaia: tráfico urbano denso en Bilbao/Gran Bilbao,
// carreteras comarcales y autopista AP-8/A-8 para distancias largas.
function driveMin(lat1, lon1, lat2, lon2) {
  const distKm = haversine(lat1, lon1, lat2, lon2);

  // Tortuosidad y velocidad media según distancia en línea recta
  let tortuosity, kph;
  if      (distKm < 1)  { tortuosity = 1.7; kph = 15; } // urbano denso: calles estrechas, semáforos, UTA
  else if (distKm < 4)  { tortuosity = 1.5; kph = 25; } // urbano: tráfico ciudad
  else if (distKm < 12) { tortuosity = 1.4; kph = 42; } // suburbano: Barakaldo↔Bilbao, Sestao↔Santurtzi
  else if (distKm < 30) { tortuosity = 1.3; kph = 65; } // carretera + acceso AP-8
  else                  { tortuosity = 1.2; kph = 80; } // autopista AP-8 / A-8

  return Math.max(1, Math.ceil((distKm * tortuosity / kph) * 60));
}

// Tiempo estimado caminando (min)
function walkMin(lat1, lon1, lat2, lon2) {
  const distM = haversine(lat1, lon1, lat2, lon2) * 1000;
  return Math.max(1, Math.ceil((distM * 1.4 / 1000 / WALK_KMH) * 60));
}

// ──────────────────────────────────────────────────────────────
// PARSEO CSV  (maneja campos entre comillas con comas internas)
// ──────────────────────────────────────────────────────────────
function parseCSV(filePath) {
  const raw     = fs.readFileSync(filePath, 'utf-8');
  const lines   = raw.split(/\r?\n/).filter(l => l.trim());
  const headers = splitCSVLine(lines[0]);

  return lines.slice(1).map(line => {
    const fields = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (fields[i] || '').trim(); });
    return obj;
  }).filter(r => {
    if (!r['Nombre'] || r['Nombre'].length === 0) return false;
    // Filtro de exclusión por nombre exacto
    if (EXCLUIR_CLIENTES.has(r['Nombre'].toLowerCase())) return false;
    // Filtro de municipios (si está configurado)
    if (SOLO_MUNICIPIOS.length > 0) {
      const pob = (r['Población'] || '').toLowerCase();
      if (!SOLO_MUNICIPIOS.some(m => pob.includes(m))) return false;
    }
    // Filtro de CPs (si está configurado)
    if (SOLO_CPS.size > 0) {
      const cp = String(r['Código postal'] || '').replace('.0', '');
      if (!SOLO_CPS.has(cp)) return false;
    }
    return true;
  });
}

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

// ──────────────────────────────────────────────────────────────
// GEOCODIFICACIÓN  (Nominatim, 1 req/s, con caché)
// ──────────────────────────────────────────────────────────────
async function nominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=es`;
  const res  = await fetch(url, { headers: { 'User-Agent': 'BilboWeb-Planning/1.0 (bilboweb@bilboweb.es)' } });
  const data = await res.json();
  return data.length > 0
    ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), ok: true }
    : null;
}

async function geocodeCliente(c) {
  const cp   = String(c['Código postal'] || '').replace('.0','');
  const addr = c['Dirección'] || '';
  const city = c['Población'] || '';

  // Intento 1 — dirección completa
  await sleep(1100);
  let r = await nominatim(`${addr}, ${cp} ${city}, Bizkaia, España`);
  if (r) return { ...r, fallback: false };

  // Intento 2 — sólo CP + municipio
  await sleep(1100);
  r = await nominatim(`${cp} ${city}, Bizkaia, España`);
  if (r) return { ...r, fallback: true };

  return { lat: null, lon: null, ok: false, fallback: false };
}

async function geocodeAll(clientes) {
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log(`   📦 Caché existente: ${Object.keys(cache).length} registros`);
  }

  let newCount = 0;
  for (let i = 0; i < clientes.length; i++) {
    const c   = clientes[i];
    const key = `${c['Nombre']}|${c['Dirección']}|${c['Código postal']}`;

    if (cache[key]) {
      Object.assign(c, cache[key]);
      if (!c.id) c.id = clienteId(c);  // compatibilidad con cache antiguo
      continue;
    }

    process.stdout.write(`\r   🌍 ${i+1}/${clientes.length}: ${c['Nombre'].substring(0,45).padEnd(45,' ')}`);
    const r = await geocodeCliente(c);
    Object.assign(c, r);
    c.id = clienteId(c);
    r.id = c.id;
    cache[key] = r;
    newCount++;

    if (newCount % 10 === 0)
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  process.stdout.write('\n');
  console.log(`   ✅ Nuevas geocodificaciones: ${newCount}`);

  const fallidos = clientes.filter(c => !c.ok);
  if (fallidos.length)
    console.log(`   ⚠️  Sin geocodificar (${fallidos.length}): se omiten del planning`);

  return clientes.filter(c => c.ok);
}

// ──────────────────────────────────────────────────────────────
// TIEMPO DE VIAJE con ORS Matrix API (batch por día)
// ──────────────────────────────────────────────────────────────

// Llama a ORS Matrix con N ubicaciones y devuelve la matriz de duraciones (seg)
async function orsMatrix(locations) {
  const body = { locations, metrics: ['duration'], resolve_locations: false };
  const res  = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method:  'POST',
    headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.durations) throw new Error(JSON.stringify(data));
  return data.durations; // matriz [origen][destino] en segundos
}

// ──────────────────────────────────────────────────────────────
// GOOGLE MAPS DISTANCE MATRIX: tiempos reales de conducción
// Sustituye las estimaciones Haversine por tiempos viales reales.
// Coste: ~(n+1)² elementos por día × $5/1000 → menos de 2€ para
// 50 días con 6 clientes/día. Dentro del crédito gratuito de Google.
// ──────────────────────────────────────────────────────────────

// 2-opt usando una matriz precalculada de tiempos reales.
// order: array de índices en la matriz (0=BASE, 1..N=clientes)
// Retorna el orden optimizado.
function twoOptMatrix(order, matrix) {
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const prev_i = i > 0 ? order[i - 1] : 0;
        const next_j = j < order.length - 1 ? order[j + 1] : 0;

        const curCost = matrix[prev_i][order[i]] + matrix[order[j]][next_j];
        const newCost = matrix[prev_i][order[j]] + matrix[order[i]][next_j];

        if (newCost < curCost - 0.5) {
          let lo = i, hi = j;
          while (lo < hi) {
            [order[lo], order[hi]] = [order[hi], order[lo]];
            lo++; hi--;
          }
          improved = true;
        }
      }
    }
  }
  return order;
}

async function refineWithGoogleMaps(routes, apiKey) {
  let refined = 0;

  for (let ri = 0; ri < routes.length; ri++) {
    const day     = routes[ri];
    const clients = day.clients;
    if (clients.length === 0) continue;

    // Puntos: [BASE, c0, c1, …, cN-1]
    const pts = [{ lat: BASE.lat, lon: BASE.lon }, ...clients];
    const N   = pts.length;

    const coordStr = p => `${p.lat},${p.lon}`;
    const allCoords = pts.map(coordStr).join('|');

    let matrix = null;
    if (N <= 14) {  // hasta 13 clientes + base = matriz 14×14 = 196 elementos (bien dentro de límites Google)
      const matrixUrl = 'https://maps.googleapis.com/maps/api/distancematrix/json'
        + `?origins=${encodeURIComponent(allCoords)}`
        + `&destinations=${encodeURIComponent(allCoords)}`
        + `&mode=driving&language=es&key=${apiKey}`;
      try {
        await sleep(150);
        const res  = await fetch(matrixUrl);
        const data = await res.json();
        if (data.status === 'OK') {
          matrix = data.rows.map(row =>
            row.elements.map(el =>
              el?.status === 'OK' ? Math.max(1, Math.ceil(el.duration.value / 60)) : 999
            )
          );
        }
      } catch (_) { matrix = null; }
    }

    if (matrix) {
      // Fase 3: Held-Karp (exacto) si N ≤ HELD_KARP_MAX, 2-opt si es mayor
      let order;
      if (clients.length <= HELD_KARP_MAX) {
        // matrix[0] = fila de base → matrix[0][i+1] = tiempo de base al cliente i
        const hkOrder = heldKarp(clients.length, matrix);
        order = hkOrder.map(i => i + 1); // convertir a índices 1-based (base=0)
      } else {
        order = clients.map((_, i) => i + 1);
        order = twoOptMatrix(order, matrix);
      }

      day.clients = order.map(idx => clients[idx - 1]);

      // Recalcular tiempos rastreando dónde está el coche (carMatrixIdx)
      // Fixes: el coche no avanza cuando se va andando → matrix[carMatrixIdx][dest] correcto
      let prevLat = BASE.lat, prevLon = BASE.lon;
      let carLat  = BASE.lat, carLon  = BASE.lon;
      let carMatrixIdx = 0; // base = índice 0 en la matriz

      day.clients.forEach((c, ci) => {
        const curMatrixIdx = order[ci]; // índice en la matriz (1-based)
        const distM = haversine(prevLat, prevLon, c.lat, c.lon) * 1000;

        // ¿Andamos directamente? (dentro de RADIO_ANDANDO o más rápido que volver al coche)
        const enElCoche  = Math.abs(prevLat - carLat) < 1e-5 && Math.abs(prevLon - carLon) < 1e-5;
        const returnMin  = enElCoche ? 0 : Math.max(WALK_MIN_MIN, walkMin(prevLat, prevLon, carLat, carLon));
        const driveTotal = returnMin + matrix[carMatrixIdx][curMatrixIdx];
        const walkDirect = walkMin(prevLat, prevLon, c.lat, c.lon);

        const goWalking = (distM >= 10 && distM < RADIO_ANDANDO)
          || (!enElCoche && walkDirect < driveTotal && walkDirect <= WALK_MAX_DIRECT_MIN);

        if (goWalking) {
          c._andando        = true;
          c._travelMin      = Math.max(WALK_MIN_MIN, walkDirect);
          c._returnToCarMin = 0;
          // El coche NO se mueve → carMatrixIdx y carLat/carLon no cambian
        } else {
          c._andando        = false;
          c._travelMin      = driveTotal; // returnToCarMin + Google drive time
          c._returnToCarMin = returnMin;
          carLat = c.lat; carLon = c.lon;
          carMatrixIdx = curMatrixIdx;   // el coche está ahora en esta parada
        }

        prevLat = c.lat; prevLon = c.lon;
      });

      // Vuelta a base: andar al coche si hace falta + conducir
      const enElCocheEnd = Math.abs(prevLat - carLat) < 1e-5 && Math.abs(prevLon - carLon) < 1e-5;
      const retWalkEnd   = enElCocheEnd ? 0 : Math.max(WALK_MIN_MIN, walkMin(prevLat, prevLon, carLat, carLon));
      day._retBase = retWalkEnd + matrix[carMatrixIdx][0];

    } else {
      // Fallback: solo tiempos secuenciales (día grande o error de API)
      const seqPts = [{ lat: BASE.lat, lon: BASE.lon }, ...day.clients, { lat: BASE.lat, lon: BASE.lon }];
      const origins      = seqPts.slice(0, -1).map(coordStr).join('|');
      const destinations = seqPts.slice(1).map(coordStr).join('|');
      const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
        + `?origins=${encodeURIComponent(origins)}`
        + `&destinations=${encodeURIComponent(destinations)}`
        + `&mode=driving&language=es&key=${apiKey}`;
      try {
        await sleep(150);
        const res  = await fetch(url);
        const data = await res.json();
        if (data.status !== 'OK') throw new Error(data.status);
        let prevLat = BASE.lat, prevLon = BASE.lon;
        day.clients.forEach((c, i) => {
          const el    = data.rows[i]?.elements[i];
          const distM = haversine(prevLat, prevLon, c.lat, c.lon) * 1000;
          if (el?.status === 'OK') {
            if (distM >= 10 && distM < RADIO_ANDANDO) {
              c._andando   = true;
              c._travelMin = Math.max(WALK_MIN_MIN, walkMin(prevLat, prevLon, c.lat, c.lon));
            } else {
              c._andando   = false;
              c._travelMin = Math.max(1, Math.ceil(el.duration.value / 60));
            }
          }
          prevLat = c.lat; prevLon = c.lon;
        });
        const retEl    = data.rows[day.clients.length]?.elements[day.clients.length];
        day._retBase   = retEl?.status === 'OK'
          ? Math.max(1, Math.ceil(retEl.duration.value / 60))
          : driveMin(day.clients[day.clients.length-1].lat, day.clients[day.clients.length-1].lon, BASE.lat, BASE.lon);
      } catch (err) {
        process.stdout.write(`\r   ⚠️  Día ${ri+1}: ${err.message.slice(0,60)}\n`);
      }
    }

    day.totalMin = day.clients.reduce(
      (s, c) => s + c._travelMin + (c._andando ? MEETING_MIN : CLIENT_MIN), 0
    ) + (day._retBase || 0);

    refined++;
    await sleep(150);
    process.stdout.write(`\r   📡 Google Maps: ${ri+1}/${routes.length} días procesados…`);
  }

  process.stdout.write('\n');
  console.log(`   ✅ Google Maps Distance Matrix: ${refined}/${routes.length} días refinados`);
}

// Tras construir las rutas con Haversine, refinamos _travelMin con ORS real
async function refineWithORS(routes) {
  console.log('   🚗 Refinando tiempos con ORS (conducción real)…');
  let refined = 0;

  for (let ri = 0; ri < routes.length; ri++) {
    const day     = routes[ri];
    const clients = day.clients;
    if (clients.length === 0) continue;

    // Construir lista de puntos: [base, c0, c1, …, cN, base]
    const pts = [
      [BASE.lon, BASE.lat],
      ...clients.map(c => [c.lon, c.lat]),
      [BASE.lon, BASE.lat]
    ];

    try {
      const mat = await orsMatrix(pts);
      // Actualizar _travelMin para cada cliente
      // pts[0]=base, pts[1]=c0, …, pts[N]=cN-1, pts[N+1]=base
      clients.forEach((c, i) => {
        const fromIdx = i;        // desde: base (0) o cliente i-1 (i)
        const toIdx   = i + 1;   // hacia: cliente i
        const secs    = mat[fromIdx][toIdx];
        if (secs != null) c._travelMin = Math.ceil(secs / 60);
      });
      // Recalcular totalMin con tiempos ORS
      const retBase = Math.ceil(mat[clients.length][clients.length + 1] / 60);
      day.totalMin  = clients.reduce((s, c) => s + c._travelMin + (c._andando ? MEETING_MIN : CLIENT_MIN), 0) + retBase;
      day._retBase  = retBase;
      refined++;
    } catch (err) {
      // Si falla este día, dejamos Haversine (sin interrumpir el resto)
      process.stdout.write(`\r   ⚠️  Día ${ri+1}: fallback Haversine (${err.message.slice(0,50)})\n`);
    }

    // ORS free: ~40 req/min → esperamos 1.6 s entre llamadas para no saturar
    await sleep(1650);
    process.stdout.write(`\r   📡 ORS: ${ri+1}/${routes.length} días procesados…`);
  }

  process.stdout.write('\n');
  console.log(`   ✅ ORS aplicado en ${refined}/${routes.length} días`);
}

// ──────────────────────────────────────────────────────────────
// GIANT TOUR: nearest-neighbor global sobre TODOS los clientes
//
// Construye una ruta que visita las N empresas en orden geográfico
// coherente partiendo desde la base. Al ser global, empresas de la
// misma calle o zona quedan siempre juntas en el tour.
// ──────────────────────────────────────────────────────────────
function buildGiantTour(clientes) {
  const remaining = [...clientes];
  const tour      = [];
  let curLat = BASE.lat, curLon = BASE.lon;

  while (remaining.length > 0) {
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(curLat, curLon, remaining[i].lat, remaining[i].lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    tour.push(next);
    curLat = next.lat;
    curLon = next.lon;
  }

  return tour;
}

// ──────────────────────────────────────────────────────────────
// 2-OPT GLOBAL sobre el giant tour completo
//
// Elimina cruces en el tour de N empresas. Con coordenadas
// aproximadas (muchas empresas en el mismo centroide postal) converge
// rápido porque los cruces inter-cluster son pocos.
// ──────────────────────────────────────────────────────────────
function twoOptGlobal(tour) {
  if (tour.length <= 2) return tour;

  const base = { lat: BASE.lat, lon: BASE.lon };
  const pts  = [base, ...tour.map(c => ({ ...c }))];

  let improved = true, rounds = 0;
  const MAX_ROUNDS = 200;

  while (improved && rounds < MAX_ROUNDS) {
    improved = false;
    rounds++;
    for (let i = 0; i < pts.length - 2; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        const pA = pts[i],     pB = pts[i + 1];
        const pC = pts[j],     pD = j + 1 < pts.length ? pts[j + 1] : base;

        const cur = haversine(pA.lat, pA.lon, pB.lat, pB.lon)
                  + haversine(pC.lat, pC.lon, pD.lat, pD.lon);
        const nw  = haversine(pA.lat, pA.lon, pC.lat, pC.lon)
                  + haversine(pB.lat, pB.lon, pD.lat, pD.lon);

        if (nw < cur - 1e-10) {
          let lo = i + 1, hi = j;
          while (lo < hi) { [pts[lo], pts[hi]] = [pts[hi], pts[lo]]; lo++; hi--; }
          improved = true;
        }
      }
    }
  }

  process.stdout.write(`(${rounds} rondas) `);
  return pts.slice(1);
}

// ──────────────────────────────────────────────────────────────
// SPLIT: corta el giant tour en días respetando el presupuesto
//
// Como el tour ya está en orden geográfico óptimo, el corte garantiza
// que cada día visite empresas de la misma zona. Empresas en la misma
// calle nunca quedarán en días distintos si caben en el mismo día.
// ──────────────────────────────────────────────────────────────
function splitTourIntoDays(tour) {
  const routes = [];
  let pos = 0;

  while (pos < tour.length) {
    const dayClients = [];
    let minutesUsed  = 0;
    let curLat = BASE.lat, curLon = BASE.lon;
    let carLat = BASE.lat, carLon = BASE.lon;
    let i = pos;

    while (i < tour.length) {
      const c       = tour[i];
      const r       = travelWithCarPark(curLat, curLon, c.lat, c.lon, carLat, carLon);
      const travel  = r.travelMin;
      const andando = r.andando;
      const stayMin = andando ? MEETING_MIN : CLIENT_MIN;
      // ret: si es andando, hay que volver al coche antes de ir a base
      const retCarLat = r.andando ? carLat : c.lat;
      const retCarLon = r.andando ? carLon : c.lon;
      const retWalk   = (r.andando && (Math.abs(c.lat - carLat) > 1e-5 || Math.abs(c.lon - carLon) > 1e-5))
        ? Math.max(WALK_MIN_MIN, walkMin(c.lat, c.lon, carLat, carLon))
        : 0;
      const ret     = retWalk + driveMin(retCarLat, retCarLon, BASE.lat, BASE.lon);
      const total   = minutesUsed + travel + stayMin + ret;

      if (total > MAX_MIN_PER_DAY) break;

      c._andando   = andando;
      c._travelMin = travel;
      minutesUsed += travel + stayMin;
      if (!r.andando) { carLat = c.lat; carLon = c.lon; }
      curLat = c.lat; curLon = c.lon;
      dayClients.push(c);
      i++;
    }

    if (dayClients.length === 0) {
      const c      = tour[pos];
      const distM  = haversine(BASE.lat, BASE.lon, c.lat, c.lon) * 1000;
      c._andando   = distM >= 10 && distM < RADIO_ANDANDO;
      c._travelMin = c._andando ? WALK_MIN_MIN : driveMin(BASE.lat, BASE.lon, c.lat, c.lon);
      dayClients.push(c);
      i = pos + 1;
    }

    const optimized = twoOpt(dayClients, BASE.lat, BASE.lon);
    recomputeTravels(optimized, BASE.lat, BASE.lon);

    const lastC    = optimized[optimized.length - 1];
    const retBase  = driveMin(lastC.lat, lastC.lon, BASE.lat, BASE.lon);
    const dayTotal = optimized.reduce(
      (s, c) => s + c._travelMin + (c._andando ? MEETING_MIN : CLIENT_MIN), 0
    ) + retBase;

    routes.push({ clients: optimized, totalMin: dayTotal });
    pos = i;
  }

  return routes;
}

// ──────────────────────────────────────────────────────────────
// 2-OPT: elimina cruces en la ruta de un día
//
// El nearest-neighbor elige correctamente QUÉ empresas van cada día
// (respetando el presupuesto de horas), pero no garantiza el mejor
// ORDEN. 2-opt detecta pares de aristas que se "cruzan" y las
// invierte, reduciendo la distancia total. Con 4-7 paradas/día
// converge en milisegundos.
// ──────────────────────────────────────────────────────────────
function twoOpt(clients, baseLat, baseLon) {
  if (clients.length <= 2) return clients;

  const base = { lat: baseLat, lon: baseLon };
  // Ruta representada como [base, c0, c1, …, cn-1]; la vuelta a base es implícita
  const pts = [base, ...clients.map(c => ({ ...c }))];

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < pts.length - 2; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        const pA = pts[i];
        const pB = pts[i + 1];
        const pC = pts[j];
        const pD = (j + 1 < pts.length) ? pts[j + 1] : base;

        // ¿Es más corto conectar A→C y B→D en lugar de A→B y C→D?
        const curDist = haversine(pA.lat, pA.lon, pB.lat, pB.lon)
                      + haversine(pC.lat, pC.lon, pD.lat, pD.lon);
        const newDist = haversine(pA.lat, pA.lon, pC.lat, pC.lon)
                      + haversine(pB.lat, pB.lon, pD.lat, pD.lon);

        if (newDist < curDist - 1e-10) {
          // Invertir el segmento entre i+1 y j
          let lo = i + 1, hi = j;
          while (lo < hi) { [pts[lo], pts[hi]] = [pts[hi], pts[lo]]; lo++; hi--; }
          improved = true;
        }
      }
    }
  }

  return pts.slice(1); // quitar el punto base del inicio
}

// Recalcula _travelMin, _andando y _returnToCarMin tras reordenar (2-opt cambia el orden)
function recomputeTravels(clients, baseLat, baseLon) {
  let prevLat = baseLat, prevLon = baseLon;
  let carLat  = baseLat, carLon  = baseLon;

  for (const c of clients) {
    const r = travelWithCarPark(prevLat, prevLon, c.lat, c.lon, carLat, carLon);
    c._andando        = r.andando;
    c._travelMin      = r.travelMin;
    c._returnToCarMin = r.returnToCarMin;
    carLat  = r.newCarLat;
    carLon  = r.newCarLon;
    prevLat = c.lat;
    prevLon = c.lon;
  }
}

// ══════════════════════════════════════════════════════════════
// NUEVO ALGORITMO PROFESIONAL: Fases 1 + 2 + 3
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// Utilidad: nearest-neighbor ordering desde un punto de inicio
// ─────────────────────────────────────────────────────────────
function nnOrder(clients, startLat, startLon) {
  if (clients.length <= 1) return [...clients];
  const remaining = [...clients];
  const ordered   = [];
  let curLat = startLat, curLon = startLon;
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = haversine(curLat, curLon, remaining[0].lat, remaining[0].lon);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversine(curLat, curLon, remaining[i].lat, remaining[i].lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    curLat = next.lat; curLon = next.lon;
  }
  return ordered;
}

// Centroide geográfico de un array de clientes
function centroide(clients) {
  const lat = clients.reduce((s, c) => s + c.lat, 0) / clients.length;
  const lon = clients.reduce((s, c) => s + c.lon, 0) / clients.length;
  return { lat, lon };
}

// ─────────────────────────────────────────────────────────────
// FASE 1: Clustering Jerárquico Aglomerativo — Enlace Completo
//
// Agrupa empresas por proximidad geográfica.
// Enlace completo: distancia entre clusters = max entre todos los pares.
// Esto garantiza que TODOS los miembros del cluster están a ≤ 2.5 km
// entre sí (sin agrupaciones "alargadas" donde los extremos están lejos).
// ─────────────────────────────────────────────────────────────
function clusterizarEmpresas(clientes) {
  process.stdout.write('   🔵 Fase 1: Clustering jerárquico… ');

  // Precomputar matriz de distancias haversine (solo triángulo superior)
  const N   = clientes.length;
  const mat = [];
  for (let i = 0; i < N; i++) {
    mat[i] = new Float32Array(N);
    for (let j = i + 1; j < N; j++) {
      mat[i][j] = haversine(clientes[i].lat, clientes[i].lon, clientes[j].lat, clientes[j].lon);
    }
  }

  // Cada empresa empieza como su propio cluster (conjunto de índices)
  let idxClusters = clientes.map((_, i) => [i]);

  // Distancia de enlace completo entre dos clusters (por sus índices)
  function completeLinkage(idxA, idxB) {
    let maxD = 0;
    for (const a of idxA) {
      for (const b of idxB) {
        const d = a < b ? mat[a][b] : (b < a ? mat[b][a] : 0);
        if (d > maxD) maxD = d;
      }
    }
    return maxD;
  }

  let merged = true;
  while (merged) {
    merged = false;
    let bestDist = Infinity, bestI = -1, bestJ = -1;

    for (let i = 0; i < idxClusters.length - 1; i++) {
      for (let j = i + 1; j < idxClusters.length; j++) {
        const d = completeLinkage(idxClusters[i], idxClusters[j]);
        if (d < bestDist) { bestDist = d; bestI = i; bestJ = j; }
      }
    }

    if (bestI !== -1 && bestDist <= CLUSTER_DIAMETER_KM) {
      idxClusters[bestI].push(...idxClusters[bestJ]);
      idxClusters.splice(bestJ, 1);
      merged = true;
    }
  }

  // Convertir índices a arrays de clientes
  const clusters = idxClusters.map(idxs => ({ clients: idxs.map(i => clientes[i]) }));
  process.stdout.write(`${clusters.length} clusters\n`);
  return clusters;
}

// ─────────────────────────────────────────────────────────────
// FASE 2: Bin-Packing — First-Fit Decreasing con restricción geográfica
//
// Asigna clusters a días de trabajo:
// - Clusters grandes (> un día) se dividen greedily.
// - No se mezclan clusters cuyo centroide esté a >CLUSTER_MIX_MAX_KM.
// - Primero se colocan los clusters más grandes (FFD).
// ─────────────────────────────────────────────────────────────
function asignarClustersADias(clusters) {
  process.stdout.write('   🟡 Fase 2: Bin-packing clusters → días… ');

  // Estimar tiempo de cada cluster (NN desde base)
  const clustersConT = clusters.map(cl => {
    const ordered = nnOrder(cl.clients, BASE.lat, BASE.lon);
    recomputeTravels(ordered, BASE.lat, BASE.lon);
    return { clients: ordered, estimatedTime: dayTravelTime(ordered) };
  });

  // FFD: mayor tiempo estimado primero
  clustersConT.sort((a, b) => b.estimatedTime - a.estimatedTime);

  const days = []; // { clients, totalMin }

  for (const cluster of clustersConT) {
    if (cluster.clients.length === 0) continue;

    if (cluster.estimatedTime <= MAX_MIN_PER_DAY) {
      // Buscar el primer día con espacio Y compatible geográficamente
      const clCentro = centroide(cluster.clients);
      let placed = false;

      for (const day of days) {
        const dayCentro   = centroide(day.clients);
        const distCentros = haversine(clCentro.lat, clCentro.lon, dayCentro.lat, dayCentro.lon);
        if (distCentros > CLUSTER_MIX_MAX_KM) continue; // demasiado lejos → no mezclar

        const combined = nnOrder([...day.clients, ...cluster.clients], BASE.lat, BASE.lon);
        recomputeTravels(combined, BASE.lat, BASE.lon);
        const newTime = dayTravelTime(combined);
        if (newTime <= MAX_MIN_PER_DAY) {
          day.clients  = combined;
          day.totalMin = newTime;
          placed = true;
          break;
        }
      }

      if (!placed) {
        days.push({ clients: cluster.clients, totalMin: cluster.estimatedTime });
      }
    } else {
      // Cluster demasiado grande: dividir greedily en sub-días
      let remaining = nnOrder(cluster.clients, BASE.lat, BASE.lon);
      while (remaining.length > 0) {
        const dayClients = [];
        let i = 0;

        while (i < remaining.length) {
          const test = nnOrder([...dayClients, remaining[i]], BASE.lat, BASE.lon);
          recomputeTravels(test, BASE.lat, BASE.lon);
          if (dayTravelTime(test) <= MAX_MIN_PER_DAY) {
            dayClients.push(remaining[i]);
            i++;
          } else {
            break;
          }
        }

        if (dayClients.length === 0) {
          dayClients.push(remaining[0]);
          i = 1;
        }

        recomputeTravels(dayClients, BASE.lat, BASE.lon);
        days.push({ clients: dayClients, totalMin: dayTravelTime(dayClients) });
        remaining = remaining.slice(i);
      }
    }
  }

  process.stdout.write(`${days.length} días\n`);
  return days;
}

// ─────────────────────────────────────────────────────────────
// FASE 3: Held-Karp — TSP exacto para días con ≤ HELD_KARP_MAX empresas
//
// Programación dinámica sobre subconjuntos (bitmask DP).
// Garantiza matemáticamente el orden ÓPTIMO de visitas.
// Para N=8 empresas: 2^8 × 8 = 2048 estados → milisegundos.
//
// Parámetros:
//   N      = número de clientes (sin contar la base)
//   matrix = matriz (N+1)×(N+1); [0]=base, [1..N]=clientes
// Devuelve: array de índices 0-based (en clients[]) en orden óptimo
// ─────────────────────────────────────────────────────────────
function heldKarp(N, matrix) {
  if (N === 0) return [];
  if (N === 1) return [0];

  const FULL = (1 << N) - 1;
  const INF  = 1e9;

  // dp[S][i] = coste mínimo para visitar exactamente los clientes del bitmask S, terminando en i
  const dp   = Array.from({ length: 1 << N }, () => new Float64Array(N).fill(INF));
  const prev = Array.from({ length: 1 << N }, () => new Int16Array(N).fill(-1));

  // Caso base: ir de la base directamente a cada cliente
  for (let i = 0; i < N; i++) {
    dp[1 << i][i] = matrix[0][i + 1];
  }

  // Rellenar tabla DP
  for (let S = 1; S <= FULL; S++) {
    for (let i = 0; i < N; i++) {
      if (!(S & (1 << i))) continue;
      if (dp[S][i] >= INF) continue;
      for (let j = 0; j < N; j++) {
        if (S & (1 << j)) continue;
        const newS = S | (1 << j);
        const cost = dp[S][i] + matrix[i + 1][j + 1];
        if (cost < dp[newS][j]) {
          dp[newS][j] = cost;
          prev[newS][j] = i;
        }
      }
    }
  }

  // Encontrar el último cliente que minimiza coste total (incluida vuelta a base)
  let bestCost = INF, bestEnd = 0;
  for (let i = 0; i < N; i++) {
    const total = dp[FULL][i] + matrix[i + 1][0];
    if (total < bestCost) { bestCost = total; bestEnd = i; }
  }

  // Reconstruir el camino óptimo
  const path = [];
  let S = FULL, cur = bestEnd;
  while (S > 0) {
    path.push(cur);
    const p = prev[S][cur];
    S ^= (1 << cur);
    cur = p;
  }
  path.reverse();
  return path;
}

// ─────────────────────────────────────────────────────────────
// CONSTRUCCIÓN DE RUTAS DIARIAS (nuevo algoritmo: Fase 1 + 2)
// La Fase 3 (Held-Karp) se aplica después en refineWithGoogleMaps.
// ─────────────────────────────────────────────────────────────
function buildDailyRoutes(clientes) {
  // Fase 1: agrupar empresas geográficamente
  const clusters = clusterizarEmpresas(clientes);

  // Fase 2: asignar clusters a días respetando tiempo y geografía
  const routes = asignarClustersADias(clusters);

  return routes;
}

// ──────────────────────────────────────────────────────────────
// Calcula el tiempo de desplazamiento de (fromLat,fromLon) a
// (toLat,toLon) teniendo en cuenta dónde está aparcado el coche.
// Si el trayecto es andando, el coche no se mueve.
// Si es en coche, primero hay que caminar de vuelta al coche.
// Retorna { travelMin, andando, newCarLat, newCarLon, returnToCarMin }
// ──────────────────────────────────────────────────────────────
function travelWithCarPark(fromLat, fromLon, toLat, toLon, carLat, carLon) {
  const distM = haversine(fromLat, fromLon, toLat, toLon) * 1000;

  // Caso 1: distancia claramente caminable (dentro de RADIO_ANDANDO)
  if (distM >= 10 && distM < RADIO_ANDANDO) {
    return {
      travelMin:      Math.max(WALK_MIN_MIN, walkMin(fromLat, fromLon, toLat, toLon)),
      andando:        true,
      returnToCarMin: 0,
      newCarLat:      carLat,
      newCarLon:      carLon
    };
  }

  // Caso 2: destino más lejos de RADIO_ANDANDO — comparar opciones
  const enElCoche  = Math.abs(fromLat - carLat) < 1e-5 && Math.abs(fromLon - carLon) < 1e-5;
  const returnMin  = enElCoche
    ? 0
    : Math.max(WALK_MIN_MIN, walkMin(fromLat, fromLon, carLat, carLon));
  const driveTotal = returnMin + driveMin(carLat, carLon, toLat, toLon);

  // ¿Merece la pena andar directo en vez de volver al coche?
  // Solo si el coche está lejos Y andar directo es más rápido Y tolerable (≤ WALK_MAX_DIRECT_MIN)
  if (!enElCoche) {
    const walkDirect = walkMin(fromLat, fromLon, toLat, toLon);
    if (walkDirect < driveTotal && walkDirect <= WALK_MAX_DIRECT_MIN) {
      return {
        travelMin:      walkDirect,
        andando:        true,
        returnToCarMin: 0,
        newCarLat:      carLat,   // el coche no se mueve
        newCarLon:      carLon
      };
    }
  }

  return {
    travelMin:      driveTotal,
    andando:        false,
    returnToCarMin: returnMin,
    newCarLat:      toLat,
    newCarLon:      toLon
  };
}

// ──────────────────────────────────────────────────────────────
// Calcula el tiempo total de un día dado una lista de clientes
// (incluye viajes + estancias + vuelta a base)
// ──────────────────────────────────────────────────────────────
function dayTravelTime(clients) {
  if (clients.length === 0) return 0;
  let time   = 0;
  let prevLat = BASE.lat, prevLon = BASE.lon;
  let carLat  = BASE.lat, carLon  = BASE.lon;

  for (const c of clients) {
    const r = travelWithCarPark(prevLat, prevLon, c.lat, c.lon, carLat, carLon);
    time   += r.travelMin + (r.andando ? MEETING_MIN : CLIENT_MIN);
    carLat  = r.newCarLat;
    carLon  = r.newCarLon;
    prevLat = c.lat;
    prevLon = c.lon;
  }

  // Vuelta a la base: caminar al coche si hace falta, luego conducir
  const enElCoche = Math.abs(prevLat - carLat) < 1e-5 && Math.abs(prevLon - carLon) < 1e-5;
  const retWalk   = enElCoche ? 0 : Math.max(WALK_MIN_MIN, walkMin(prevLat, prevLon, carLat, carLon));
  time += retWalk + driveMin(carLat, carLon, BASE.lat, BASE.lon);

  return time;
}

// ──────────────────────────────────────────────────────────────
// Or-opt inter-día: mueve empresas entre días para minimizar
// el tiempo total de desplazamiento.
//
// Para cada empresa, prueba si moverla a otro día (donde sus
// vecinas están más cerca) reduce el tiempo total. Itera hasta
// que ningún movimiento mejore la solución.
// ──────────────────────────────────────────────────────────────
function interDayRelocate(routes) {
  let improved = true;
  let passes   = 0;

  while (improved && passes < 30) {
    improved = false;
    passes++;

    for (let d = 0; d < routes.length; d++) {
      if (routes[d].clients.length === 0) continue;

      for (let ci = 0; ci < routes[d].clients.length; ci++) {
        const client     = routes[d].clients[ci];
        const dayWithout = routes[d].clients.filter((_, i) => i !== ci);

        // Coste del día D sin esta empresa
        const costDWithout = dayTravelTime(dayWithout);
        const savedInD     = routes[d].totalMin - costDWithout;

        let bestGain = 0.5; // mínimo 30 seg de mejora para mover
        let bestMove = null;

        for (let d2 = 0; d2 < routes.length; d2++) {
          if (d2 === d) continue;

          // Probar cada posición de inserción en el día D2
          for (let pos = 0; pos <= routes[d2].clients.length; pos++) {
            const newDay = [
              ...routes[d2].clients.slice(0, pos),
              client,
              ...routes[d2].clients.slice(pos)
            ];

            const newCostD2 = dayTravelTime(newDay);
            if (newCostD2 > MAX_MIN_PER_DAY) continue;

            const gain = savedInD - (newCostD2 - routes[d2].totalMin);
            if (gain > bestGain) {
              bestGain = gain;
              bestMove = { d2, pos, newDay, newCostD2 };
            }
          }
        }

        if (bestMove) {
          // Aplicar movimiento
          routes[d].clients = dayWithout;
          const optD = twoOpt(dayWithout, BASE.lat, BASE.lon);
          recomputeTravels(optD, BASE.lat, BASE.lon);
          routes[d].clients  = optD;
          routes[d].totalMin = dayTravelTime(optD);

          const optD2 = twoOpt(bestMove.newDay, BASE.lat, BASE.lon);
          recomputeTravels(optD2, BASE.lat, BASE.lon);
          routes[bestMove.d2].clients  = optD2;
          routes[bestMove.d2].totalMin = dayTravelTime(optD2);

          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  process.stdout.write(`(${passes} pasadas) `);
  // Eliminar días que quedaron vacíos tras mover todas sus empresas
  return routes.filter(r => r.clients.length > 0);
}

// ──────────────────────────────────────────────────────────────
// Or-opt inter-día SWAP: intercambia una empresa de un día con
// una empresa de otro día si la suma total de tiempo de viaje
// de ambos días mejora. Complementa al relocate (que solo mueve).
// ──────────────────────────────────────────────────────────────
function interDaySwap(routes) {
  let improved = true;
  let passes   = 0;

  while (improved && passes < 15) {
    improved = false;
    passes++;

    outer:
    for (let d1 = 0; d1 < routes.length - 1; d1++) {
      if (routes[d1].clients.length === 0) continue;

      for (let d2 = d1 + 1; d2 < routes.length; d2++) {
        if (routes[d2].clients.length === 0) continue;

        for (let ci = 0; ci < routes[d1].clients.length; ci++) {
          for (let cj = 0; cj < routes[d2].clients.length; cj++) {
            const c1 = routes[d1].clients[ci];
            const c2 = routes[d2].clients[cj];

            // Construir días con el intercambio
            const newDay1 = [...routes[d1].clients]; newDay1[ci] = c2;
            const newDay2 = [...routes[d2].clients]; newDay2[cj] = c1;

            const newCost1 = dayTravelTime(newDay1);
            const newCost2 = dayTravelTime(newDay2);
            if (newCost1 > MAX_MIN_PER_DAY || newCost2 > MAX_MIN_PER_DAY) continue;

            const gain = (routes[d1].totalMin + routes[d2].totalMin) - (newCost1 + newCost2);
            if (gain <= 0.5) continue;

            // Aplicar intercambio con 2-opt en cada día afectado
            const opt1 = twoOpt(newDay1, BASE.lat, BASE.lon);
            recomputeTravels(opt1, BASE.lat, BASE.lon);
            routes[d1].clients  = opt1;
            routes[d1].totalMin = dayTravelTime(opt1);

            const opt2 = twoOpt(newDay2, BASE.lat, BASE.lon);
            recomputeTravels(opt2, BASE.lat, BASE.lon);
            routes[d2].clients  = opt2;
            routes[d2].totalMin = dayTravelTime(opt2);

            improved = true;
            break outer;
          }
        }
      }
    }
  }

  process.stdout.write(`(${passes} pasadas) `);
  return routes;
}

// ──────────────────────────────────────────────────────────────
// Or-opt-2 inter-día: mueve PARES de empresas consecutivas entre
// días. Complementa al relocate individual: si dos empresas
// geográficamente cercanas están en días distintos, moverlas
// juntas puede reducir el viaje total aunque mover una sola no ayude.
// ──────────────────────────────────────────────────────────────
function interDayRelocate2(routes) {
  let improved = true;
  let passes   = 0;

  while (improved && passes < 20) {
    improved = false;
    passes++;

    for (let d = 0; d < routes.length; d++) {
      if (routes[d].clients.length < 2) continue;

      for (let ci = 0; ci < routes[d].clients.length - 1; ci++) {
        const pair      = [routes[d].clients[ci], routes[d].clients[ci + 1]];
        const dayWithout = routes[d].clients.filter((_, i) => i !== ci && i !== ci + 1);

        const costDWithout = dayTravelTime(dayWithout);
        const savedInD     = routes[d].totalMin - costDWithout;

        let bestGain = 1; // mínimo 1 minuto de mejora
        let bestMove = null;

        for (let d2 = 0; d2 < routes.length; d2++) {
          if (d2 === d) continue;

          for (let pos = 0; pos <= routes[d2].clients.length; pos++) {
            const newDay = [
              ...routes[d2].clients.slice(0, pos),
              ...pair,
              ...routes[d2].clients.slice(pos)
            ];
            const newCostD2 = dayTravelTime(newDay);
            if (newCostD2 > MAX_MIN_PER_DAY) continue;

            const gain = savedInD - (newCostD2 - routes[d2].totalMin);
            if (gain > bestGain) {
              bestGain = gain;
              bestMove = { d2, pos, newDay, newCostD2 };
            }
          }
        }

        if (bestMove) {
          routes[d].clients = dayWithout;
          const optD = twoOpt(dayWithout, BASE.lat, BASE.lon);
          recomputeTravels(optD, BASE.lat, BASE.lon);
          routes[d].clients  = optD;
          routes[d].totalMin = dayTravelTime(optD);

          const optD2 = twoOpt(bestMove.newDay, BASE.lat, BASE.lon);
          recomputeTravels(optD2, BASE.lat, BASE.lon);
          routes[bestMove.d2].clients  = optD2;
          routes[bestMove.d2].totalMin = dayTravelTime(optD2);

          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  process.stdout.write(`(${passes} pasadas) `);
  return routes.filter(r => r.clients.length > 0);
}

// ──────────────────────────────────────────────────────────────
// ASIGNACIÓN A FECHAS LABORALES
// ──────────────────────────────────────────────────────────────
function assignDates(routes) {
  let date = new Date(START_DATE);
  while (!isWorkDay(date)) date = nextWorkDay(date);

  return routes.map(route => {
    const entry = { date: new Date(date), ...route };
    date = nextWorkDay(date);
    return entry;
  });
}

// ──────────────────────────────────────────────────────────────
// CALCULAR HORARIOS DE CADA CLIENTE EN UN DÍA
// ──────────────────────────────────────────────────────────────
function computeTimes(dayEntry) {
  let cur = WORK_H * 60 + WORK_M;
  return dayEntry.clients.map((c, i) => {
    cur += c._travelMin;
    const llegada = fmtMin(cur);
    cur += c._andando ? MEETING_MIN : CLIENT_MIN;
    const salida  = fmtMin(cur);
    return { ...c, llegada, salida };
  });
}

// ──────────────────────────────────────────────────────────────
// GENERACIÓN EXCEL
// ──────────────────────────────────────────────────────────────
function generateExcel(schedule) {
  const wb = XLSX.utils.book_new();

  // Agrupar por semana ISO
  const weeks = new Map();
  for (const day of schedule) {
    const d       = day.date;
    const jan1    = new Date(d.getFullYear(), 0, 1);
    const week    = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    const wKey    = `${d.getFullYear()}-S${String(week).padStart(2,'0')}`;
    if (!weeks.has(wKey)) weeks.set(wKey, []);
    weeks.get(wKey).push(day);
  }

  for (const [wKey, days] of weeks) {
    const rows = [[
      'Día', 'Fecha', 'Nº', 'Empresa',
      'Dirección', 'Municipio', 'CP',
      'Hora llegada', 'Hora salida',
      'Viaje al sig. (min)', 'Total día'
    ]];

    for (const day of days) {
      const clients = computeTimes(day);
      const retBase = day._retBase != null
        ? day._retBase
        : driveMin(clients[clients.length-1].lat, clients[clients.length-1].lon, BASE.lat, BASE.lon);
      const dayLabel  = day.date.toLocaleDateString('es-ES', { weekday:'long' });
      const dateStr   = day.date.toLocaleDateString('es-ES');
      const totalHStr = `${(day.totalMin/60).toFixed(1)} h`;

      clients.forEach((c, i) => {
        const nextTravel = i < clients.length - 1
          ? clients[i+1]._travelMin
          : retBase;
        const nextLabel  = i < clients.length - 1
          ? String(nextTravel)
          : `↩ ${nextTravel} (base)`;

        rows.push([
          i === 0 ? dayLabel   : '',
          i === 0 ? dateStr    : '',
          i + 1,
          c['Nombre'],
          c['Dirección'],
          c['Población'],
          String(c['Código postal'] || '').replace('.0',''),
          c.llegada,
          c.salida,
          nextLabel,
          i === 0 ? totalHStr  : '',
        ]);
      });

      rows.push(new Array(11).fill(''));  // fila vacía entre días
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      {wch:12},{wch:11},{wch:4},{wch:42},
      {wch:42},{wch:24},{wch:7},
      {wch:11},{wch:11},{wch:20},{wch:10}
    ];

    // Estilo cabecera (color azul)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!ws[addr]) continue;
      ws[addr].s = {
        fill:   { fgColor: { rgb: '1A56DB' }, patternType: 'solid' },
        font:   { bold: true, color: { rgb: 'FFFFFF' } },
        border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } }
      };
    }

    XLSX.utils.book_append_sheet(wb, ws, wKey);
  }

  // Hoja RESUMEN
  const sumRows = [[
    'Semana', 'Días laborables', 'Visitas', 'Clientes/día', 'Primera fecha', 'Última fecha'
  ]];
  for (const [wKey, days] of weeks) {
    const visitas = days.reduce((s, d) => s + d.clients.length, 0);
    sumRows.push([
      wKey,
      days.length,
      visitas,
      (visitas / days.length).toFixed(1),
      days[0].date.toLocaleDateString('es-ES'),
      days[days.length-1].date.toLocaleDateString('es-ES'),
    ]);
  }
  const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
  wsSum['!cols'] = [{wch:12},{wch:16},{wch:9},{wch:13},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsSum, 'RESUMEN');

  XLSX.writeFile(wb, EXCEL_OUT);
  console.log(`   ✅ Excel: planning_visitas.xlsx`);
}

// ──────────────────────────────────────────────────────────────
// GENERACIÓN HTML INTERACTIVO
// ──────────────────────────────────────────────────────────────
function generateHTML(schedule) {

  const days = schedule.map((day, dayIdx) => {
    const hue     = (dayIdx * 43) % 360;
    const color   = `hsl(${hue},68%,42%)`;
    const clients = computeTimes(day);
    const lastC   = clients[clients.length - 1];
    // Usar retBase de ORS si está disponible, si no Haversine
    const retBase = day._retBase != null
      ? day._retBase
      : driveMin(lastC.lat, lastC.lon, BASE.lat, BASE.lon);

    return {
      date:      day.date.toISOString().slice(0,10),
      dateLabel: day.date.toLocaleDateString('es-ES',
        { weekday:'long', day:'2-digit', month:'long', year:'numeric' }),
      totalMin:  day.totalMin,
      color,
      retBase,
      clients: clients.map((c, i) => ({
        id:        c.id || '',
        andando:   !!c._andando,
        nombre:    c['Nombre'],
        direccion: c['Dirección'],
        poblacion: c['Población'],
        cp:        String(c['Código postal']||'').replace('.0',''),
        lat:       c.lat,
        lon:       c.lon,
        llegada:   c.llegada,
        salida:    c.salida,
        travel:         c._travelMin,
        returnToCarMin: c._returnToCarMin || 0,
        order:          i + 1
      }))
    };
  });

  const totalClientes = days.reduce((s,d) => s + d.clients.length, 0);
  const totalDias     = days.length;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Planning Visitas BilboWeb</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Segoe UI',Arial,sans-serif;display:flex;height:100vh;overflow:hidden;background:#f1f5f9;}

    /* ── Sidebar ── */
    #sidebar{width:390px;min-width:280px;display:flex;flex-direction:column;background:#fff;
             box-shadow:3px 0 12px rgba(0,0,0,.12);z-index:900;overflow:hidden;}

    #hdr{background:linear-gradient(135deg,#1a56db 0%,#0ea5e9 100%);color:#fff;padding:14px 16px;}
    #hdr h1{font-size:17px;font-weight:700;letter-spacing:.3px;}
    #hdr p{font-size:11px;opacity:.82;margin-top:3px;}

    #stats{display:flex;gap:8px;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;}
    .stat{flex:1;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:7px 4px;}
    .stat .n{font-size:22px;font-weight:800;color:#1a56db;}
    .stat .l{font-size:10px;color:#64748b;margin-top:2px;}

    #srch{padding:9px 12px;border-bottom:1px solid #e2e8f0;}
    #srch input{width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;
                font-size:13px;outline:none;transition:border .15s;}
    #srch input:focus{border-color:#1a56db;box-shadow:0 0 0 3px rgba(26,86,219,.12);}

    #cal{overflow-y:auto;flex:1;padding:8px 8px 16px;}

    /* ── Day cards ── */
    .card{margin-bottom:6px;border-radius:10px;border:2px solid transparent;
          overflow:hidden;cursor:pointer;transition:transform .15s,border-color .15s;}
    .card:hover{transform:translateX(3px);}
    .card.open{border-color:#1a56db;box-shadow:0 2px 14px rgba(26,86,219,.2);}

    .card-hdr{display:flex;align-items:center;padding:9px 12px;color:#fff;
              font-weight:600;font-size:13px;gap:6px;}
    .card-hdr .badge{margin-left:auto;background:rgba(255,255,255,.22);
                     border-radius:20px;padding:2px 9px;font-size:11px;white-space:nowrap;}

    .card-body{background:#fff;display:none;}
    .card.open .card-body{display:block;}

    .cli-row{display:flex;align-items:flex-start;gap:8px;padding:7px 11px;
             border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .1s;}
    .cli-row:hover{background:#f8fafc;}
    .cli-row:last-of-type{border-bottom:none;}

    .cli-num{min-width:22px;height:22px;border-radius:50%;display:flex;align-items:center;
             justify-content:center;color:#fff;font-size:11px;font-weight:800;flex-shrink:0;margin-top:2px;}
    .cli-info{flex:1;min-width:0;}
    .cli-name{font-size:12px;font-weight:600;color:#1e293b;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cli-sub{font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cli-drv{font-size:10px;color:#94a3b8;margin-top:1px;}
    .cli-time{text-align:right;flex-shrink:0;}
    .cli-time .arr{font-size:12px;font-weight:700;color:#0ea5e9;}
    .cli-time .dep{font-size:10px;color:#94a3b8;}

    .card-foot{padding:5px 11px;background:#f8fafc;display:flex;justify-content:space-between;
               font-size:11px;color:#64748b;border-top:1px solid #f1f5f9;}

    /* ── Map ── */
    #map{flex:1;}

    /* ── No results ── */
    .nores{text-align:center;color:#94a3b8;font-size:13px;padding:24px;}

    /* ── Barra de navegación ── */
    #nav{display:flex;align-items:center;background:#1e293b;height:36px;flex-shrink:0;padding:0 12px;}
    #nav a{color:rgba(255,255,255,.6);text-decoration:none;font-size:12px;font-weight:600;
           padding:0 14px;height:36px;display:flex;align-items:center;
           border-bottom:2px solid transparent;transition:all .15s;}
    #nav a:hover{color:#fff;}
    #nav a.active{color:#fff;border-bottom-color:#1a56db;}

    /* ── App container ── */
    body{flex-direction:column;}
    #app{display:flex;flex:1;overflow:hidden;}

    /* ── Botón nota ── */
    .nota-btn{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;
              border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;
              background:#eff6ff;color:#1a56db;border:1px solid #bfdbfe;
              flex-shrink:0;transition:all .15s;cursor:pointer;white-space:nowrap;
              margin-left:4px;}
    .nota-btn:hover{background:#1a56db;color:#fff;border-color:#1a56db;}

    /* ── Indicador andando ── */
    .badge-walk{font-size:9px;background:#d1fae5;color:#065f46;border-radius:4px;
                padding:1px 5px;font-weight:700;margin-left:4px;}
  </style>
</head>
<body>

<nav id="nav">
  <a href="/" class="active">🗓 Planning</a>
  <a href="/notas">📝 Notas</a>
  <a href="/config">⚙️ Config</a>
  <a href="/api/download/excel" style="margin-left:auto;background:#059669;color:#fff;border-radius:6px;padding:0 14px;font-size:12px;border-bottom:none!important" download>⬇ Excel</a>
</nav>

<div id="app">
<div id="sidebar">
  <div id="hdr">
    <h1>🗓 Planning Visitas BilboWeb</h1>
    <p>Desde Barakaldo · ${totalClientes} clientes · ${totalDias} días laborables</p>
  </div>

  <div id="stats">
    <div class="stat"><div class="n">${totalClientes}</div><div class="l">Clientes</div></div>
    <div class="stat"><div class="n">${totalDias}</div><div class="l">Días</div></div>
    <div class="stat"><div class="n" id="wkCount">…</div><div class="l">Semanas</div></div>
  </div>

  <div id="srch">
    <input id="q" type="text" placeholder="🔍 Buscar empresa o municipio…" oninput="filter()">
  </div>

  <div id="cal"></div>
</div>

<div id="map"></div>
</div><!-- /app -->

<script>
const DATA  = ${JSON.stringify(days)};
const BASE  = { lat:${BASE.lat}, lon:${BASE.lon} };

/* ── Contar semanas únicas ── */
const weeks = new Set(DATA.map(d => {
  const dt = new Date(d.date), j = new Date(dt.getFullYear(),0,1);
  return Math.ceil(((dt-j)/864e5 + j.getDay()+1)/7) + '-' + dt.getFullYear();
}));
document.getElementById('wkCount').textContent = weeks.size;

/* ── Mapa Leaflet ── */
const map = L.map('map').setView([BASE.lat, BASE.lon], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution:'© OpenStreetMap contributors' }).addTo(map);

/* Marcador base */
L.marker([BASE.lat, BASE.lon], { icon: L.divIcon({
  html:'<div style="background:#1a56db;color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 7px rgba(0,0,0,.4)">🏢</div>',
  iconSize:[34,34], iconAnchor:[17,17], className:''
})}).addTo(map).bindPopup('<b>BilboWeb — Base</b><br>Barakaldo');

/* ── Jitter para coords duplicadas ── */
(function() {
  const seen = {};
  DATA.forEach(day => {
    day.clients.forEach(c => {
      if (!c.lat || !c.lon) return;
      const key = c.lat.toFixed(3) + ',' + c.lon.toFixed(3);
      if (!seen[key]) seen[key] = 0;
      const idx = seen[key]++;
      if (idx > 0) {
        const angle = idx * 2.39996; // ángulo áureo en radianes
        const r = 0.0007 * Math.ceil(Math.sqrt(idx));
        c.lat = parseFloat((c.lat + r * Math.sin(angle)).toFixed(6));
        c.lon = parseFloat((c.lon + r * Math.cos(angle)).toFixed(6));
      }
    });
  });
})();

/* ── Construir marcadores + polilíneas ── */
const mkrs  = {};
const lines = {};

DATA.forEach((day, di) => {
  mkrs[di]  = [];
  const pts = [[BASE.lat, BASE.lon]];

  day.clients.forEach((c, ci) => {
    if (!c.lat || !c.lon) return;
    const m = L.marker([c.lat, c.lon], { icon: L.divIcon({
      html:\`<div style="background:\${day.color};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;box-shadow:0 2px 5px rgba(0,0,0,.35)">\${c.order}</div>\`,
      iconSize:[26,26], iconAnchor:[13,13], className:''
    }), opacity:.85 }).addTo(map);
    m.bindPopup(\`<b>\${c.nombre}</b><br><small>\${c.direccion}<br>\${c.poblacion} \${c.cp}</small><br>🕐 \${c.llegada} – \${c.salida}<br><a href="/notas?id=\${c.id}" class="nota-btn" style="margin-top:6px">📝 Abrir nota</a>\`);
    m.on('click', () => { openDay(di, true); focusClient(di, ci); });
    mkrs[di].push(m);
    pts.push([c.lat, c.lon]);
  });

  pts.push([BASE.lat, BASE.lon]);
  lines[di] = L.polyline(pts, { color:day.color, weight:2.5, opacity:.38, dashArray:'7,5' }).addTo(map);
});

/* ── Construir sidebar ── */
const cal = document.getElementById('cal');
let active = null;

DATA.forEach((day, di) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'c' + di;

  const h = document.createElement('div');
  h.className = 'card-hdr';
  h.style.background = day.color;
  h.innerHTML = \`<span>📅 \${day.dateLabel}</span>
    <span class="badge">\${day.clients.length} visitas · \${(day.totalMin/60).toFixed(1)}h</span>\`;
  h.onclick = () => toggleDay(di);

  const body = document.createElement('div');
  body.className = 'card-body';

  day.clients.forEach((c, ci) => {
    const row = document.createElement('div');
    row.className = 'cli-row';
    row.innerHTML = \`
      <div class="cli-num" style="background:\${day.color}">\${c.order}</div>
      <div class="cli-info">
        <div class="cli-name">\${c.nombre}</div>
        <div class="cli-sub">\${c.poblacion}\${c.cp ? ' · '+c.cp : ''}</div>
        <div class="cli-drv">\${c.andando
          ? \`🚶 \${c.travel} min andando\`
          : \`\${c.returnToCarMin > 0 ? \`🚶 \${c.returnToCarMin}' al coche + \` : ''}\${c.travel > 0 ? \`🚗 \${c.travel} min\` : '🚗 &lt;1 min'}\`}</div>
      </div>
      <div class="cli-time">
        <div class="arr">\${c.llegada}</div>
        <div class="dep">\${c.salida}</div>
      </div>
      \${c.id ? \`<a class="nota-btn" href="/notas?id=\${c.id}" onclick="event.stopPropagation()">📝</a>\` : ''}\`;
    row.onclick = e => { e.stopPropagation(); focusClient(di, ci); };
    body.appendChild(row);
  });

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  foot.innerHTML = \`<span>⏱ Total: \${(day.totalMin/60).toFixed(1)} h</span>
    <span>↩ \${day.retBase} min vuelta a base</span>\`;
  body.appendChild(foot);

  card.appendChild(h);
  card.appendChild(body);
  cal.appendChild(card);
});

/* ── Interactividad ── */
function toggleDay(di, force) {
  const card = document.getElementById('c' + di);
  const wasOpen = card.classList.contains('open');
  if (active !== null) closeDay(active);
  if (!wasOpen || force) openDay(di);
}

function openDay(di, keepClosed) {
  if (keepClosed) return;
  const card = document.getElementById('c' + di);
  card.classList.add('open');
  active = di;
  // Línea activa
  if (lines[di]) lines[di].setStyle({ opacity:.9, weight:4.5 });
  mkrs[di]?.forEach(m => m.setOpacity(1));
  // Atenuar resto
  DATA.forEach((_, k) => {
    if (k !== di) {
      if (lines[k]) lines[k].setStyle({ opacity:.12, weight:1.5 });
      mkrs[k]?.forEach(m => m.setOpacity(.28));
    }
  });
  // Centrar mapa
  const pts = DATA[di].clients.filter(c => c.lat && c.lon).map(c => [c.lat, c.lon]);
  if (pts.length) map.fitBounds([[BASE.lat,BASE.lon], ...pts], { padding:[50,50] });
  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function closeDay(di) {
  document.getElementById('c'+di)?.classList.remove('open');
  active = null;
  DATA.forEach((_, k) => {
    if (lines[k]) lines[k].setStyle({ opacity:.38, weight:2.5 });
    mkrs[k]?.forEach(m => m.setOpacity(.85));
  });
}

function focusClient(di, ci) {
  const c = DATA[di].clients[ci];
  if (c.lat && c.lon) {
    map.setView([c.lat, c.lon], 15);
    mkrs[di]?.[ci]?.openPopup();
  }
}

function filter() {
  const q = document.getElementById('q').value.toLowerCase().trim();
  let shown = 0;
  DATA.forEach((day, di) => {
    const card = document.getElementById('c'+di);
    const hit  = !q || day.dateLabel.toLowerCase().includes(q) ||
      day.clients.some(c => c.nombre.toLowerCase().includes(q) ||
                            c.poblacion.toLowerCase().includes(q));
    card.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });
  // Mensaje sin resultados
  let nr = document.getElementById('nores');
  if (!shown && q) {
    if (!nr) { nr = document.createElement('div'); nr.id='nores'; nr.className='nores'; cal.appendChild(nr); }
    nr.textContent = 'Sin resultados para "' + q + '"';
  } else if (nr) nr.remove();
}
</script>
</body>
</html>`;

  fs.writeFileSync(HTML_OUT, html, 'utf-8');
  console.log(`   ✅ Mapa HTML: planning_mapa.html`);
}

// ──────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────
async function mergeSupabaseConfig() {
  const supaUrl = 'https://mwrkidkvjyrcuexxkhbv.supabase.co';
  const supaKey = CFG.supabaseServiceKey || CFG.supabaseAnonKey || '';
  if (!supaKey) {
    console.log('   ℹ️  Sin clave Supabase — usando config.json local');
    return;
  }
  try {
    const r = await fetch(`${supaUrl}/rest/v1/app_config?id=eq.1&select=*`, {
      headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}` }
    });
    if (!r.ok) {
      console.log('   ⚠️  No se pudo leer app_config de Supabase:', r.status, '— usando config.json local');
      return;
    }
    const rows = await r.json();
    if (!rows.length) {
      console.log('   ℹ️  app_config vacío en Supabase — usando config.json local');
      return;
    }
    const sc = rows[0];
    if (sc.fecha_inicio)          CFG.fechaInicio         = sc.fecha_inicio;
    if (sc.horas_maxima_dia)      CFG.horasMaximaDia      = sc.horas_maxima_dia;
    if (sc.minutos_reunion)       CFG.minutosReunion      = sc.minutos_reunion;
    if (sc.minutos_aparcamiento)  CFG.minutosAparcamiento = sc.minutos_aparcamiento;
    if (sc.hora_inicio_jornada)   CFG.horaInicioJornada   = sc.hora_inicio_jornada;
    if (sc.radio_andando != null) CFG.radioAndando        = sc.radio_andando;
    if (sc.base)                  CFG.base                = sc.base;
    if (sc.filtros)               CFG.filtros             = sc.filtros;
    if (sc.google_api_key)        CFG.googleApiKey        = sc.google_api_key;
    console.log('   ✅ Configuración cargada desde Supabase (app_config)');
  } catch(e) {
    console.log('   ⚠️  Error leyendo config de Supabase:', e.message, '— usando config.json local');
  }
}

async function main() {
  console.log('\n🚀  Planning Visitas Comerciales BilboWeb');
  console.log('══════════════════════════════════════════');
  console.log(`  Modo rutas : ${ORS_API_KEY ? '✅ ORS (conducción real)' : '📐 Estimado (Haversine × 1.40)'}`);
  console.log(`  Inicio     : ${START_DATE.toLocaleDateString('es-ES')}`);
  console.log(`  Límite/día : ${MAX_MIN_PER_DAY/60} h`);
  console.log(`  Jornada    : desde las ${CFG.horaInicioJornada || '09:00'}`);
  console.log(`  Por cliente: ${MEETING_MIN} min reunión + ${PARKING_MIN} min aparcamiento (solo en coche) = ${CLIENT_MIN} min máx`);
  if (EXCLUIR_CLIENTES.size > 0) console.log(`  Excluidos  : ${EXCLUIR_CLIENTES.size} clientes`);
  if (SOLO_MUNICIPIOS.length > 0) console.log(`  Municipios : solo ${SOLO_MUNICIPIOS.join(', ')}`);
  console.log('');

  // 0. Leer config desde Supabase (override del config.json local)
  console.log('0️⃣  Leyendo configuración desde Supabase…');
  await mergeSupabaseConfig();

  // Re-derivar constantes operativas con la config definitiva
  START_DATE      = parseFechaInicio(CFG.fechaInicio);
  MAX_MIN_PER_DAY = (CFG.horasMaximaDia || 5) * 60;
  MEETING_MIN     = CFG.minutosReunion      || 30;
  PARKING_MIN     = CFG.minutosAparcamiento || 10;
  CLIENT_MIN      = MEETING_MIN + PARKING_MIN;
  RADIO_ANDANDO   = CFG.radioAndando || 600;
  [WORK_H, WORK_M] = (CFG.horaInicioJornada || '09:00').split(':').map(Number);
  BASE            = CFG.base || { nombre: 'BilboWeb', lat: 43.2956, lon: -2.9921, direccion: 'Barakaldo, Bizkaia' };
  EXCLUIR_CLIENTES = new Set((CFG.filtros?.excluirClientes || []).map(s => s.toLowerCase()));
  SOLO_MUNICIPIOS  = (CFG.filtros?.soloMunicipios  || []).map(s => s.toLowerCase());
  SOLO_CPS         = new Set(CFG.filtros?.soloCodigosPostales || []);

  // Actualizar resumen en consola con config definitiva
  console.log(`  Inicio     : ${START_DATE.toLocaleDateString('es-ES')}`);
  console.log(`  Límite/día : ${MAX_MIN_PER_DAY/60} h`);
  console.log(`  Jornada    : desde las ${CFG.horaInicioJornada || '09:00'}`);
  console.log('');

  // 1. CSV
  console.log('1️⃣  Leyendo CSV…');
  const clientes = parseCSV(CSV_FILE);
  console.log(`    → ${clientes.length} clientes cargados`);

  // 2. Geocodificación
  console.log('2️⃣  Geocodificando direcciones (Nominatim)…');
  const geo = await geocodeAll(clientes);
  console.log(`    → ${geo.length} clientes con coordenadas`);

  // 3. Rutas — nuevo algoritmo: Clustering → Bin-packing → (Held-Karp en paso 3d)
  console.log('3️⃣  Construyendo rutas (Clustering jerárquico + Bin-packing)…');
  const routes = buildDailyRoutes(geo);
  console.log(`    → ${routes.length} días (orden inicial por Haversine)`);

  // 3d. Fase 3: Held-Karp exacto + tiempos reales Google Maps por día
  const googleKey = CFG.googleApiKey || '';
  if (googleKey) {
    console.log('3d. Fase 3: Held-Karp + Google Maps Distance Matrix (orden y tiempos óptimos)…');
    await refineWithGoogleMaps(routes, googleKey);
  } else if (ORS_API_KEY) {
    console.log('3d. Refinando tiempos con ORS (conducción real)…');
    await refineWithORS(routes);
  } else {
    console.log('3d. Tiempos estimados (sin API). Para mayor precisión añade Google API Key en Config.');
  }

  const schedule = assignDates(routes);
  const lastDay  = schedule[schedule.length - 1].date;
  console.log(`    → ${routes.length} días de visitas`);
  console.log(`    → Media: ${(geo.length / routes.length).toFixed(1)} clientes/día`);
  console.log(`    → Finalización: ${lastDay.toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`);

  // 4. Excel
  console.log('4️⃣  Generando Excel…');
  generateExcel(schedule);

  // 5. HTML
  console.log('5️⃣  Generando mapa interactivo HTML…');
  generateHTML(schedule);

  // 6. Guardar schedule JSON (para el módulo de notas)
  console.log('6️⃣  Guardando schedule para módulo de notas…');
  const scheduleData = {
    generado: new Date().toISOString(),
    totalClientes: geo.length,
    totalDias: schedule.length,
    dias: schedule.map((day, di) => ({
      fecha: day.date.toISOString().slice(0, 10),
      color: `hsl(${(di * 43) % 360},68%,42%)`,
      label: day.date.toLocaleDateString('es-ES', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
      }),
      totalMin: day.totalMin,
      clientes: computeTimes(day).map((c, i) => ({
        id:        c.id || '',
        nombre:    c['Nombre'],
        direccion: c['Dirección'],
        poblacion: c['Población'],
        cp:        String(c['Código postal'] || '').replace('.0', ''),
        lat:       c.lat,
        lon:       c.lon,
        llegada:   c.llegada,
        salida:    c.salida,
        travel:         c._travelMin,
        andando:        !!c._andando,
        returnToCarMin: c._returnToCarMin || 0,
        order:          i + 1
      }))
    }))
  };
  fs.writeFileSync(
    path.join(__dirname, 'planning_schedule.json'),
    JSON.stringify(scheduleData, null, 2),
    'utf-8'
  );
  console.log('   ✅ planning_schedule.json guardado');

  // Guardar en Supabase para acceso cloud
  try {
    const supaUrl = 'https://mwrkidkvjyrcuexxkhbv.supabase.co';
    const supaKey = CFG.supabaseServiceKey || CFG.supabaseAnonKey || '';
    if (supaKey) {
      console.log('7️⃣  Guardando en Supabase…');
      const headers = {
        'apikey': supaKey,
        'Authorization': `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      };
      await fetch(`${supaUrl}/rest/v1/planning_schedule?id=gte.0`, { method: 'DELETE', headers });
      const body = JSON.stringify({ schedule: scheduleData });
      const r = await fetch(`${supaUrl}/rest/v1/planning_schedule`, { method: 'POST', headers, body });
      if (r.ok) console.log('   ✅ Planning guardado en Supabase');
      else console.log('   ⚠️ Error Supabase:', r.status, await r.text());
    } else {
      console.log('7️⃣  Sin supabaseAnonKey en config.json — saltando Supabase');
    }
  } catch (eS) {
    console.log('   ⚠️ Error guardando en Supabase:', eS.message);
  }

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('✅  ¡Todo generado! Archivos en esta carpeta:');
  console.log('    📊  planning_visitas.xlsx');
  console.log('    🗺️   planning_mapa.html  ← ábrelo en el navegador');
  if (!ORS_API_KEY) {
    console.log('');
    console.log('💡  Para rutas más precisas en coche:');
    console.log('    node planning.js  TU_API_KEY_DE_ORS');
  }
  console.log('');
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
