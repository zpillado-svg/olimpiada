/* ===================== Olimpiada de Economía · Apps Script =====================
   Recibe los resultados de la web, los guarda POR PREGUNTA en la pestaña REGISTRO,
   entrega las llaves de las sesiones y soluciones solo cuando toca, y calcula el PANEL.
   Instalación: ver la pestaña LEEME (la crea setup()).  ⚠ Este archivo contiene secretos: no lo compartas. */

var VERSION = '__VERSION__';
var MASTER_B64 = '__MASTER__';     // llave maestra (nunca sale de aquí)
var TOKEN = '__TOKEN__';           // token de la pantalla de profesora
var TZ = 'Europe/Madrid';
var H_REG = 'REGISTRO', H_INI = 'INICIOS', H_PANEL = 'PANEL', H_LEEME = 'LEEME';
var COLS = ['fecha_servidor', 'id_envio', 'alumno', 'origen', 'bloque', 'tipo', 'modo', 'n', 'tema', 'fuente',
  'elegida', 'respuesta', 'correcta', 'puntos', 'nota_bloque', 'supera_minimo', 'tiempo_s', 'exceso',
  'pista', 'autoeval', 'autoeval_max', 'intento', 'fecha_cliente', 'detalle'];
var C_ = {}; COLS.forEach(function (c, i) { C_[c] = i; });

/* ---------------- entrada web ---------------- */
function doGet() { return salida({ ok: true, version: VERSION, servicio: 'Olimpiada de Economía' }); }
function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return salida({ ok: false, error: 'json' }); }
  try { return salida(despachar(p)); }
  catch (err) { return salida({ ok: false, error: String(err && err.message ? err.message : err) }); }
}
function salida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function despachar(p) {
  var prof = !!(p.token && p.token === TOKEN);
  switch (p.accion) {
    case 'ping': return { ok: true, version: VERSION, filas: Math.max(0, hoja(H_REG).getLastRow() - 1), hoy: hoy() };
    case 'llave': return accionLlave(p, prof);
    case 'inicio': return conLock(function () { return accionInicio(p); });
    case 'enviar': return conLock(function () { return accionEnviar(p, prof); });
    case 'autoeval': return conLock(function () { return accionAutoeval(p, prof); });
    case 'evento': return conLock(function () { return accionEvento(p); });
    case 'purgar': if (!prof) throw new Error('no autorizado'); return conLock(function () { return accionPurgar(p.alumno); });
    case 'panel': if (!prof) throw new Error('no autorizado'); return { ok: true, filas: actualizarPanel() };
  }
  throw new Error('acción desconocida');
}

