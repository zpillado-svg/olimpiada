#!/usr/bin/env node
/* Construye la web a partir de los JSON fuente (que NO están en el repo) y los secretos.
   Uso: node tools/build.mjs --fuente <dir-fuente> --secretos <secretos.json> --out <dir-repo> [--codigo-gs <ruta Code.gs>]
   - Separa lo público (enunciados) de lo secreto (claves, explicaciones, soluciones).
   - Cifra las soluciones de modo clase/diferida y las sesiones con fecha de apertura (AES-GCM, llave derivada de la maestra).
   - Cifra cada página con StatiCrypt (código del grupo o de la profesora). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const Core = require(path.join(HERE, '..', 'assets', 'core.js'));

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? a.concat([[x.slice(2), arr[i + 1]]]) : a), []));
const FUENTE = args.fuente, OUT = args.out, SECRETOS = args.secretos;
if (!FUENTE || !OUT || !SECRETOS) { console.error('Faltan --fuente, --secretos o --out'); process.exit(1); }
const HOY = args.hoy || Core.hoyMadrid(new Date());

/* ---------- secretos ---------- */
function aleatorio(n, alfabeto) { const b = crypto.randomBytes(n); return Array.from(b, x => alfabeto[x % alfabeto.length]).join(''); }
let SEC;
if (fs.existsSync(SECRETOS)) SEC = JSON.parse(fs.readFileSync(SECRETOS, 'utf8'));
else {
  SEC = {
    grupo: aleatorio(8, 'abcdefghjkmnpqrstuvwxyz23456789'),
    profesora: aleatorio(20, 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'),
    master: crypto.randomBytes(32).toString('base64'),
    token: crypto.randomBytes(24).toString('base64url'),
    salt: crypto.randomBytes(16).toString('hex'),
    endpoint: '', hoja_url: '', repo: '', url_web: ''
  };
  fs.mkdirSync(path.dirname(SECRETOS), { recursive: true });
  fs.writeFileSync(SECRETOS, JSON.stringify(SEC, null, 2));
  console.log('Secretos nuevos generados en', SECRETOS);
}
const MASTER = Buffer.from(SEC.master, 'base64');

/* ---------- cifrado ---------- */
const derivar = label => crypto.createHmac('sha256', MASTER).update(label, 'utf8').digest();
function aes(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function hctr(key, obj) {   /* HMAC-SHA256 en modo contador + etiqueta: lo descifra el Apps Script */
  const n = crypto.randomBytes(16), pt = Buffer.from(JSON.stringify(obj), 'utf8'), ct = Buffer.alloc(pt.length);
  for (let i = 0, blk = 0; i < pt.length; blk++) {
    const c = Buffer.alloc(4); c.writeUInt32BE(blk);
    const ks = crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from('ks'), n, c])).digest();
    for (let j = 0; j < 32 && i < pt.length; j++, i++) ct[i] = pt[i] ^ ks[j];
  }
  const t = crypto.createHmac('sha256', key).update(Buffer.concat([Buffer.from('tag'), n, ct])).digest();
  return { n: n.toString('base64'), ct: ct.toString('base64'), t: t.toString('base64') };
}

/* ---------- validación ---------- */
const errores = [];
const idsBloque = new Set();
const APARTADOS = ['teoria', 'flash', 'nacional', 'problema', 'comentario', 'bateria', 'tarea'];
const reFuente = /^(PROPIA|[LN]-\d{4}-[A-Z]+(-\d+)?( → test)?)$/;
function exige(c, msg) { if (!c) errores.push(msg); }

