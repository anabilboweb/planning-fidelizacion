// generar_informe.js — Informe técnico Planning BilboWeb
// Uso: node generar_informe.js

'use strict';
const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

const OUT = path.join(__dirname, 'informe_planning_bilboweb.pdf');

// ── Colores corporativos ──────────────────────────────────────
const C = {
  azul:      '#1A56DB',
  azulOscuro:'#1039A8',
  azulClaro: '#EBF2FF',
  gris:      '#475569',
  grisClaro: '#F1F5F9',
  grisBorde: '#CBD5E1',
  negro:     '#0F172A',
  blanco:    '#FFFFFF',
  verde:     '#059669',
  amarillo:  '#D97706',
  rojo:      '#DC2626',
};

// ── Helpers ───────────────────────────────────────────────────
function colorFromHex(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r, g, b];
}

function rgb(hex) { return colorFromHex(hex); }

// ── Documento ─────────────────────────────────────────────────
const doc = new PDFDocument({
  size:    'A4',
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  info: {
    Title:    'Informe Planning de Visitas Comerciales — BilboWeb',
    Author:   'BilboWeb',
    Subject:  'Sistema automático de planificación de visitas en Bizkaia',
    Keywords: 'planning, visitas, comercial, Bizkaia, rutas',
  },
  autoFirstPage: false,
});

doc.pipe(fs.createWriteStream(OUT));

// ═══════════════════════════════════════════════════════════════
// PÁGINA 1 — PORTADA
// ═══════════════════════════════════════════════════════════════
doc.addPage({ size: 'A4', margins: { top:0, bottom:0, left:0, right:0 } });

const W = doc.page.width;
const H = doc.page.height;

// Fondo superior
doc.rect(0, 0, W, 340).fill(C.azul);

// Franja inferior decorativa
doc.rect(0, 330, W, 18).fill(C.azulOscuro);

// Logo / nombre empresa (texto grande)
doc.fillColor(C.blanco)
   .font('Helvetica-Bold')
   .fontSize(36)
   .text('BilboWeb', 56, 80, { align: 'left' });

doc.fillColor('#93C5FD')
   .font('Helvetica')
   .fontSize(13)
   .text('Agencia de Marketing Digital · Barakaldo', 56, 122, { align: 'left' });

// Línea separadora
doc.rect(56, 145, 80, 3).fill('#93C5FD');

// Título del informe
doc.fillColor(C.blanco)
   .font('Helvetica-Bold')
   .fontSize(26)
   .text('Informe de Planning de', 56, 170, { align: 'left' })
   .text('Visitas Comerciales', 56, 202, { align: 'left' });

doc.fillColor('#BFDBFE')
   .font('Helvetica')
   .fontSize(14)
   .text('Sistema automático de rutas optimizadas', 56, 242, { align: 'left' })
   .text('para clientes en Bizkaia', 56, 262, { align: 'left' });

// Fecha y versión
doc.fillColor('#BFDBFE')
   .font('Helvetica')
   .fontSize(11)
   .text('Generado el 20 de mayo de 2026', 56, 300, { align: 'left' });

// ── Caja de métricas en portada ──────────────────────────────
const metricas = [
  { val: '276',  lbl: 'Clientes\nplanificados' },
  { val: '51',   lbl: 'Días\nde visitas' },
  { val: '5,4',  lbl: 'Visitas\nmedia/día' },
  { val: '~5h',  lbl: 'Máximo\npor jornada' },
];

const boxY   = 380;
const boxW   = (W - 112) / metricas.length;
metricas.forEach((m, i) => {
  const x = 56 + i * boxW;
  doc.rect(x, boxY, boxW - 10, 90).fill(C.grisClaro);
  doc.rect(x, boxY, boxW - 10, 4).fill(C.azul);
  doc.fillColor(C.azul)
     .font('Helvetica-Bold')
     .fontSize(28)
     .text(m.val, x, boxY + 18, { width: boxW - 10, align: 'center' });
  doc.fillColor(C.gris)
     .font('Helvetica')
     .fontSize(10)
     .text(m.lbl, x + 4, boxY + 56, { width: boxW - 18, align: 'center' });
});