/* ---------------- utilidades ---------------- */
function libro() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { }
  if (!ss) ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'));
  return ss;
}
function hoja(n) { return libro().getSheetByName(n); }
function hoy() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function ahoraTxt() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function conLock(f) {
  var l = LockService.getScriptLock(); l.waitLock(25000);
  try { return f(); } finally { l.releaseLock(); }
}
function validarId(a) { if (!/^[A-Z0-9]{4}$/.test(String(a || ''))) throw new Error('identificador no válido'); return String(a); }
function utf8(s) { return Utilities.newBlob(String(s)).getBytes(); }
function concat() { var o = []; for (var i = 0; i < arguments.length; i++) o = o.concat(Array.prototype.slice.call(arguments[i])); return o; }
function u32(i) { return [(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255].map(function (b) { return (b << 24) >> 24; }); }

/* llave de una etiqueta: HMAC-SHA256(maestra, etiqueta) */
function derivar(label) { return Utilities.computeHmacSha256Signature(utf8(label), Utilities.base64Decode(MASTER_B64)); }
function llaveB64(label) { return Utilities.base64Encode(derivar(label)); }

/* descifra el paquete de claves que trae la web (HMAC-SHA256 en modo contador + etiqueta de integridad) */
function abrirPaquete(bloque, kb) {
  if (!kb || !kb.n || !kb.ct) throw new Error('falta el paquete de claves');
  var k = derivar('key|' + bloque);
  var n = Utilities.base64Decode(kb.n), ct = Utilities.base64Decode(kb.ct);
  var t = Utilities.base64Encode(Utilities.computeHmacSha256Signature(concat(utf8('tag'), n, ct), k));
  if (t !== kb.t) throw new Error('paquete de claves no válido');
  var out = [];
  for (var i = 0, blk = 0; i < ct.length; blk++) {
    var ks = Utilities.computeHmacSha256Signature(concat(utf8('ks'), n, u32(blk)), k);
    for (var j = 0; j < 32 && i < ct.length; j++, i++) out.push(((ct[i] ^ ks[j]) << 24) >> 24);
  }
  return JSON.parse(Utilities.newBlob(out).getDataAsString('UTF-8'));
}

/* ---------------- llaves ---------------- */
function inicioDe(alumno, bloque) {
  var h = hoja(H_INI), n = h.getLastRow();
  if (n < 2) return null;
  var v = h.getRange(2, 1, n - 1, 4).getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === alumno && v[i][1] === bloque) return Number(v[i][3]);
  return null;
}
function existeEnvio(alumno, bloque) {
  var h = hoja(H_REG), n = h.getLastRow();
  if (n < 2) return false;
  var v = h.getRange(2, C_.alumno + 1, n - 1, 3).getValues();   // alumno, origen, bloque
  for (var i = 0; i < v.length; i++) if (v[i][0] === alumno && v[i][2] === bloque) return true;
  return false;
}
/* etiqueta de soluciones: sol|bloque|modo|desde|minutos */
function liberarSol(label, alumno, bloque, prof, enviado) {
  if (!label) return null;
  var x = String(label).split('|');
  if (x[0] !== 'sol' || x.length !== 5 || x[1] !== bloque) return null;
  var modo = x[2], desde = x[3], min = Number(x[4]) || 0;
  if (prof) return llaveB64(label);
  if (modo === 'casa') return llaveB64(label);
  if (modo === 'diferida') return hoy() >= desde ? llaveB64(label) : null;
  if (modo === 'clase') {
    if (hoy() < desde) return null;
    var ini = alumno ? inicioDe(alumno, bloque) : null;
    if (ini) return Date.now() >= ini + min * 60000 - 20000 ? llaveB64(label) : null;
    return (enviado || (alumno && existeEnvio(alumno, bloque))) ? llaveB64(label) : null;
  }
  return null;
}
function accionLlave(p, prof) {
  var x = String(p.label || '').split('|');
  if (x[0] === 'open' && x.length === 3) {
    if (prof || hoy() >= x[2]) return { ok: true, llave: llaveB64(p.label) };
    return { ok: true, llave: null, motivo: 'fecha', desde: x[2] };
  }
  if (x[0] === 'sol') {
    var a = /^[A-Z0-9]{4}$/.test(String(p.alumno || '')) ? p.alumno : null;
    var k = liberarSol(p.label, a, p.bloque || x[1], prof, false);
    return k ? { ok: true, llave: k } : { ok: true, llave: null, motivo: x[2] === 'diferida' ? 'fecha' : 'tiempo', desde: x[3] };
  }
  throw new Error('etiqueta no válida');
}
function accionInicio(p) {
  var a = validarId(p.alumno);
  if (!p.bloque) throw new Error('falta bloque');
  var ya = inicioDe(a, p.bloque);
  if (ya) return { ok: true, inicio: ya };
  var t = Date.now();
  hoja(H_INI).appendRow([a, p.bloque, ahoraTxt(), t]);
  return { ok: true, inicio: t };
}