/* ---------- transformación de bloques ---------- */
function transformar(b, page) {
  const donde = page.id + ' · ' + (b.id || b.tipo);
  if (['html', 'tarjeta'].includes(b.tipo)) return b;
  exige(b.id && /^[A-Za-z0-9-]+$/.test(b.id), donde + ': falta id o tiene caracteres raros');
  exige(!idsBloque.has(b.id), donde + ': id de bloque repetido');
  idsBloque.add(b.id);
  const modo = b.modo || 'casa';
  exige(['clase', 'casa', 'diferida'].includes(modo), donde + ': modo no válido');
  if (modo === 'diferida') exige(/^\d{4}-\d{2}-\d{2}$/.test(b.desde || ''), donde + ': modo diferida necesita "desde" (AAAA-MM-DD)');
  const pub = { tipo: b.tipo, id: b.id, modo, minutos: b.minutos || null, titulo_html: b.titulo_html, intro_html: b.intro_html,
    fuente: b.fuente, tema: b.tema };
  let kb, sol;
  if (b.tipo === 'test') {
    const punt = Core.puntuacion(b);
    pub.formato = b.formato || 'local'; pub.punt = punt;
    exige(['local', 'nacional', 'libre'].includes(pub.formato), donde + ': formato de test no válido');
    b.preguntas.forEach(q => {
      exige(q.opciones && q.opciones.length === 4, donde + ' p' + q.n + ': necesita 4 opciones');
      exige(/^[a-d]([ ,/]+[a-d])*$/.test(q.clave || ''), donde + ' p' + q.n + ': clave no válida');
      exige(reFuente.test(q.fuente || ''), donde + ' p' + q.n + ': fuente no válida (' + q.fuente + ')');
      exige(/^([ME]\d{2}|H[12]|COM|EST)$/.test(q.tema || ''), donde + ' p' + q.n + ': tema no válido (' + q.tema + ')');
    });
    pub.preguntas = b.preguntas.map(q => ({ n: q.n, fuente: q.fuente, tema: q.tema, meta: q.meta, enunciado_html: q.enunciado_html, opciones: q.opciones }));
    kb = { tipo: 'test', formato: pub.formato, punt, preguntas: b.preguntas.map(q => ({ n: q.n, clave: q.clave, tema: q.tema, fuente: q.fuente })) };
    sol = { preguntas: b.preguntas.map(q => ({ n: q.n, clave: q.clave, explicacion_html: q.explicacion_html || '', distractor_html: q.distractor_html || '' })) };
  } else if (b.tipo === 'numerico') {
    pub.enunciado_html = b.enunciado_html;
    b.apartados.forEach(a => {
      if (a.tipo !== 'texto') exige(typeof a.valor === 'number' && isFinite(a.valor), donde + ' ' + a.id + ': valor numérico no válido');
    });
    pub.apartados = b.apartados.map(a => ({ id: a.id, tipo: a.tipo, etiqueta: a.etiqueta, unidad: a.unidad, pista_html: a.pista_html, puntos: a.puntos }));
    kb = { tipo: 'numerico', tema: b.tema, fuente: b.fuente, apartados: b.apartados.map(a => ({ id: a.id, tipo: a.tipo, valor: a.valor, tolerancia: a.tolerancia, tolerancia_abs: a.tolerancia_abs, redondeo: a.redondeo, tema: a.tema || b.tema })) };
    sol = { apartados: b.apartados.map(a => ({ id: a.id, tipo: a.tipo, valor: a.valor, tolerancia: a.tolerancia, tolerancia_abs: a.tolerancia_abs, redondeo: a.redondeo, modelo_html: a.modelo_html })), solucion_html: b.solucion_html || '' };
  } else if (b.tipo === 'corta' || b.tipo === 'comentario') {
    pub.texto_html = b.texto_html;
    pub.preguntas = b.preguntas.map(q => ({ n: q.n, fuente: q.fuente, tema: q.tema, puntos: q.puntos, enunciado_html: q.enunciado_html }));
    if (b.tipo === 'comentario') {
      const tot = b.preguntas.reduce((s, q) => s + (q.puntos || 0), 0);
      exige(Math.abs(tot - 2) < 1e-9, donde + ': las preguntas del comentario deben sumar 2 puntos (suman ' + tot + ')');
    }
    kb = { tipo: b.tipo, tema: b.tema, fuente: b.fuente, preguntas: b.preguntas.map(q => ({ n: q.n, tema: q.tema || b.tema, fuente: q.fuente || b.fuente, puntos: q.puntos })) };
    sol = { preguntas: b.preguntas.map(q => ({ n: q.n, modelo_html: q.modelo_html || '', criterios_html: q.criterios_html || '' })), rubrica_html: b.rubrica_html || '' };
  } else { errores.push(donde + ': tipo de bloque desconocido ' + b.tipo); return b; }
  pub.kb = hctr(derivar('key|' + b.id), kb);
  if (modo === 'casa') pub.secreto = sol;
  else {
    const desde = modo === 'clase' ? (b.desde || page.fecha) : b.desde;
    pub.desde = desde;
    pub.label_sol = ['sol', b.id, modo, desde, b.minutos || 0].join('|');
    pub.sol = aes(derivar(pub.label_sol), sol);
  }
  return pub;
}

