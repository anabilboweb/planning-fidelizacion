'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { spawn } = require('child_process');
const db       = require('./db');

const app  = express();
const PORT = 3000;

app.use(express.json());
// Solo servir la carpeta public/ — nunca exponer el directorio raíz (config.json, .env, csv...)
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Helper: enviar página HTML sin caché (evita que el navegador sirva versiones antiguas)
function sendPage(res, filePath) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(filePath);
}

// ── Páginas principales ──────────────────────────────────────
app.get('/', (req, res) => {
  const f = path.join(__dirname, 'planning_mapa.html');
  fs.existsSync(f)
    ? sendPage(res, f)
    : res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>⚠️ Sin planning generado</h2>
        <p>Ve a <a href="/config">⚙️ Config</a> y pulsa "Regenerar Planning".</p>
      </body></html>`);
});

app.get('/notas', (req, res) => {
  sendPage(res, path.join(__dirname, 'public', 'notas.html'));
});

app.get('/config', (req, res) => {
  sendPage(res, path.join(__dirname, 'public', 'config.html'));
});

// Redirección del prototipo antiguo para no confundir
app.get('/demo_notas.html', (req, res) => {
  res.redirect('/notas');
});

// ── API: Notas ───────────────────────────────────────────────
app.get('/api/notas', (req, res) => {
  res.json(db.getAllNotas());
});

app.get('/api/notas/:id', (req, res) => {
  const nota = db.getNota(req.params.id);
  res.json(nota || {});
});

app.post('/api/notas/:id', (req, res) => {
  try {
    const data = {
      cliente_id:        req.params.id,
      estado:            req.body.estado            || 'pendiente',
      fecha_visita:      req.body.fecha_visita      || '',
      fecha_seguimiento: req.body.fecha_seguimiento || '',
      interlocutor:      req.body.interlocutor      || '',
      interes:           req.body.interes           || 0,
      dolor:             req.body.dolor             || '',
      servicios:         JSON.stringify(req.body.servicios || []),
      proximo_paso:      req.body.proximo_paso      || '',
      texto:             req.body.texto             || '',
    };
    const saved = db.upsertNota(data);
    res.json({ ok: true, nota: saved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/notas/:id', (req, res) => {
  db.deleteNota(req.params.id);
  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// ── API: Schedule ────────────────────────────────────────────
app.get('/api/schedule', (req, res) => {
  const f = path.join(__dirname, 'planning_schedule.json');
  if (!fs.existsSync(f)) return res.json({ dias: [], generado: null });
  res.json(JSON.parse(fs.readFileSync(f, 'utf-8')));
});

// ── API: Config ──────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const f = path.join(__dirname, 'config.json');
  res.json(JSON.parse(fs.readFileSync(f, 'utf-8')));
});

// ── API: Descargar Excel ─────────────────────────────────────
app.get('/api/download/excel', (req, res) => {
  const f = path.join(__dirname, 'planning_visitas.xlsx');
  if (!fs.existsSync(f)) {
    return res.status(404).json({ error: 'Excel no generado. Ve a Config y pulsa Regenerar Planning.' });
  }
  res.download(f, 'planning_BilboWeb.xlsx');
});

app.post('/api/config', (req, res) => {
  try {
    const f      = path.join(__dirname, 'config.json');
    const actual = JSON.parse(fs.readFileSync(f, 'utf-8'));
    const nuevo  = { ...actual, ...req.body };
    fs.writeFileSync(f, JSON.stringify(nuevo, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── API: Regenerar planning ──────────────────────────────────
let regenerando = false;

app.post('/api/planning/regenerar', (req, res) => {
  if (regenerando) return res.json({ ok: false, msg: 'Ya hay una regeneración en curso' });

  const orsKey = req.body.orsKey || '';
  const args   = orsKey ? [orsKey] : [];
  const proc   = spawn('node', ['planning.js', ...args], { cwd: __dirname });

  regenerando = true;
  const lineas = [];

  proc.stdout.on('data', d => lineas.push(d.toString()));
  proc.stderr.on('data', d => lineas.push('ERR: ' + d.toString()));

  proc.on('close', code => {
    regenerando = false;
    res.json({ ok: code === 0, salida: lineas.join(''), codigo: code });
  });

  setTimeout(() => {
    if (regenerando) { proc.kill(); regenerando = false; }
  }, 600000);
});

app.get('/api/planning/estado', (req, res) => {
  res.json({ regenerando });
});

// ── Arrancar ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🚀  Servidor BilboWeb Planning arrancado   ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Planning: http://localhost:${PORT}            ║`);
  console.log(`║   Notas:    http://localhost:${PORT}/notas      ║`);
  console.log(`║   Config:   http://localhost:${PORT}/config     ║`);
  console.log('║                                              ║');
  console.log('║   Ctrl + C para parar                        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
