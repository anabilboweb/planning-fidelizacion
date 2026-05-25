// servidor_regen.js — Servidor local para regenerar el planning desde la web
// Uso: node servidor_regen.js  (o doble clic en arrancar.bat)
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 2727;
let regenRunning = false;
let lastLog = '';
let lastStatus = 'idle'; // idle | running | done | error

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

http.createServer((req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ running: regenRunning, status: lastStatus, log: lastLog }));
    return;
  }

  if (req.url === '/regenerar' && req.method === 'POST') {
    if (regenRunning) {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: false, msg: 'Ya hay una regeneración en curso' }));
      return;
    }
    regenRunning = true;
    lastStatus = 'running';
    lastLog = '';
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, msg: 'Iniciando...' }));

    const proc = spawn('node', ['planning.js'], {
      cwd: path.join(__dirname),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc.stdout.on('data', d => { lastLog += d.toString(); process.stdout.write(d); });
    proc.stderr.on('data', d => { lastLog += d.toString(); process.stderr.write(d); });
    proc.on('close', code => {
      regenRunning = false;
      lastStatus = code === 0 ? 'done' : 'error';
      console.log(code === 0 ? '\n✅ Planning regenerado' : '\n❌ Error (código ' + code + ')');
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));

}).listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  BilboWeb · Servidor de regeneración     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('\n✅  Escuchando en http://127.0.0.1:' + PORT);
  console.log('   Mantén esta ventana abierta.');
  console.log('   Pulsa Ctrl+C para detener.\n');
});