/* ---------------- registro ---------------- */
function leerRegistro() {
  var h = hoja(H_REG), n = h.getLastRow();
  if (n < 2) return [];
  return h.getRange(2, 1, n - 1, COLS.length).getValues();
}
function idsYIntentos(alumno, bloque) {
  var h = hoja(H_REG), n = h.getLastRow(), ids = {}, propios = {};
  if (n < 2) return { ids: ids, intentos: 0 };
  var v = h.getRange(2, C_.id_envio + 1, n - 1, 4).getValues();   // id_envio, alumno, origen, bloque
  for (var i = 0; i < v.length; i++) {
    ids[v[i][0]] = true;
    if (v[i][1] === alumno && v[i][3] === bloque) propios[v[i][0]] = true;
  }
  return { ids: ids, intentos: Object.keys(propios).length };
}
function fila(o) { var r = []; for (var i = 0; i < COLS.length; i++) r.push(o[COLS[i]] == null ? '' : o[COLS[i]]); return r; }
function escribir(filas) {
  if (!filas.length) return;
  var h = hoja(H_REG);
  h.getRange(h.getLastRow() + 1, 1, filas.length, COLS.length).setValues(filas);
}
function siNo(b) { return b === true ? 'sí' : b === false ? 'no' : '—'; }

function accionEnviar(p, prof) {
  var a = validarId(p.alumno);
  if (!p.bloque || !p.id_envio && p.modo !== 'papel') throw new Error('faltan datos');
  if (p.modo === 'papel' && !prof) throw new Error('no autorizado');
  var id = p.id_envio || Utilities.getUuid();
  var kb = abrirPaquete(p.bloque, p.kb);
  var info = idsYIntentos(a, p.bloque);
  var dup = !!info.ids[id];
  var base = { fecha_servidor: ahoraTxt(), id_envio: id, alumno: a, origen: p.origen || '', bloque: p.bloque,
    modo: p.modo || '', tiempo_s: p.tiempo_s == null ? '' : p.tiempo_s, intento: info.intentos + (dup ? 0 : 1),
    fecha_cliente: p.fecha_cliente || '' };
  var filas = [], res = { ok: true, duplicado: dup };
  var resp = p.respuestas || {};
  if (kb.tipo === 'test') {
    var r = OlimpCore.corregirTest(resp, kb, kb.punt);
    var tipo = 'test-' + (kb.formato || 'local');
    r.detalle.forEach(function (d) {
      filas.push(fila(merge(base, { tipo: tipo, n: d.n, tema: d.tema, fuente: d.fuente, elegida: d.elegida ? 'sí' : 'no',
        respuesta: d.respuesta || 'blanco', correcta: siNo(d.correcta), puntos: d.puntos, nota_bloque: r.nota,
        supera_minimo: siNo(r.supera), exceso: Number(p.exceso || 0), detalle: (r.anulada ? 'ANULADO (más de ' + kb.punt.max + ' respuestas)' : '') + (p.por_tiempo ? (r.anulada ? '; ' : '') + 'entregado al acabar el tiempo' : '') })));
    });
    res.nota = r.nota; res.aciertos = r.aciertos; res.fallos = r.fallos; res.blancos = r.blancos;
    res.supera = r.supera; res.anulada = r.anulada; res.minimo = r.minimo;
  } else if (kb.tipo === 'numerico') {
    var rn = OlimpCore.corregirNumerico(resp, kb);
    var pistas = p.pistas || {};
    rn.detalle.forEach(function (d) {
      var ap = kb.apartados.filter(function (x) { return x.id === d.id; })[0] || {};
      filas.push(fila(merge(base, { tipo: 'numerico', n: d.id, tema: ap.tema || kb.tema || '', fuente: kb.fuente || '',
        respuesta: d.respuesta === '' ? 'blanco' : String(d.respuesta).slice(0, 2000), correcta: d.tipo === 'texto' ? '—' : siNo(d.correcta),
        nota_bloque: rn.aciertos + '/' + rn.total, pista: pistas[d.id] ? 'sí' : 'no',
        detalle: d.tipo === 'texto' ? 'respuesta escrita' : (p.por_tiempo ? 'entregado al acabar el tiempo' : '') })));
    });
    res.aciertos = rn.aciertos; res.total = rn.total;
  } else {
    kb.preguntas.forEach(function (q) {
      var t = resp[q.n] || '';
      filas.push(fila(merge(base, { tipo: kb.tipo, n: q.n, tema: q.tema || kb.tema || '', fuente: q.fuente || kb.fuente || '',
        respuesta: t === '' ? 'blanco' : String(t).slice(0, 4000), correcta: '—', autoeval_max: q.puntos || '', detalle: 'respuesta escrita' })));
    });
  }
  if (!dup) escribir(filas);
  var k = liberarSol(p.label_sol, a, p.bloque, prof, true);
  if (k) res.llave = k;
  res.intento = base.intento;
  return res;
}
function merge(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

function accionAutoeval(p, prof) {
  var a = validarId(p.alumno);
  if (p.modo === 'papel' && !prof) throw new Error('no autorizado');
  var kb = abrirPaquete(p.bloque, p.kb);
  var info = idsYIntentos(a, p.bloque);
  if (p.id_envio && info.ids[p.id_envio]) return { ok: true, duplicado: true };
  var temaDe = {};
  (kb.preguntas || kb.apartados || []).forEach(function (q) { temaDe[q.n != null ? q.n : q.id] = q; });
  var filas = [];
  Object.keys(p.evals || {}).forEach(function (n) {
    var e = p.evals[n], q = temaDe[n] || {};
    filas.push(fila({ fecha_servidor: ahoraTxt(), id_envio: p.id_envio || Utilities.getUuid(), alumno: a, origen: p.origen || '', bloque: p.bloque,
      tipo: 'autoeval', modo: p.modo || '', n: n, tema: q.tema || kb.tema || '', fuente: q.fuente || kb.fuente || '',
      autoeval: e.puntos == null ? '' : e.puntos, autoeval_max: e.max == null ? '' : e.max, intento: p.intento || '',
      fecha_cliente: p.fecha_cliente || '', detalle: p.modo === 'papel' ? 'corrección de la profesora' : 'autoevaluación' + (p.ref ? ' de ' + p.ref : '') }));
  });
  escribir(filas);
  return { ok: true, filas: filas.length };
}
function accionEvento(p) {
  var a = validarId(p.alumno);
  var info = idsYIntentos(a, '');
  if (p.id_envio && info.ids[p.id_envio]) return { ok: true, duplicado: true };
  escribir([fila({ fecha_servidor: ahoraTxt(), id_envio: p.id_envio || Utilities.getUuid(), alumno: a, origen: p.origen || '',
    bloque: '', tipo: 'evento', n: p.evento || '', respuesta: p.valor || '', fecha_cliente: p.fecha_cliente || '' })]);
  return { ok: true };
}
function accionPurgar(alumno) {
  var a = validarId(alumno), borradas = 0;
  [H_REG, H_INI].forEach(function (nom) {
    var h = hoja(nom), n = h.getLastRow();
    if (n < 2) return;
    var cols = h.getLastColumn(), v = h.getRange(2, 1, n - 1, cols).getValues();
    var col = nom === H_REG ? C_.alumno : 0;
    var quedan = v.filter(function (r) { return r[col] !== a; });
    borradas += nom === H_REG ? v.length - quedan.length : 0;
    h.getRange(2, 1, n - 1, cols).clearContent();
    if (quedan.length) h.getRange(2, 1, quedan.length, cols).setValues(quedan);
  });
  actualizarPanel();
  return { ok: true, borradas: borradas };
}

/* ---------------- PANEL (se recalcula solo cada 5 minutos y al cambiar el filtro) ---------------- */
function actualizarPanel() {
  var ss = libro(), h = ss.getSheetByName(H_PANEL);
  var soloClase = h.getRange(2, 2).getValue() === true;
  var filas = leerRegistro();
  var R = filas.map(function (r) { var o = {}; COLS.forEach(function (c, i) { o[c] = r[i]; }); return o; });
  var tests = R.filter(function (o) { return String(o.tipo).indexOf('test-') === 0; });
  if (soloClase) tests = tests.filter(function (o) { return o.modo === 'clase' || o.modo === 'papel'; });

  /* primer intento de cada alumno en cada test */
  var envios = {};
  tests.forEach(function (o) {
    var k = o.alumno + '|' + o.bloque;
    var e = envios[k] = envios[k] || { alumno: o.alumno, origen: o.origen, bloque: o.bloque, porId: {}, ids: [] };
    if (!e.porId[o.id_envio]) { e.porId[o.id_envio] = []; e.ids.push({ id: o.id_envio, intento: Number(o.intento) || 99, fecha: String(o.fecha_servidor) }); }
    e.porId[o.id_envio].push(o);
  });
  var primeros = [];
  Object.keys(envios).forEach(function (k) {
    var e = envios[k];
    e.ids.sort(function (x, y) { return x.intento - y.intento || (x.fecha < y.fecha ? -1 : 1); });
    var f = e.porId[e.ids[0].id];
    primeros.push({ alumno: e.alumno, origen: e.origen, bloque: e.bloque, filas: f, intentos: e.ids.length });
  });

  /* b) alumno × tema */
  var at = {};
  primeros.forEach(function (p) {
    p.filas.forEach(function (o) {
      if (o.elegida !== 'sí' || !o.tema) return;
      var k = o.alumno + '|' + o.tema, x = at[k] = at[k] || { alumno: o.alumno, tema: o.tema, n: 0, ok: 0 };
      x.n++; if (o.correcta === 'sí') x.ok++;
    });
  });
  function etiqueta(x) {
    if (!x || !x.n) return 'sin datos';
    var pc = x.ok / x.n;
    if (pc >= 0.75 && x.n >= 4) return 'seguro';
    if (pc < 0.5) return 'de riesgo';
    return 'en progreso';
  }
  var seguros = {};
  Object.keys(at).forEach(function (k) { if (etiqueta(at[k]) === 'seguro') seguros[k] = true; });

  var out = [];
  var W = 11;
  function push(r) { while (r.length < W) r.push(''); out.push(r); }
  var cabeceras = [];
  push(['a) Por alumno y test (primer intento)']); cabeceras.push(out.length);
  push(['alumno', 'origen', 'bloque', 'modo', 'fecha', 'nota', '¿llega al mínimo?', 'falladas (mejor en blanco)', 'no elegidas de temas «seguros»', 'intentos', 'intentó pasarse del límite']); cabeceras.push(out.length);
  primeros.sort(function (x, y) { return x.alumno < y.alumno ? -1 : x.alumno > y.alumno ? 1 : (x.bloque < y.bloque ? -1 : 1); });
  primeros.forEach(function (p) {
    var f0 = p.filas[0];
    var mal = p.filas.filter(function (o) { return o.correcta === 'no'; }).map(function (o) { return o.n + ' (' + o.tema + ')'; });
    var noEl = p.filas.filter(function (o) { return o.elegida === 'no' && seguros[o.alumno + '|' + o.tema]; }).map(function (o) { return o.n + ' (' + o.tema + ')'; });
    push([p.alumno, p.origen, p.bloque, f0.modo, String(f0.fecha_servidor).slice(0, 10), f0.nota_bloque, f0.supera_minimo, mal.join(', '), noEl.join(', '), p.intentos, Number(f0.exceso) > 0 ? 'sí (' + f0.exceso + ')' : 'no']);
  });
  if (!primeros.length) push(['(sin datos todavía)']);
  push([]);
  push(['b) Por alumno y tema (acumulado, preguntas elegidas en el primer intento) · seguro: ≥ 75 % con al menos 4 respuestas · de riesgo: < 50 %']); cabeceras.push(out.length);
  push(['alumno', 'tema', 'respondidas', 'aciertos', '% acierto', 'etiqueta']); cabeceras.push(out.length);
  Object.keys(at).sort().forEach(function (k) { var x = at[k]; push([x.alumno, x.tema, x.n, x.ok, x.n ? Math.round(x.ok / x.n * 1000) / 10 : '', etiqueta(x)]); });
  if (!Object.keys(at).length) push(['(sin datos todavía)']);
  push([]);
  push(['c) Grupo · los 3 temas con peor acierto (mínimo 4 respuestas en total)']); cabeceras.push(out.length);
  push(['tema', 'respondidas', 'aciertos', '% acierto']); cabeceras.push(out.length);
  var gt = {};
  Object.keys(at).forEach(function (k) { var x = at[k], g = gt[x.tema] = gt[x.tema] || { tema: x.tema, n: 0, ok: 0 }; g.n += x.n; g.ok += x.ok; });
  var lista = Object.keys(gt).map(function (k) { return gt[k]; });
  var conMin = lista.filter(function (g) { return g.n >= 4; });
  (conMin.length ? conMin : lista).sort(function (x, y) { return x.ok / x.n - y.ok / y.n; }).slice(0, 3)
    .forEach(function (g) { push([g.tema, g.n, g.ok, Math.round(g.ok / g.n * 1000) / 10]); });
  if (!lista.length) push(['(sin datos todavía)']);
  push([]);
  push(['c) Grupo · sesiones marcadas como hechas (✓)']); cabeceras.push(out.length);
  var hechos = {}, alumnos = {}, sesiones = {};
  R.forEach(function (o) { if (o.alumno) alumnos[o.alumno] = true; });
  R.filter(function (o) { return o.tipo === 'evento' && o.n === 'hecho'; })
    .sort(function (x, y) { return String(x.fecha_servidor) < String(y.fecha_servidor) ? -1 : 1; })
    .forEach(function (o) { sesiones[o.origen] = true; hechos[o.alumno + '|' + o.origen] = o.respuesta === 'sí'; });
  var ses = Object.keys(sesiones).sort(), als = Object.keys(alumnos).sort();
  if (ses.length + 1 > W) W = ses.length + 1;
  push(['alumno'].concat(ses)); cabeceras.push(out.length);
  als.forEach(function (al) { push([al].concat(ses.map(function (s) { return hechos[al + '|' + s] ? '✓' : ''; }))); });
  out = out.map(function (r) { while (r.length < W) r.push(''); return r; });

  var desde = 4;
  var maxR = Math.max(h.getMaxRows(), desde + out.length + 5);
  if (h.getMaxRows() < maxR) h.insertRowsAfter(h.getMaxRows(), maxR - h.getMaxRows());
  if (h.getMaxColumns() < W) h.insertColumnsAfter(h.getMaxColumns(), W - h.getMaxColumns());
  h.getRange(desde, 1, h.getMaxRows() - desde + 1, h.getMaxColumns()).clearContent().setFontWeight('normal').setBackground(null);
  h.getRange(desde, 1, out.length, W).setValues(out);
  cabeceras.forEach(function (i) { h.getRange(desde + i - 1, 1, 1, W).setFontWeight('bold'); });
  h.getRange(1, 1).setValue('PANEL · actualizado ' + ahoraTxt() + ' · se recalcula solo cada 5 minutos');
  return filas.length;
}
function alEditar(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === H_PANEL && e.range.getA1Notation() === 'B2') actualizarPanel();
  } catch (err) { }
}