/* ---------- lectura de fuentes ---------- */
const leer = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const listar = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => leer(path.join(d, f))) : [];
const catalogo = leer(path.join(FUENTE, 'catalogo.json'));
const sesiones = listar(path.join(FUENTE, 'sesiones'));
const tests = listar(path.join(FUENTE, 'tests'));
const simulacros = listar(path.join(FUENTE, 'simulacros'));
const paginas = [...sesiones.map(p => ({ ...p, carpeta: 's' })), ...tests.map(p => ({ ...p, carpeta: 't' })), ...simulacros.map(p => ({ ...p, carpeta: 'x' }))];
paginas.forEach(p => {
  exige(/^[A-Z0-9-]+$/.test(p.id), 'id de página no válido: ' + p.id);
  exige(/^\d{4}-\d{2}-\d{2}$/.test(p.fecha || ''), p.id + ': falta fecha');
  (p.apartados || []).forEach(a => exige(APARTADOS.includes(a.id), p.id + ': apartado no válido ' + a.id));
  p.url = p.carpeta + '/' + p.id + '.html';
});

/* ---------- salida ---------- */
const TMP = fs.mkdtempSync('/tmp/olimp-build-');
const version = crypto.createHash('sha1').update(['core.js', 'engine.js', 'style.css'].map(f => fs.readFileSync(path.join(HERE, '..', 'assets', f), 'utf8')).join('') + HOY).digest('hex').slice(0, 10);
const config = base => ({ endpoint: SEC.endpoint || '', version, base });
const conMates = s => /\\\(|\\\[/.test(s);

function html({ titulo, datos, base }) {
  const json = JSON.stringify(datos).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));
  const katex = conMates(json) ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>` : '';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<link rel="stylesheet" href="${base}assets/style.css?v=${version}">
${katex}
</head><body>
<script type="application/json" id="olimp-data">${json}</script>
<script src="${base}assets/core.js?v=${version}"></script>
<script src="${base}assets/engine.js?v=${version}"></script>
</body></html>`;
}
function escribirTmp(grupo, rel, contenido) {
  const f = path.join(TMP, grupo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenido);
}

/* páginas de contenido */
const ordenSes = paginas.filter(p => p.tipo === 'sesion').sort((a, b) => a.fecha < b.fecha ? -1 : 1);
const bloquesProfe = [];
const resumen = {};
paginas.forEach(p => {
  const contenido = {
    cabecera_html: p.cabecera_html || `<header class="cover"><h1>${p.titulo}</h1></header>`,
    apartados: p.apartados.map(a => ({ id: a.id, bloques: a.bloques.map(b => {
      const t = transformar(b, p);
      if (['test', 'numerico', 'corta', 'comentario'].includes(b.tipo)) {
        const desc = (b.fuente ? '[' + b.fuente + '] ' : '') + (b.tipo === 'test' ? b.preguntas.length + ' preguntas' : b.tipo === 'numerico' ? 'problema numérico' : b.tipo === 'comentario' ? 'comentario' : 'respuesta escrita') + ' · ' + (t.modo || '');
        bloquesProfe.push({ origen: p.id, origen_titulo: p.titulo, id: b.id, tipo: b.tipo, formato: t.formato, punt: t.punt, descripcion: desc,
          preguntas: t.preguntas && t.preguntas.map(q => ({ n: q.n, tema: q.tema, fuente: q.fuente, puntos: q.puntos })),
          apartados: t.apartados && t.apartados.map(a => ({ id: a.id, tipo: a.tipo, etiqueta: a.etiqueta, unidad: a.unidad })),
          kb: t.kb, label_sol: t.label_sol });
      }
      return t;
    }) }))
  };
  const meta = { id: p.id, tipo: p.tipo, numero: p.numero, fecha: p.fecha, titulo: p.titulo, tramo: p.tramo, temas: p.temas };
  const datos = { pagina: 'sesion', config: config('../'), meta };
  if (p.tipo === 'sesion') {
    const i = ordenSes.findIndex(x => x.id === p.id);
    const n = x => x && { url: x.url, titulo: 'Sesión ' + x.numero };
    datos.nav = { prev: n(ordenSes[i - 1]), next: n(ordenSes[i + 1]) };
  }
  if (p.abrir && p.abrir > HOY) {
    const label = ['open', p.id, p.abrir].join('|');
    datos.cerrado = { abrir: p.abrir, label, blob: aes(derivar(label), contenido) };
  } else datos.contenido = contenido;
  const grupo = p.acceso === 'profesora' ? 'profe' : 'grupo';
  escribirTmp(grupo, p.url, html({ titulo: (p.numero ? 'Sesión ' + p.numero + ' · ' : '') + p.titulo, datos, base: '../' }));
  resumen[p.id] = { url: p.url, apartados: p.apartados.map(a => a.id).sort((a, b) => APARTADOS.indexOf(a) - APARTADOS.indexOf(b)), abrir: p.abrir || null };
});

