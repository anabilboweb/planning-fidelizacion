'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bilboweb_planning.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS notas (
    cliente_id        TEXT PRIMARY KEY,
    estado            TEXT DEFAULT 'pendiente',
    fecha_visita      TEXT DEFAULT '',
    fecha_seguimiento TEXT DEFAULT '',
    interlocutor      TEXT DEFAULT '',
    interes           INTEGER DEFAULT 0,
    dolor             TEXT DEFAULT '',
    servicios         TEXT DEFAULT '[]',
    proximo_paso      TEXT DEFAULT '',
    texto             TEXT DEFAULT '',
    actualizado_en    TEXT DEFAULT (datetime('now'))
  );
`);

const getNota     = db.prepare(`SELECT * FROM notas WHERE cliente_id = ?`);
const getAllNotas  = db.prepare(`SELECT * FROM notas`);
const upsertNota  = db.prepare(`
  INSERT INTO notas (cliente_id, estado, fecha_visita, fecha_seguimiento,
    interlocutor, interes, dolor, servicios, proximo_paso, texto, actualizado_en)
  VALUES (@cliente_id, @estado, @fecha_visita, @fecha_seguimiento,
    @interlocutor, @interes, @dolor, @servicios, @proximo_paso, @texto, datetime('now'))
  ON CONFLICT(cliente_id) DO UPDATE SET
    estado            = excluded.estado,
    fecha_visita      = excluded.fecha_visita,
    fecha_seguimiento = excluded.fecha_seguimiento,
    interlocutor      = excluded.interlocutor,
    interes           = excluded.interes,
    dolor             = excluded.dolor,
    servicios         = excluded.servicios,
    proximo_paso      = excluded.proximo_paso,
    texto             = excluded.texto,
    actualizado_en    = datetime('now')
`);
const deleteNota  = db.prepare(`DELETE FROM notas WHERE cliente_id = ?`);

const getStats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN estado = 'realizada'     THEN 1 ELSE 0 END) as realizadas,
    SUM(CASE WHEN estado = 'pospuesta'     THEN 1 ELSE 0 END) as pospuestas,
    SUM(CASE WHEN estado = 'no-interesado' THEN 1 ELSE 0 END) as no_interesados,
    SUM(CASE WHEN estado = 'pendiente'     THEN 1 ELSE 0 END) as pendientes
  FROM notas
`);

module.exports = {
  getNota:    (id)   => getNota.get(id),
  getAllNotas: ()     => getAllNotas.all(),
  upsertNota: (data) => { upsertNota.run(data); return getNota.get(data.cliente_id); },
  deleteNota: (id)   => deleteNota.run(id),
  getStats:   ()     => getStats.get(),
};
