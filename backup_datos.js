// ============================================================
// backup_datos.js — Backup y restauración antes/después de demos
//
// ANTES de la demo:    node backup_datos.js
// DESPUÉS de la demo:  node backup_datos.js --restore
// ============================================================

'use strict';
const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

// ── Configuración ──────────────────────────────────────────
const CFG_FILE   = path.join(__dirname, 'config.json');
const BACKUP_FILE = path.join(__dirname, 'datos_backup.json');

if (!fs.existsSync(CFG_FILE)) {
  console.error('❌ No se encuentra config.json');
  process.exit(1);
}

const CFG      = JSON.parse(fs.readFileSync(CFG_FILE, 'utf-8'));
const SUPA_URL = 'https://mwrkidkvjyrcuexxkhbv.supabase.co';
const SUPA_KEY = CFG.supabaseServiceKey;

if (!SUPA_KEY) {
  console.error('❌ supabaseServiceKey no encontrada en config.json');
  process.exit(1);
}

// ── Helper: llamada a Supabase REST ───────────────────────
async function supaGet(tabla, params = '') {
  const url = `${SUPA_URL}/rest/v1/${tabla}?select=*${params ? '&' + params : ''}`;
  const res = await fetch(url, {
    headers: {
      'apikey':        SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
    }
  });
  if (!res.ok) throw new Error(`GET ${tabla}: ${res.status} — ${await res.text()}`);
  return res.json();
}

async function supaDelete(tabla, filtro) {
  const url = `${SUPA_URL}/rest/v1/${tabla}?${filtro}`;
  const res = await fetch(url, {
    method:  'DELETE',
    headers: {
      'apikey':        SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer':        'return=minimal',
    }
  });
  if (!res.ok) throw new Error(`DELETE ${tabla}: ${res.status} — ${await res.text()}`);
}

async function supaInsert(tabla, filas) {
  if (!filas || filas.length === 0) return;
  const url = `${SUPA_URL}/rest/v1/${tabla}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'apikey':          SUPA_KEY,
      'Authorization':   `Bearer ${SUPA_KEY}`,
      'Content-Type':    'application/json',
      'Prefer':          'return=minimal',
    },
    body: JSON.stringify(filas),
  });
  if (!res.ok) throw new Error(`INSERT ${tabla}: ${res.status} — ${await res.text()}`);
}

// ── BACKUP ────────────────────────────────────────────────
async function hacerBackup() {
  console.log('\n📦  Haciendo backup antes de la demo...\n');

  const notas        = await supaGet('notas');
  const appConfig    = await supaGet('app_config');
  const planRows     = await supaGet('planning_schedule', 'order=id.desc&limit=1');
  const planMaxId    = planRows[0]?.id ?? 0;

  const backup = {
    fechaBackup:          new Date().toISOString(),
    planning_schedule_max_id: planMaxId,
    notas,
    app_config:           appConfig,
  };

  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2), 'utf-8');

  console.log(`   ✅ Notas guardadas:        ${notas.length} registros`);
  console.log(`   ✅ Configuración guardada: ${appConfig.length} entradas`);
  console.log(`   ✅ Planning max id:        ${planMaxId}`);
  console.log(`\n   📁 Archivo: datos_backup.json`);
  console.log('\n   ⚠️  Guarda este archivo en un sitio seguro (no se sube a GitHub).');
  console.log('   Ya puedes dejar el acceso a los jefes.\n');
  console.log('   Cuando terminen, ejecuta:  node backup_datos.js --restore\n');
}

// ── RESTAURAR ─────────────────────────────────────────────
async function restaurar() {
  console.log('\n🔄  Restaurando datos al estado anterior a la demo...\n');

  if (!fs.existsSync(BACKUP_FILE)) {
    console.error('❌ No se encuentra datos_backup.json.');
    console.error('   Necesitas haber ejecutado el backup antes de la demo.\n');
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
  const fecha  = new Date(backup.fechaBackup).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  console.log(`   Backup del: ${fecha}`);
  console.log(`   Notas en el backup: ${backup.notas.length}`);
  console.log('');

  // 1. NOTAS — borrar todas las actuales, reinsertar las del backup
  console.log('   🗑️  Borrando notas actuales...');
  try { await supaDelete('notas', 'cliente_id=gte.'); } catch(e) {
    // Si no hay filas el DELETE puede fallar — ignorar
    console.log('      (tabla notas ya estaba vacía)');
  }

  if (backup.notas.length > 0) {
    console.log(`   📝 Restaurando ${backup.notas.length} notas originales...`);
    // Insertar sin el campo 'id' para que Supabase asigne nuevos ids
    // (así no hay conflictos con la secuencia auto-increment)
    const notasSinId = backup.notas.map(({ id, ...resto }) => resto);
    await supaInsert('notas', notasSinId);
  } else {
    console.log('   ℹ️  No había notas en el backup — tabla queda vacía.');
  }

  // 2. APP_CONFIG — restaurar valores originales (upsert por clave)
  if (backup.app_config.length > 0) {
    console.log('   ⚙️  Restaurando configuración...');
    try { await supaDelete('app_config', 'id=gte.0'); } catch(e) {}
    const configSinId = backup.app_config.map(({ id, ...resto }) => resto);
    await supaInsert('app_config', configSinId);
  }

  // 3. PLANNING_SCHEDULE — borrar cualquier planning regenerado durante la demo
  const maxId = backup.planning_schedule_max_id;
  if (maxId > 0) {
    console.log(`   🗓️  Eliminando plannings creados durante la demo (id > ${maxId})...`);
    try { await supaDelete('planning_schedule', `id=gt.${maxId}`); } catch(e) {
      console.log('      (no había plannings nuevos que borrar)');
    }
  }

  // Borrar el archivo de backup
  fs.unlinkSync(BACKUP_FILE);

  console.log('\n   ✅ Todo restaurado correctamente.');
  console.log('   La app está como antes de la demo.\n');
  console.log('   El archivo datos_backup.json se ha borrado automáticamente.\n');
}

// ── MAIN ──────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--restore')) {
  restaurar().catch(err => {
    console.error('\n❌ Error durante la restauración:', err.message);
    process.exit(1);
  });
} else {
  hacerBackup().catch(err => {
    console.error('\n❌ Error durante el backup:', err.message);
    process.exit(1);
  });
}