/* ---------------- instalación: ejecutar UNA VEZ desde el editor ---------------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);
  function crear(n) { return ss.getSheetByName(n) || ss.insertSheet(n); }
  var reg = crear(H_REG);
  reg.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#e7eef8');
  reg.setFrozenRows(1);
  var ini = crear(H_INI);
  ini.getRange(1, 1, 1, 4).setValues([['alumno', 'bloque', 'inicio', 'inicio_ms']]).setFontWeight('bold');
  ini.setFrozenRows(1);
  var pan = crear(H_PANEL);
  pan.getRange(1, 1).setValue('PANEL').setFontWeight('bold');
  pan.getRange(2, 1).setValue('Contar solo modo clase y papel →').setFontWeight('bold');
  pan.getRange(2, 2).insertCheckboxes();
  var lee = crear(H_LEEME);
  lee.getRange(1, 1, LEEME.length, 2).setValues(LEEME);
  lee.getRange(1, 1, 1, 2).setFontWeight('bold');
  lee.setColumnWidth(1, 160); lee.setColumnWidth(2, 720);
  var s1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('actualizarPanel').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('alEditar').forSpreadsheet(ss).onEdit().create();
  actualizarPanel();
  return 'Listo: pestañas creadas y PANEL programado cada 5 minutos.';
}

var LEEME = [
  ['columna', 'significado'],
  ['fecha_servidor', 'Cuándo llegó el envío (hora de Madrid).'],
  ['id_envio', 'Identificador único del envío: evita duplicados si un envío sin conexión se reintenta.'],
  ['alumno', 'Identificador de 4 caracteres (sin nombres; la correspondencia la guarda la profesora).'],
  ['origen', 'Sesión, test de filtro o simulacro (S01, TF00, SIM-L1…).'],
  ['bloque', 'Ejercicio dentro del origen (S01-test, S02-tarea…).'],
  ['tipo', 'test-local · test-nacional · test-libre · numerico · corta · comentario · autoeval · evento.'],
  ['modo', 'clase · casa · diferida · papel (introducido por la profesora).'],
  ['n', 'Nº de pregunta o id del apartado numérico; en eventos, el evento (hecho).'],
  ['tema', 'Código de tema de la matriz (M07, E05…).'],
  ['fuente', 'Fuente de la pregunta: L|N-año-parte-nº o PROPIA.'],
  ['elegida', 'Tests: sí si la respondió; no si la dejó en blanco (no elegida).'],
  ['respuesta', 'Letra marcada, «blanco», valor numérico escrito o texto de la respuesta.'],
  ['correcta', 'sí / no / — (en blanco o respuesta escrita).'],
  ['puntos', 'Puntos de esa pregunta con la penalización (0 si el test está anulado).'],
  ['nota_bloque', 'Nota del test completo; en numéricos, apartados correctos / total.'],
  ['supera_minimo', 'Local: sí si llega a 2,4 (o al mínimo del test); — si no hay mínimo.'],
  ['tiempo_s', 'Segundos empleados en el bloque.'],
  ['exceso', 'Veces que intentó marcar más respuestas de las permitidas (0 = nunca).'],
  ['pista', 'Numéricos: sí si abrió la pista de ese apartado.'],
  ['autoeval', 'Puntos que se pone el alumno (o la profesora, en papel) en respuestas escritas y comentario.'],
  ['autoeval_max', 'Puntos máximos de esa pregunta (1 si no tiene puntuación: bien = 1, a medias = 0,5, mal = 0).'],
  ['intento', 'Nº de intento del alumno en ese bloque (el PANEL usa el primero).'],
  ['fecha_cliente', 'Hora del dispositivo al enviar (útil para envíos que esperaron sin conexión).'],
  ['detalle', 'Avisos: test anulado, entregado al acabar el tiempo, autoevaluación…'],
  ['', ''],
  ['PANEL', 'Se recalcula solo cada 5 minutos y al marcar o desmarcar la casilla B2 (contar solo modo clase y papel).'],
  ['INICIOS', 'Hora de inicio de cada bloque en modo clase: el servidor usa esta hora para no dar las soluciones antes de que acabe el tiempo.']
];