// ── Resumen inferior ─────────────────────────────────────────
doc.fillColor(C.negro)
   .font('Helvetica-Bold')
   .fontSize(12)
   .text('Período de ejecución', 56, 500);

doc.fillColor(C.gris)
   .font('Helvetica')
   .fontSize(11)
   .text('20 de mayo de 2026  →  29 de julio de 2026', 56, 518);

doc.fillColor(C.negro)
   .font('Helvetica-Bold')
   .fontSize(12)
   .text('Base de operaciones', 56, 548);

doc.fillColor(C.gris)
   .font('Helvetica')
   .fontSize(11)
   .text('BilboWeb · Barakaldo, Bizkaia', 56, 566);

// ── Pie de portada ────────────────────────────────────────────
doc.rect(0, H - 44, W, 44).fill(C.grisClaro);
doc.fillColor(C.gris)
   .font('Helvetica')
   .fontSize(9)
   .text('Documento generado automáticamente por el sistema de planning BilboWeb · Uso interno',
         56, H - 26, { align: 'left' });
doc.fillColor(C.gris)
   .text('Página 1', 0, H - 26, { width: W - 56, align: 'right' });


// ═══════════════════════════════════════════════════════════════
// FUNCIÓN HELPER: cabecera de sección
// ═══════════════════════════════════════════════════════════════
let pageNum = 1;

function newPage() {
  pageNum++;
  doc.addPage({ size: 'A4', margins: { top:0, bottom:0, left:0, right:0 } });

  // Franja superior
  doc.rect(0, 0, W, 52).fill(C.azul);
  doc.fillColor(C.blanco)
     .font('Helvetica-Bold')
     .fontSize(11)
     .text('BilboWeb · Informe Planning de Visitas Comerciales', 56, 18, { align: 'left' });
  doc.fillColor('#93C5FD')
     .font('Helvetica')
     .fontSize(9)
     .text(`Página ${pageNum}`, 0, 22, { width: W - 20, align: 'right' });

  return 75; // Y de inicio de contenido
}

function seccion(y, titulo, numero) {
  doc.rect(56, y, 4, 22).fill(C.azul);
  doc.fillColor(C.negro)
     .font('Helvetica-Bold')
     .fontSize(15)
     .text(`${numero}. ${titulo}`, 68, y + 2);
  return y + 36;
}

function subseccion(y, titulo) {
  doc.fillColor(C.azul)
     .font('Helvetica-Bold')
     .fontSize(11)
     .text(titulo, 56, y);
  return y + 20;
}

function parrafo(y, texto, indent) {
  const x = 56 + (indent ? 16 : 0);
  const w = W - 112 - (indent ? 16 : 0);
  doc.fillColor(C.gris)
     .font('Helvetica')
     .fontSize(10.5)
     .text(texto, x, y, { width: w, align: 'justify', lineGap: 3 });
  return y + doc.heightOfString(texto, { width: w, lineGap: 3 }) + 10;
}

function bullet(y, items, indent) {
  const x = 56 + (indent ? 24 : 8);
  const tw = W - 112 - (indent ? 24 : 8) - 14;
  items.forEach(item => {
    doc.fillColor(C.azul).circle(x, y + 5.5, 3).fill();
    doc.fillColor(C.gris)
       .font('Helvetica')
       .fontSize(10.5)
       .text(item, x + 12, y, { width: tw, lineGap: 2 });
    y += doc.heightOfString(item, { width: tw, lineGap: 2 }) + 7;
  });
  return y + 4;
}