/* portada */
const cal = catalogo.calendario.map(it => ({ ...it, ...(it.id && resumen[it.id] ? resumen[it.id] : {}) }));
const tlist = tests.map(t => ({ id: t.id, tipo: 'test', fecha: t.fecha, titulo: t.titulo, ...resumen[t.id] }));
escribirTmp('grupo', 'index.html', html({ titulo: catalogo.titulo + ' ' + catalogo.curso, base: '',
  datos: { pagina: 'portada', config: config(''), titulo: catalogo.titulo, curso: catalogo.curso, tramos: catalogo.tramos, calendario: cal, tests: tlist } }));

/* pantalla de profesora */
escribirTmp('profe', 'profe.html', html({ titulo: 'Profesora · Olimpiada de Economía', base: '',
  datos: { pagina: 'profe', config: config(''), token: SEC.token, hoja_url: SEC.hoja_url || '', bloques: bloquesProfe } }));

if (errores.length) { console.error('ERRORES:\n - ' + errores.join('\n - ')); process.exit(2); }

/* ---------- StatiCrypt ---------- */
const SC_DIR = path.join(HERE, 'node_modules', 'staticrypt');
const tplBase = fs.readFileSync(path.join(SC_DIR, 'lib', 'password_template.html'), 'utf8')
  .replace('<input id="staticrypt-remember" type="checkbox" name="remember" />', '<input id="staticrypt-remember" type="checkbox" name="remember" checked />')
  .replace('<html class="staticrypt-html">', '<html class="staticrypt-html" lang="es">');
const tplGrupo = path.join(TMP, 'tpl-grupo.html'), tplProfe = path.join(TMP, 'tpl-profe.html');
fs.writeFileSync(tplGrupo, tplBase.replace('"staticrypt_expiration"', '"olimp_grupo_exp"').replace('"staticrypt_passphrase"', '"olimp_grupo_pass"'));
fs.writeFileSync(tplProfe, tplBase.replace('"staticrypt_expiration"', '"olimp_profe_exp"').replace('"staticrypt_passphrase"', '"olimp_profe_pass"'));
const scBin = path.join(SC_DIR, 'cli', 'index.js');
function cifrar(grupo, pass, tpl, instrucciones) {
  const dir = path.join(TMP, grupo);
  if (!fs.existsSync(dir)) return;
  execFileSync(process.execPath, [scBin, dir, '-r', '-d', path.join(TMP, 'enc-' + grupo), '-p', pass, '--short', '--remember', '0',
    '--salt', SEC.salt, '-c', 'false', '-t', tpl,
    '--template-title', 'Olimpiada de Economía', '--template-instructions', instrucciones,
    '--template-button', 'ENTRAR', '--template-placeholder', 'Código', '--template-remember', 'Recordar en este dispositivo',
    '--template-error', 'Código incorrecto', '--template-color-primary', '#1f4e8c', '--template-color-secondary', '#e7eef8',
    '--template-toggle-show', 'Mostrar código', '--template-toggle-hide', 'Ocultar código'], { stdio: 'pipe' });
}
cifrar('grupo', SEC.grupo, tplGrupo, 'Escribe el código del grupo.');
cifrar('profe', SEC.profesora, tplProfe, 'Pantalla de profesora: escribe tu código.');

/* copiar al repo: limpiar páginas generadas antes */
for (const d of ['s', 't', 'x']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
function copiarArbol(src, dst) {
  if (!fs.existsSync(src)) return;
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, f.name), b = path.join(dst, f.name);
    if (f.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copiarArbol(a, b); } else fs.copyFileSync(a, b);
  }
}
// staticrypt -r -d X dir  → X/<nombre de dir>/...
const encG = path.join(TMP, 'enc-grupo'), encP = path.join(TMP, 'enc-profe');
const raiz = d => { const sub = path.join(d, path.basename(d).replace('enc-', '')); return fs.existsSync(sub) ? sub : d; };
copiarArbol(raiz(encG), OUT);
copiarArbol(raiz(encP), OUT);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

/* Apps Script con los secretos (solo en la carpeta privada) */
if (args['codigo-gs']) {
  const core = fs.readFileSync(path.join(HERE, '..', 'assets', 'core.js'), 'utf8').replace(/if \(typeof module[^\n]*\n?/, '');
  const srv = fs.readFileSync(path.join(HERE, 'server.gs'), 'utf8').replace('__VERSION__', version).replace('__MASTER__', SEC.master).replace('__TOKEN__', SEC.token);
  fs.mkdirSync(path.dirname(args['codigo-gs']), { recursive: true });
  fs.writeFileSync(args['codigo-gs'], srv + '\n\n/* ===== núcleo compartido con la web (no tocar) ===== */\n' + core);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`OK · versión ${version} · ${paginas.length} páginas · ${bloquesProfe.length} bloques interactivos · hoy ${HOY}`);
