/* Olimpiada de Economía · núcleo compartido (web + Apps Script).
   Funciones puras: lectura de números, corrección de tests y de numéricos.
   Este mismo archivo se pega al principio del Apps Script: no usar APIs del navegador aquí. */
var OlimpCore = (function () {
  var PRESETS = {
    local:    { acierto: 0.4,  fallo: 0.1,      max: 10,   minimo: 2.4  },
    nacional: { acierto: 0.25, fallo: 0.25 / 3, max: null, minimo: null },
    libre:    { acierto: 1,    fallo: 0,        max: null, minimo: null }
  };

  function puntuacion(bloque) {
    var base = PRESETS[bloque.formato || 'local'] || PRESETS.local;
    var p = { acierto: base.acierto, fallo: base.fallo, max: base.max, minimo: base.minimo };
    if (bloque.acierto != null) p.acierto = bloque.acierto;
    if (bloque.fallo != null) p.fallo = bloque.fallo;
    if (bloque.max !== undefined) p.max = bloque.max;
    if (bloque.minimo !== undefined) p.minimo = bloque.minimo;
    return p;
  }

  function r(x, d) { var f = Math.pow(10, d == null ? 2 : d); return Math.round((x + 1e-12) * f) / f; }

  /* Lee un número escrito a la española: "15.120" = 15120 · "6.362,5" = 6362,5 · "2,5" = 2,5 · "1.5" = 1,5 */
  function leerNumero(txt) {
    if (txt == null) return null;
    var s = String(txt).trim().replace(/\s|€|%| /g, '').replace(/[−–]/g, '-');
    if (s === '' || s === '-') return null;
    if (s.indexOf(',') >= 0) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    var v = parseFloat(s);
    return isFinite(v) ? v : null;
  }

  /* Valor esperado tras aplicar el redondeo del apartado ("alza": unidades físicas, al entero superior). */
  function esperado(ap) {
    var v = Number(ap.valor);
    if (ap.redondeo === 'alza') return Math.ceil(v - 1e-9);
    return v;
  }

  /* ¿Es correcto el valor dado? Margen relativo (por defecto ±0,5 %) o absoluto si se indica. */
  function corregirNumero(dado, ap) {
    if (dado == null) return false;
    var e = esperado(ap);
    if (ap.redondeo === 'alza') return Math.abs(dado - e) < 1e-9;
    var tolAbs = ap.tolerancia_abs != null ? Number(ap.tolerancia_abs)
               : Math.abs(e) * (ap.tolerancia != null ? Number(ap.tolerancia) : 0.5) / 100;
    if (tolAbs < 0.005) tolAbs = 0.005;   /* nunca más estricto que los 2 decimales */
    return Math.abs(dado - e) <= tolAbs + 1e-12;
  }

  /* respuestas: { "1": "a", "2": "" ... }  secreto: { preguntas:[{n, clave, tema, fuente}] } */
  function corregirTest(respuestas, secreto, punt) {
    var det = [], ac = 0, fa = 0, bl = 0, resp = 0;
    secreto.preguntas.forEach(function (q) {
      var r0 = (respuestas && respuestas[q.n]) || '';
      if (r0) resp++;
    });
    var anulada = punt.max != null && resp > punt.max;
    secreto.preguntas.forEach(function (q) {
      var dada = (respuestas && respuestas[q.n]) || '';
      var claves = String(q.clave).split(/[ ,/]+/);   /* admite dos claves válidas: "b,c" */
      var ok = dada !== '' && claves.indexOf(dada) >= 0;
      var pts = dada === '' ? 0 : (ok ? punt.acierto : -punt.fallo);
      if (dada === '') bl++; else if (ok) ac++; else fa++;
      det.push({ n: q.n, tema: q.tema || '', fuente: q.fuente || '', elegida: dada !== '', respuesta: dada,
                 correcta: dada === '' ? null : ok, puntos: anulada ? 0 : r(pts, 4) });
    });
    var nota = anulada ? 0 : r(ac * punt.acierto - fa * punt.fallo, 3);
    return { nota: nota, aciertos: ac, fallos: fa, blancos: bl, respondidas: resp, anulada: anulada,
             supera: punt.minimo == null ? null : (!anulada && nota >= punt.minimo - 1e-9),
             minimo: punt.minimo, max: punt.max, detalle: det };
  }

  /* respuestas: { "a1": "15.120", ... }  secreto: { apartados:[{id, valor, tolerancia, redondeo, tipo}] } */
  function corregirNumerico(respuestas, secreto) {
    var det = [], ac = 0, tot = 0;
    secreto.apartados.forEach(function (ap) {
      if (ap.tipo === 'texto') {
        det.push({ id: ap.id, tipo: 'texto', respuesta: (respuestas && respuestas[ap.id]) || '', correcta: null });
        return;
      }
      tot++;
      var txt = (respuestas && respuestas[ap.id]) || '';
      var v = leerNumero(txt);
      var ok = corregirNumero(v, ap);
      if (ok) ac++;
      det.push({ id: ap.id, tema: ap.tema || '', respuesta: txt, valor: v, correcta: txt === '' ? null : ok });
    });
    return { aciertos: ac, total: tot, nota: tot ? r(ac / tot * 10, 2) : null, detalle: det };
  }

  /* Formato español con 2 decimales como máximo (sin ceros sobrantes). */
  function fmt(x, dec) {
    if (x == null || x === '') return '';
    var d = dec == null ? 2 : dec;
    var n = r(Number(x), d);
    var neg = n < 0; n = Math.abs(n);
    var ent = Math.floor(n), fr = r(n - ent, d);
    var fs = fr ? String(fr.toFixed(d)).slice(2).replace(/0+$/, '') : '';
    var es = String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : '') + es + (fs ? ',' + fs : '');
  }

  function hoyMadrid(date) {
    /* yyyy-mm-dd en Europe/Madrid (solo navegador/Node; el Apps Script usa Utilities.formatDate). */
    var d = date || new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (e) { return d.toISOString().slice(0, 10); }
  }

  return { PRESETS: PRESETS, puntuacion: puntuacion, leerNumero: leerNumero, esperado: esperado,
           corregirNumero: corregirNumero, corregirTest: corregirTest, corregirNumerico: corregirNumerico,
           fmt: fmt, r: r, hoyMadrid: hoyMadrid };
})();
if (typeof module !== 'undefined') module.exports = OlimpCore;