function tabla(y, filas, anchos) {
  const totalW = W - 112;
  const rowH   = 24;
  filas.forEach((fila, ri) => {
    const bg = ri === 0 ? C.azul : (ri % 2 === 0 ? C.grisClaro : C.blanco);
    doc.rect(56, y, totalW, rowH).fill(bg);
    doc.rect(56, y, totalW, rowH).stroke(C.grisBorde);
    let x = 56;
    fila.forEach((celda, ci) => {
      const cw = totalW * anchos[ci];
      doc.fillColor(ri === 0 ? C.blanco : C.negro)
         .font(ri === 0 ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(9.5)
         .text(celda, x + 6, y + 7, { width: cw - 12, lineBreak: false });
      doc.rect(x + cw, y, 0.5, rowH).fill(C.grisBorde);
      x += cw;
    });
    y += rowH;
  });
  return y + 12;
}

function cajaDest(y, icono, titulo, texto) {
  const h = 14 + doc.heightOfString(texto, { width: W - 160, lineGap: 2 }) + 16;
  doc.rect(56, y, W - 112, h).fill(C.azulClaro);
  doc.rect(56, y, 4, h).fill(C.azul);
  doc.fillColor(C.azul).font('Helvetica-Bold').fontSize(10.5)
     .text(`${icono}  ${titulo}`, 68, y + 10);
  doc.fillColor(C.gris).font('Helvetica').fontSize(10)
     .text(texto, 68, y + 25, { width: W - 160, lineGap: 2 });
  return y + h + 10;
}

function lineaSeparadora(y) {
  doc.rect(56, y, W - 112, 0.5).fill(C.grisBorde);
  return y + 16;
}

function piePagina() {
  doc.rect(0, H - 32, W, 32).fill(C.grisClaro);
  doc.fillColor(C.grisBorde).rect(0, H - 33, W, 0.5).fill();
  doc.fillColor(C.gris).font('Helvetica').fontSize(8)
     .text('BilboWeb · Informe interno · Confidencial', 56, H - 18);
}


// ═══════════════════════════════════════════════════════════════
// PÁGINA 2 — INTRODUCCIÓN + METODOLOGÍA
// ═══════════════════════════════════════════════════════════════
let y = newPage();

y = seccion(y, 'Introducción y Contexto', '1');

y = parrafo(y,
  'Este informe documenta el sistema de planificación automática de visitas comerciales ' +
  'desarrollado para BilboWeb. El objetivo es optimizar las rutas de visita presencial a los ' +
  '276 clientes activos en la provincia de Bizkaia, partiendo y regresando cada día desde las ' +
  'oficinas de BilboWeb en Barakaldo.');

y = parrafo(y,
  'El sistema combina geocodificación masiva de direcciones, agrupamiento geográfico por ' +
  'proximidad y optimización de rutas diarias respetando las restricciones horarias ' +
  'establecidas. El resultado es un planning completo en formato Excel y un mapa interactivo ' +
  'para facilitar su revisión y ejecución.');

y += 8;
y = lineaSeparadora(y);

y = seccion(y, 'Parámetros y Restricciones', '2');

y = subseccion(y, 'Punto de partida y llegada');
y = parrafo(y,
  'Cada jornada comienza y termina en las instalaciones de BilboWeb (Barakaldo, Bizkaia), ' +
  'coordenadas 43.2956°N, 2.9921°O. Todos los tiempos de desplazamiento incluyen el trayecto ' +
  'de ida desde la base y el de vuelta al finalizar el día.');

y = subseccion(y, 'Tiempo por visita');

y = tabla(y, [
  ['Concepto', 'Tiempo asignado', 'Total acumulado'],
  ['Reunión con el cliente', '30 minutos', '30 min'],
  ['Aparcamiento y acceso', '10 minutos', '40 min'],
  ['Tiempo total por cliente', '—', '40 minutos'],
], [0.45, 0.30, 0.25]);

y = subseccion(y, 'Límite horario diario');
y = parrafo(y,
  'La jornada máxima de trabajo en ruta es de 5 horas (300 minutos) por día, incluyendo ' +
  'todos los desplazamientos entre clientes y los trayectos de ida y vuelta a la base. ' +
  'Las jornadas comienzan a las 09:00 h.');

y = subseccion(y, 'Calendario laboral');
y = bullet(y, [
  'Días hábiles: lunes a viernes.',
  'Excluidos todos los festivos oficiales de Bizkaia para 2025 y 2026 (nacionales, autonómicos del País Vasco y Lunes de Pascua).',
  'Fecha de inicio del planning: 20 de mayo de 2026.',
]);

piePagina();


// ═══════════════════════════════════════════════════════════════
// PÁGINA 3 — PROCESO TÉCNICO
// ═══════════════════════════════════════════════════════════════
y = newPage();

y = seccion(y, 'Proceso Técnico', '3');

y = subseccion(y, '3.1 — Geocodificación de direcciones');
y = parrafo(y,
  'Las 276 direcciones del CSV se convirtieron en coordenadas geográficas (latitud / longitud) ' +
  'mediante la API Nominatim de OpenStreetMap. Este servicio es gratuito y no requiere registro; ' +
  'sin embargo, impone un límite de 1 petición por segundo, por lo que el proceso completo ' +
  'tardó aproximadamente 10 minutos.');

y = bullet(y, [
  'Estrategia en dos intentos: primero con la dirección completa (calle + CP + municipio), y si falla, solo con CP + municipio.',
  'Los resultados se almacenan en caché local (geocoding_cache.json) para no repetir peticiones en ejecuciones futuras.',
  'Tasa de éxito: 276/276 clientes geocodificados (100 %).',
]);

y = cajaDest(y, '📍', 'Calidad de la geocodificación',
  'Direcciones en polígonos industriales y zonas rurales sin numeración exacta se resuelven ' +
  'con precisión de CP + municipio, lo que introduce un error máximo de ~500 m. Esto es ' +
  'suficiente para la agrupación por zonas, pero en visitas reales se recomienda usar el GPS ' +
  'del móvil con la dirección completa.');

y = subseccion(y, '3.2 — Optimización de rutas (Nearest Neighbor)');
y = parrafo(y,
  'El algoritmo de optimización utiliza una heurística de vecino más cercano (Nearest Neighbor ' +
  'Greedy), que construye cada jornada de forma incremental:');

y = bullet(y, [
  'Se parte desde la base (BilboWeb, Barakaldo).',
  'En cada paso, se selecciona el cliente no visitado más cercano al punto actual.',
  'Antes de añadir un cliente, se verifica que el tiempo total del día (desplazamientos + visitas + vuelta a base) no supere las 5 h.',
  'Si ningún cliente cabe en la jornada, se cierra el día y se abre uno nuevo.',
]);

y = parrafo(y,
  'Este algoritmo no garantiza la solución matemáticamente óptima (NP-duro), pero produce ' +
  'rutas muy buenas en tiempo constante, con resultados típicamente dentro del 10-15 % del ' +
  'óptimo global. Para 276 clientes es la elección más práctica.');

piePagina();

// ═══════════════════════════════════════════════════════════════
// PÁGINA 3b — LIMITACIONES DE RUTA Y MEJORAS FUTURAS
// ═══════════════════════════════════════════════════════════════
y = newPage();

y = seccion(y, 'Limitaciones de Ruta: por qué se producen saltos', '3b');

y = parrafo(y,
  'Al revisar el planning en el mapa interactivo pueden observarse trayectos que aparentemente ' +
  '"saltan" entre municipios alejados en la misma jornada, por ejemplo pasando de Portugalete ' +
  'a Leioa en lugar de continuar por la margen izquierda. Esto no es un error: es una ' +
  'consecuencia conocida y predecible del algoritmo Nearest Neighbor. A continuación se ' +
  'explican las tres causas principales.');

y = lineaSeparadora(y);

// Causa 1
doc.rect(56, y, W-112, 100).fill(C.grisClaro);
doc.rect(56, y, 4, 100).fill(C.amarillo);
doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(10.5)
   .text('Causa 1 — El límite de 5 h "corta" la zona natural', 68, y + 10);
doc.fillColor(C.gris).font('Helvetica').fontSize(10)
   .text(
     'El algoritmo construye la jornada cliente a cliente. Cuando el tiempo restante del día ' +
     'ya no puede asumir al siguiente vecino geográfico (porque añadir desplazamiento + visita + ' +
     'vuelta a base superaría las 5 h), lo descarta aunque esté a 5 minutos. En su lugar ' +
     'selecciona el más cercano que SÍ cabe en el tiempo restante, aunque esté en otro municipio. ' +
     'Resultado: el último tramo del día puede parecer un salto cuando en realidad es la única ' +
     'opción que respeta la restricción horaria.',
     68, y + 28, { width: W - 148, lineGap: 2 });
y += 110;

// Causa 2
doc.rect(56, y, W-112, 88).fill(C.grisClaro);
doc.rect(56, y, 4, 88).fill(C.amarillo);
doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(10.5)
   .text('Causa 2 — Geocodificación aproximada en polígonos industriales', 68, y + 10);
doc.fillColor(C.gris).font('Helvetica').fontSize(10)
   .text(
     'Varios clientes del CSV tienen direcciones en polígonos industriales sin número exacto ' +
     '("Polígono Industrial Urbitarte, Pab. 6"). Nominatim los sitúa en el centroide del código ' +
     'postal, no en la nave real. Dos empresas del mismo polígono pueden quedar a coordenadas ' +
     'distintas de las reales, haciendo que el algoritmo sobrestime o subestime la distancia ' +
     'entre ellas y altere el orden de visita.',
     68, y + 28, { width: W - 148, lineGap: 2 });
y += 98;

// Causa 3
doc.rect(56, y, W-112, 88).fill(C.grisClaro);
doc.rect(56, y, 4, 88).fill(C.amarillo);
doc.fillColor(C.negro).font('Helvetica-Bold').fontSize(10.5)
   .text('Causa 3 — El vecino más cercano ahora no es el mejor para el conjunto', 68, y + 10);
doc.fillColor(C.gris).font('Helvetica').fontSize(10)
   .text(
     'El algoritmo es "miope": elige lo mejor en cada paso sin considerar las consecuencias ' +
     'globales. Puede ocurrir que seleccione un cliente en Leioa porque en ese momento está ' +
     '3 minutos más cerca que el siguiente de Sestao, pero esa decisión obliga a cruzar la ría ' +
     'dos veces innecesariamente. Un humano con el mapa delante haría toda la margen izquierda ' +
     'seguida; el algoritmo lo ve como dos problemas independientes.',
     68, y + 28, { width: W - 148, lineGap: 2 });
y += 100;

y = lineaSeparadora(y);

y = subseccion(y, 'Mejora propuesta: algoritmo 2-opt');

y = parrafo(y,
  'El algoritmo 2-opt es una mejora post-proceso que toma la ruta generada por Nearest ' +
  'Neighbor y la refina iterativamente. Su funcionamiento es sencillo: prueba a invertir ' +
  'cada par posible de segmentos de ruta y se queda con el cambio si reduce la distancia ' +
  'total. Repite hasta que ningún intercambio mejora el resultado.');

y = tabla(y, [
  ['', 'Nearest Neighbor (actual)', '+ 2-opt (mejora futura)'],
  ['Calidad de ruta', '~85-90 % del óptimo', '~95-98 % del óptimo'],
  ['Cruces en el mapa', 'Frecuentes', 'Eliminados o mínimos'],
  ['Saltos aparentes', 'Posibles', 'Muy reducidos'],
  ['Tiempo de cómputo', 'Instantáneo', '< 2 segundos para 276 clientes'],
  ['Complejidad de impl.', 'Ya implementado', '~50 líneas adicionales en planning.js'],
], [0.30, 0.35, 0.35]);

y = cajaDest(y, '💡', 'En la práctica',
  'Para una cartera de 276 clientes agrupados en Bizkaia, el 2-opt reduciría los kilómetros ' +
  'diarios un 10-20 % en los días con más saltos, y prácticamente nada en los días donde el ' +
  'Nearest Neighbor ya encontró una ruta compacta. Su implementación está prevista como ' +
  'mejora en la siguiente versión del script y no requiere cambios en los entregables ' +
  '(Excel y HTML se generarían igual, con rutas mejoradas).');

piePagina();

// ── retomar página de proceso: ORS
y = newPage();
y = seccion(y, 'Proceso Técnico (continuación)', '3');

y = subseccion(y, '3.4 — Refinado con OpenRouteService (ORS)');
y = parrafo(y,
  'Una vez construidas las rutas con distancias estimadas, el sistema realizó una segunda ' +
  'pasada usando la API Matrix de OpenRouteService para obtener tiempos reales de conducción ' +
  'por carretera para cada día:');

y = tabla(y, [
  ['', 'Haversine estimado', 'ORS real'],
  ['Método', 'Distancia recta × 1,40 / 45 km/h', 'API Matrix conducción'],
  ['Precisión', 'Media (±15 %)', 'Alta (datos OSM)'],
  ['Días aplicado', 'Fallback 5 días', '46 de 51 días'],
  ['Coste', 'Gratuito, sin límites', 'Gratuito (2000 req/día)'],
], [0.22, 0.40, 0.38]);

piePagina();


// ═══════════════════════════════════════════════════════════════
// PÁGINA 4 — ENTREGABLES
// ═══════════════════════════════════════════════════════════════
y = newPage();

y = seccion(y, 'Entregables Generados', '4');

y = subseccion(y, '4.1 — planning_visitas.xlsx');
y = parrafo(y,
  'Libro de Excel con una pestaña por semana ISO y una pestaña de resumen global. ' +
  'Cada fila de datos corresponde a una visita e incluye:');

y = tabla(y, [
  ['Columna', 'Contenido'],
  ['Día / Fecha', 'Nombre del día de la semana y fecha en formato dd/mm/aaaa'],
  ['Nº', 'Orden de visita dentro de la jornada (1, 2, 3…)'],
  ['Empresa', 'Razón social del cliente'],
  ['Dirección', 'Dirección postal completa'],
  ['Municipio / CP', 'Población y código postal'],
  ['Hora llegada', 'Hora estimada de llegada al cliente (HH:MM)'],
  ['Hora salida', 'Hora estimada de salida tras la reunión (HH:MM)'],
  ['Viaje al siguiente', 'Minutos estimados hasta el próximo cliente (o vuelta a base)'],
  ['Total día', 'Duración total de la jornada en horas'],
], [0.32, 0.68]);

y += 4;
y = cajaDest(y, '📊', 'Pestaña RESUMEN',
  'La primera hoja del Excel contiene un resumen por semana: número de días trabajados, ' +
  'total de visitas realizadas, media de clientes por día y fechas de inicio y fin. ' +
  'Útil para una visión ejecutiva del planning completo.');

y += 4;
y = subseccion(y, '4.2 — planning_mapa.html');
y = parrafo(y,
  'Archivo HTML autocontenido (76 KB) que funciona directamente en cualquier navegador ' +
  'moderno sin necesidad de servidor ni conexión a internet (salvo para cargar el mapa ' +
  'base de OpenStreetMap). Incluye:');

y = bullet(y, [
  'Mapa interactivo Leaflet.js centrado en Bizkaia con todos los clientes marcados.',
  'Panel lateral con el calendario completo del planning.',
  'Cada día tiene su propia ruta trazada en un color distinto.',
  'Buscador por nombre de empresa o municipio.',
  'Vista detallada por día con horarios de llegada y salida de cada visita.',
]);

piePagina();


// ═══════════════════════════════════════════════════════════════
// PÁGINA 5 — GUÍA DE USO DEL HTML
// ═══════════════════════════════════════════════════════════════
y = newPage();

y = seccion(y, 'Guía de Uso del Mapa Interactivo', '5');

y = parrafo(y,
  'El archivo planning_mapa.html es la herramienta principal para revisar y presentar el ' +
  'planning. No requiere instalación: haz doble clic sobre el archivo para abrirlo en ' +
  'el navegador (Chrome o Edge recomendados).');

y = subseccion(y, 'Vista general al abrir');
y = parrafo(y,
  'Al cargar el archivo verás dos zonas:');
y = bullet(y, [
  'Panel izquierdo: lista de todos los días del planning con las métricas de cada jornada.',
  'Panel derecho: mapa de Bizkaia con todos los clientes marcados con pequeños círculos numerados, cada día en un color diferente. El marcador azul con icono de edificio (🏢) indica la base de BilboWeb en Barakaldo.',
]);

y = subseccion(y, 'Explorar un día concreto');
y = bullet(y, [
  'Clic en la cabecera de cualquier día del panel izquierdo para expandirlo.',
  'El mapa enfocará automáticamente la zona con los clientes de ese día.',
  'La ruta del día seleccionado se resaltará en trazo grueso; el resto se atenuará.',
  'En el panel verás cada cliente con el orden de visita, la hora de llegada y la hora de salida.',
  'Los números en los círculos del mapa indican el orden de visita dentro de la jornada.',
]);

y = subseccion(y, 'Ver detalles de un cliente');
y = bullet(y, [
  'Clic en el nombre de un cliente en el panel → el mapa hace zoom al marcador y muestra un globo con nombre, dirección y horario.',
  'Clic directamente sobre un marcador del mapa → mismo efecto.',
]);

y = cajaDest(y, '🔍', 'Buscador',
  'El campo de búsqueda (parte superior del panel) filtra en tiempo real por nombre de empresa ' +
  'o municipio. Escribe "Bilbao" para ver solo los clientes de Bilbao, o el nombre parcial de ' +
  'una empresa para localizarla rápidamente. El mapa NO se filtra, solo el listado del panel.');

y = subseccion(y, 'Información de cada tarjeta de día');
y = tabla(y, [
  ['Elemento', 'Significado'],
  ['Cabecera de color', 'Identifica visualmente el día; el color coincide con los marcadores del mapa'],
  ['Badge "X visitas · Y,Yh"', 'Número de clientes a visitar y duración total de la jornada'],
  ['Icono 🚗 X min', 'Tiempo de desplazamiento desde el cliente anterior (o desde la base)'],
  ['Hora llegada (azul)', 'Hora de llegada estimada al cliente'],
  ['Hora salida (gris)', 'Hora de salida estimada (llegada + 40 min)'],
  ['↩ X min vuelta a base', 'Tiempo de regreso desde el último cliente hasta Barakaldo'],
], [0.35, 0.65]);

piePagina();


// ═══════════════════════════════════════════════════════════════
// PÁGINA 6 — RESULTADOS + RECOMENDACIONES
// ═══════════════════════════════════════════════════════════════
y = newPage();

y = seccion(y, 'Resultados del Planning', '6');

y = tabla(y, [
  ['Métrica', 'Valor'],
  ['Total clientes planificados', '276 de 276 (100 %)'],
  ['Días laborables necesarios', '51 días'],
  ['Semanas de trabajo', '~11 semanas'],
  ['Media de visitas por día', '5,4 clientes/día'],
  ['Jornada media estimada', '~4,2 horas/día (incluyendo desplazamientos)'],
  ['Fecha de inicio', 'Miércoles, 20 de mayo de 2026'],
  ['Fecha de finalización', 'Miércoles, 29 de julio de 2026'],
  ['Festivos excluidos', 'Sí — calendario oficial Bizkaia 2025-2026'],
  ['Tiempos ORS aplicados', '46 de 51 días (90 %)'],
  ['Días con estimación Haversine', '5 de 51 días (10 %) — por límite de tarifa gratuita ORS'],
], [0.55, 0.45]);

y += 8;
y = lineaSeparadora(y);

y = seccion(y, 'Recomendaciones de Uso', '7');

y = subseccion(y, 'Antes de cada jornada');
y = bullet(y, [
  'Consultar en el Excel o en el HTML la lista de clientes del día y sus horarios estimados.',
  'Verificar la dirección en Google Maps o el navegador GPS: la geocodificación tiene precisión de ~50-500 m según la zona.',
  'Contactar con los clientes con antelación para confirmar disponibilidad.',
]);

y = subseccion(y, 'Ajustes al planning');
y = bullet(y, [
  'Si un cliente cancela, puede reordenarse manualmente en el Excel para el día siguiente.',
  'Para regenerar el planning completo con cambios en el CSV, basta ejecutar: node planning.js [API_KEY_ORS]',
  'El caché de geocodificación se reutiliza automáticamente, por lo que una regeneración tarda solo 2-3 minutos.',
]);

y = cajaDest(y, '⚠️', 'Días con estimación Haversine (días 27, 28, 33, 35 y 36)',
  'Estos 5 días usan distancias estimadas en lugar de tiempos ORS reales. Los tiempos de ' +
  'desplazamiento pueden variar ±10-15 min respecto a la realidad. Se puede refinar ' +
  'relanzando el script al día siguiente, cuando el límite gratuito de ORS se restablece.');

y = subseccion(y, 'Mantenimiento del sistema');
y = bullet(y, [
  'El archivo geocoding_cache.json almacena las 276 geocodificaciones. No borrarlo.',
  'El archivo .env.ors contiene la API key de OpenRouteService. Tratarlo como dato sensible.',
  'Si se añaden nuevos clientes al CSV, el sistema geocodificará solo los nuevos (los existentes se leen del caché).',
]);

piePagina();


// ═══════════════════════════════════════════════════════════════
// PÁGINA 7 — RESUMEN TÉCNICO (STACK)
// ═══════════════════════════════════════════════════════════════
y = newPage();

y = seccion(y, 'Resumen Técnico del Sistema', '8');

y = parrafo(y,
  'A continuación se detallan las tecnologías y servicios utilizados en la construcción ' +
  'del sistema de planning:');

y = tabla(y, [
  ['Componente', 'Tecnología / Servicio', 'Notas'],
  ['Lenguaje', 'Node.js v24', 'Sin dependencias de Python'],
  ['Geocodificación', 'Nominatim (OSM)', 'Gratuito, sin API key, 1 req/s'],
  ['Caché geocoding', 'JSON local', '276 entradas, reutilizable'],
  ['Optimización rutas', 'Nearest Neighbor Greedy', 'Heurística, O(n²) tiempo'],
  ['Distancias base', 'Fórmula Haversine × 1,40', 'Factor de tortuosidad vial'],
  ['Tiempos reales', 'OpenRouteService Matrix API', 'Gratuito: 2000 req/día'],
  ['Generación Excel', 'SheetJS (xlsx npm)', 'Pestañas por semana ISO'],
  ['Mapa interactivo', 'Leaflet.js + OpenStreetMap', 'HTML autocontenido, sin servidor'],
  ['Ejecución', 'CLI: node planning.js [key]', 'Regenerable en 2-3 minutos'],
], [0.22, 0.38, 0.40]);

y += 8;
y = lineaSeparadora(y);

y = seccion(y, 'Archivos del Proyecto', '9');

y = tabla(y, [
  ['Archivo', 'Descripción'],
  ['fidelizacion_clean.csv', 'Datos de entrada: 276 clientes (Nombre, Dirección, Municipio, CP)'],
  ['planning.js', 'Script principal de generación del planning'],
  ['geocoding_cache.json', 'Caché de coordenadas geocodificadas (no borrar)'],
  ['.env.ors', 'API key de OpenRouteService (confidencial)'],
  ['planning_visitas.xlsx', 'Entregable: Excel con planning por semanas'],
  ['planning_mapa.html', 'Entregable: Mapa interactivo de rutas'],
  ['informe_planning_bilboweb.pdf', 'Este informe'],
  ['package.json', 'Dependencias Node.js (xlsx, node-fetch, pdfkit)'],
], [0.38, 0.62]);

y += 12;

// Firma final
doc.rect(56, y, W - 112, 0.5).fill(C.grisBorde);
y += 16;
doc.fillColor(C.gris).font('Helvetica').fontSize(9)
   .text(
     'Este documento ha sido generado automáticamente por el sistema de planning de BilboWeb. ' +
     'La información de rutas y horarios es orientativa y está sujeta a las condiciones reales ' +
     'de tráfico. Para uso interno exclusivamente.',
     56, y, { width: W - 112, align: 'center', lineGap: 2 }
   );

piePagina();


// ── Finalizar ─────────────────────────────────────────────────
doc.end();
console.log(`✅ Informe generado: ${OUT}`);
