/* Olimpiada de Economía · motor común.
   Cada página trae sus datos en <script type="application/json" id="olimp-data">.
   Este archivo no contiene contenido ni soluciones: solo dibuja y corrige. */
(function () {
  'use strict';
  var C = window.OlimpCore;
  var D = JSON.parse(document.getElementById('olimp-data').textContent);
  var CFG = D.config || {};
  var APART = {
    teoria: 'Teoría', flash: 'Test flash', nacional: 'Carril nacional', problema: 'Problema',
    comentario: 'Comentario', bateria: 'Batería extra', tarea: 'Tarea'
  };
  var ORDEN = ['teoria', 'flash', 'nacional', 'problema', 'comentario', 'bateria', 'tarea'];
  var MODOS = { clase: 'Modo clase', casa: 'Modo casa', diferida: 'Corrección diferida', papel: 'Papel' };
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /* ---------------- utilidades ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (k) { if (k != null) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var S = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function fechaLarga(iso) {
    var p = iso.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return DIAS[d.getDay()] + ' ' + p[2] + ' de ' + MESES[p[1] - 1];
  }
  function fechaCorta(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function hoy() { return C.hoyMadrid(new Date()); }
  function tag(fuente) {
    if (!fuente) return '';
    var own = fuente === 'PROPIA';
    return '<span class="tag ' + (own ? 'own' : 'code') + '">[' + esc(fuente) + ']</span>';
  }
  function temaTag(t) { return t ? '<span class="tag tema" title="Código de tema de la matriz">' + esc(t) + '</span>' : ''; }
  function mates(root) {
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(root || document.body, {
          delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
          throwOnError: false
        });
      } catch (e) { }
    }
  }
  function ptsTxt(x) { return C.fmt(x, 3); }

  /* ---------------- tema claro / oscuro ---------------- */
  (function () {
    var t = S.get('olimp_tema', null);
    if (t) document.documentElement.setAttribute('data-theme', t);
  })();
  function alternarTema() {
    var r = document.documentElement, t = r.getAttribute('data-theme');
    var oscuro = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var n = oscuro ? 'light' : 'dark';
    r.setAttribute('data-theme', n); S.set('olimp_tema', n);
  }

  /* ---------------- identificador del alumno ---------------- */
  function alumno() { return S.get('olimp_id', null); }
  function pedirId(cb, cambiar) {
    var fondo = el('div', { class: 'modal-fondo' });
    var inp = el('input', { type: 'text', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Identificador', placeholder: 'ABCD', value: cambiar ? (alumno() || '') : '' });
    var err = el('p', { class: 'small err-txt' });
    function ok() {
      var v = inp.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(v)) { err.textContent = 'Son 4 caracteres: letras o números (sin tildes ni espacios).'; inp.focus(); return; }
      S.set('olimp_id', v); fondo.remove(); cb && cb(v);
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
    var caja = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { text: cambiar ? 'Cambiar identificador' : 'Tu identificador' }),
      el('p', { html: 'Escribe el código de <b>4 caracteres</b> que te ha dado tu profesora. Se guarda en este navegador y se usa para registrar tus resultados (sin nombres).' }),
      inp, err,
      el('div', { class: 'fila-botones' }, [
        cambiar ? el('button', { class: 'btn sec', text: 'Cancelar', onclick: function () { fondo.remove(); } }) : null,
        el('button', { class: 'btn', text: 'Guardar', onclick: ok })])
    ]);
    fondo.appendChild(caja); document.body.appendChild(fondo); setTimeout(function () { inp.focus(); }, 30);
  }

  /* ---------------- servidor (Apps Script) y cola sin conexión ---------------- */
  var token = S.get('olimp_token', null);
  function api(payload) {
    if (!CFG.endpoint) return Promise.reject(new Error('sin-endpoint'));
    if (token && !payload.token) payload.token = token;
    return fetch(CFG.endpoint, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) { if (!j || j.ok === false && j.error) throw new Error(j.error || 'error'); return j; });
  }
  var Cola = {
    leer: function () { return S.get('olimp_cola', []); },
    poner: function (p) { var c = Cola.leer(); if (!c.some(function (x) { return x.id_envio === p.id_envio; })) c.push(p); S.set('olimp_cola', c); Cola.pintar(); },
    quitar: function (id) { S.set('olimp_cola', Cola.leer().filter(function (x) { return x.id_envio !== id; })); Cola.pintar(); },
    enviando: false,
    vaciar: function () {
      if (Cola.enviando) return Promise.resolve();
      var c = Cola.leer(); if (!c.length || !CFG.endpoint) { Cola.pintar(); return Promise.resolve(); }
      Cola.enviando = true;
      var i = 0;
      function sig() {
        if (i >= c.length) { Cola.enviando = false; Cola.pintar(); return Promise.resolve(); }
        var p = c[i++];
        return api(p).then(function (res) {
          Cola.quitar(p.id_envio);
          if (p.bloque) S.set('olimp_res_' + p.id_envio, res);
          if (res && res.llave && p.label_sol) S.set('olimp_llave_' + p.label_sol, res.llave);
          document.dispatchEvent(new CustomEvent('olimp-respuesta', { detail: { payload: p, res: res } }));
          return sig();
        }, function () { Cola.enviando = false; Cola.pintar(); });
      }
      return sig();
    },
    pintar: function () {
      var n = Cola.leer().length, b = $('#cola-estado');
      if (!b) return;
      b.textContent = n ? (n === 1 ? '1 envío pendiente' : n + ' envíos pendientes') : '';
      b.title = n ? 'Se enviarán solos cuando haya conexión' : '';
      b.style.display = n ? '' : 'none';
    }
  };
  function enviar(p) {
    p.id_envio = p.id_envio || uuid();
    p.alumno = p.alumno || alumno();
    p.fecha_cliente = new Date().toISOString();
    p.version = CFG.version;
    Cola.poner(p);
    return Cola.vaciar().then(function () { return S.get('olimp_res_' + p.id_envio, null); });
  }
  window.addEventListener('online', function () { Cola.vaciar(); });
  setInterval(function () { if (Cola.leer().length) Cola.vaciar(); }, 45000);

  /* llaves: el servidor solo las entrega cuando toca (fecha, fin del tiempo…) */
  function llave(label, extra) {
    var k = S.get('olimp_llave_' + label, null);
    if (k) return Promise.resolve(k);
    var p = { accion: 'llave', label: label, alumno: alumno() };
    if (extra) Object.keys(extra).forEach(function (x) { p[x] = extra[x]; });
    return api(p).then(function (j) {
      if (j.llave) { S.set('olimp_llave_' + label, j.llave); return j.llave; }
      var e = new Error(j.motivo || 'cerrado'); e.info = j; throw e;
    });
  }

  /* ---------------- cifrado (AES-GCM, WebCrypto) ---------------- */
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function descifrar(k64, blob) {
    return crypto.subtle.importKey('raw', b64(k64), 'AES-GCM', false, ['decrypt'])
      .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(blob.iv) }, k, b64(blob.ct)); })
      .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }

  /* ---------------- marco común ---------------- */
  function barra(opts) {
    var id = alumno();
    var b = el('header', { class: 'barra noprint' }, [
      el('a', { class: 'marca', href: CFG.base + 'index.html', text: 'Olimpiada de Economía' }),
      el('span', { class: 'hueco' }),
      el('span', { id: 'cola-estado', class: 'chip aviso', style: 'display:none' }),
      opts && opts.sinId ? null : el('button', { class: 'chip', id: 'chip-id', title: 'Tu identificador (pulsa para cambiarlo)', text: id ? 'ID ' + id : 'Sin ID', onclick: function () { pedirId(function (v) { $('#chip-id').textContent = 'ID ' + v; }, true); } }),
      el('button', { class: 'chip', title: 'Claro / oscuro', 'aria-label': 'Cambiar entre modo claro y oscuro', text: 'Claro / oscuro', onclick: alternarTema })
    ]);
    document.body.appendChild(b);
    Cola.pintar();
  }

  /* ===================== PORTADA ===================== */
  function portada() {
    barra();
    var hechos = S.get('olimp_hecho', {});
    var main = el('main', { class: 'portada' });
    document.body.appendChild(main);
    var h = hoy();
    var prox = null;
    D.calendario.forEach(function (it) { if (!prox && it.tipo === 'sesion' && it.fecha >= h) prox = it; });
    main.appendChild(el('div', { class: 'portada-cab' }, [
      el('h1', { text: D.titulo + ' · ' + D.curso }),
      el('p', { class: 'meta', html: 'Materiales de las sesiones, tests de filtro y simulacros. Lo marcado como <b>hecho</b> se guarda en este dispositivo.' })
    ]));
    if (prox) {
      main.appendChild(el('div', { class: 'box key proxima' }, [
        el('div', { class: 'meta', text: 'Próxima sesión · ' + fechaLarga(prox.fecha) }),
        el('div', { class: 'proxima-tit', html: (prox.url ? '<a href="' + esc(CFG.base + prox.url) + '">' : '') + 'Sesión ' + prox.numero + ' · ' + esc(prox.titulo) + (prox.url ? '</a>' : '') })
      ]));
    }
    var nav = el('nav', { class: 'filtros noprint' });
    ['Sesiones', 'Tests de filtro', 'Simulacros'].forEach(function (t, i) {
      nav.appendChild(el('a', { href: '#' + ['sesiones', 'tests', 'simulacros'][i], class: 'chip', text: t }));
    });
    main.appendChild(nav);

    function fila(it) {
      var abierto = !!it.url;
      var bloqueado = abierto && it.abrir && it.abrir > h;
      var estado, cls;
      if (it.tipo === 'hito' || it.tipo === 'pausa') {
        return el('li', { class: 'fila ' + it.tipo }, [el('span', { class: 'fecha', text: fechaCorta(it.fecha) }), el('span', { class: 'tit', text: it.titulo })]);
      }
      if (!abierto) { estado = 'Próximamente'; cls = 'prox'; }
      else if (bloqueado) { estado = 'Se abre el ' + fechaCorta(it.abrir); cls = 'cerr'; }
      else if (hechos[it.id]) { estado = 'Hecho'; cls = 'hecho'; }
      else { estado = 'Pendiente'; cls = 'pend'; }
      var titulo = (it.tipo === 'sesion' ? 'Sesión ' + it.numero + ' · ' : '') + it.titulo;
      var kids = [
        el('span', { class: 'fecha', title: fechaLarga(it.fecha), text: fechaCorta(it.fecha) }),
        el('span', { class: 'tit' }, [abierto ? el('a', { href: CFG.base + it.url, text: titulo }) : el('span', { text: titulo }),
          it.apartados && abierto ? el('span', { class: 'aps', html: it.apartados.map(function (a) { return '<span class="ap">' + esc(APART[a] || a) + '</span>'; }).join('') }) : null]),
        el('span', { class: 'estado ' + cls, text: estado })
      ];
      return el('li', { class: 'fila ' + it.tipo + (prox && it.id === prox.id ? ' es-prox' : '') }, kids);
    }
    main.appendChild(el('h2', { id: 'sesiones', text: 'Sesiones' }));
    var tramo = null, ul = null;
    D.calendario.forEach(function (it) {
      if (it.tramo !== tramo) {
        tramo = it.tramo;
        main.appendChild(el('h3', { class: 'tramo', text: D.tramos[tramo] || 'Tramo ' + tramo }));
        ul = el('ul', { class: 'lista' }); main.appendChild(ul);
      }
      ul.appendChild(fila(it));
    });
    main.appendChild(el('h2', { id: 'tests', text: 'Tests de filtro' }));
    var ut = el('ul', { class: 'lista' });
    (D.tests || []).forEach(function (t) { ut.appendChild(fila(t)); });
    if (!(D.tests || []).length) ut.appendChild(el('li', { class: 'fila', text: 'Todavía no hay tests de filtro.' }));
    main.appendChild(ut);
    main.appendChild(el('h2', { id: 'simulacros', text: 'Simulacros' }));
    var us = el('ul', { class: 'lista' });
    D.calendario.filter(function (x) { return x.tipo === 'simulacro'; }).forEach(function (t) { us.appendChild(fila(t)); });
    main.appendChild(us);
    main.appendChild(el('p', { class: 'src', html: 'Fuente de cada pregunta: <span class="tag code">[L-año-parte-nº]</span> fase local · <span class="tag code">[N-…]</span> fase nacional · <span class="tag own">[PROPIA]</span> elaboración propia. El código gris (M07, E05…) es el tema de la matriz.' }));
  }

  /* ===================== PÁGINA DE SESIÓN / TEST ===================== */
  function pagina() {
    barra();
    var cont = el('div', { class: 'layout' });
    document.body.appendChild(cont);
    if (D.cerrado) {
      var main = el('main', {}, [el('div', { class: 'cerrado-box' }, [
        el('h1', { text: D.meta.titulo }),
        el('p', { class: 'meta', text: (D.meta.numero ? 'Sesión ' + D.meta.numero + ' · ' : '') + fechaLarga(D.meta.fecha) }),
        el('p', { id: 'cerrado-msg', html: 'Esta sesión se abre el <b>' + fechaLarga(D.cerrado.abrir) + '</b>.' })])]);
      cont.appendChild(main);
      if (D.cerrado.abrir <= hoy() || token) {
        $('#cerrado-msg').textContent = 'Abriendo…';
        llave(D.cerrado.label).then(function (k) { return descifrar(k, D.cerrado.blob); })
          .then(function (contenido) { cont.innerHTML = ''; montar(cont, contenido); })
          .catch(function (e) {
            $('#cerrado-msg').innerHTML = e.message === 'sin-endpoint' || /fetch|network|Failed/i.test(e.message)
              ? 'Necesitas conexión a internet la primera vez que abres esta sesión.'
              : 'Esta sesión se abre el <b>' + fechaLarga(D.cerrado.abrir) + '</b>.';
          });
      }
      return;
    }
    montar(cont, D.contenido);
  }

  function montar(cont, contenido) {
    var aps = contenido.apartados.slice().sort(function (a, b) { return ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id); });
    var hechos = S.get('olimp_hecho', {});
    var side = el('nav', { class: 'side', 'aria-label': 'Apartados' });
    side.appendChild(el('div', { class: 'brand', text: D.meta.numero ? 'Sesión ' + D.meta.numero + ' · ' + fechaCorta(D.meta.fecha) : D.meta.titulo }));
    var main = el('main');
    cont.appendChild(side); cont.appendChild(main);
    main.appendChild(el('div', { class: 'cab', html: contenido.cabecera_html || '' }));
    var acciones = el('div', { class: 'acciones noprint' });
    if (D.meta.tipo === 'sesion') {
      var bh = el('button', { class: 'btn ' + (hechos[D.meta.id] ? 'ok' : 'sec'), id: 'btn-hecho' });
      var pintaH = function () { var h = S.get('olimp_hecho', {})[D.meta.id]; bh.textContent = h ? '✓ Sesión hecha' : 'Marcar como hecha'; bh.className = 'btn ' + (h ? 'ok' : 'sec'); };
      pintaH();
      bh.onclick = function () {
        var hs = S.get('olimp_hecho', {}); hs[D.meta.id] = !hs[D.meta.id]; S.set('olimp_hecho', hs); pintaH();
        enviar({ accion: 'evento', evento: 'hecho', origen: D.meta.id, valor: hs[D.meta.id] ? 'sí' : 'no' });
      };
      acciones.appendChild(bh);
    }
    acciones.appendChild(el('button', { class: 'btn sec', text: 'Imprimir', onclick: function () { window.print(); } }));
    main.appendChild(acciones);
    var tabs = el('div', { class: 'tabs noprint', role: 'tablist' });
    main.appendChild(tabs);
    var secs = {};
    aps.forEach(function (a, i) {
      var titulo = APART[a.id] || a.titulo || a.id;
      var link = el('a', { href: '#' + a.id, 'data-ap': a.id, text: titulo });
      side.appendChild(link);
      tabs.appendChild(el('a', { href: '#' + a.id, 'data-ap': a.id, class: 'tab', text: titulo }));
      var sec = el('section', { class: 'apartado', id: 'ap-' + a.id, 'data-titulo': titulo });
      sec.appendChild(el('h2', { class: 'ap-tit', text: titulo }));
      a.bloques.forEach(function (b) { sec.appendChild(bloque(b, a.id)); });
      var pie = el('div', { class: 'pie-ap noprint' });
      if (i > 0) pie.appendChild(el('a', { class: 'btn sec', href: '#' + aps[i - 1].id, text: '← ' + (APART[aps[i - 1].id] || aps[i - 1].id) }));
      pie.appendChild(el('span', { class: 'hueco' }));
      if (i < aps.length - 1) pie.appendChild(el('a', { class: 'btn sec', href: '#' + aps[i + 1].id, text: (APART[aps[i + 1].id] || aps[i + 1].id) + ' →' }));
      sec.appendChild(pie);
      main.appendChild(sec); secs[a.id] = sec;
    });
    if (D.nav) {
      var ns = el('div', { class: 'nav-sesiones noprint' });
      ns.appendChild(D.nav.prev ? el('a', { href: CFG.base + D.nav.prev.url, text: '← ' + D.nav.prev.titulo }) : el('span'));
      ns.appendChild(el('a', { href: CFG.base + 'index.html', text: 'Portada' }));
      ns.appendChild(D.nav.next ? el('a', { href: CFG.base + D.nav.next.url, text: D.nav.next.titulo + ' →' }) : el('span'));
      main.appendChild(ns);
      side.appendChild(el('div', { class: 'side-nav' }, [
        D.nav.prev ? el('a', { href: CFG.base + D.nav.prev.url, class: 'l2', text: '← Anterior' }) : null,
        el('a', { href: CFG.base + 'index.html', class: 'l2', text: 'Portada' }),
        D.nav.next ? el('a', { href: CFG.base + D.nav.next.url, class: 'l2', text: 'Siguiente →' }) : null]));
    }
    aps.forEach(function (a) { $$('[id="' + a.id + '"]', main).forEach(function (x) { x.removeAttribute('id'); }); });
    function mostrar() {
      var id = (location.hash || '').slice(1);
      if (!secs[id]) id = aps[0].id;
      Object.keys(secs).forEach(function (k) { secs[k].classList.toggle('activa', k === id); });
      $$('[data-ap]').forEach(function (a) { a.classList.toggle('activo', a.getAttribute('data-ap') === id); });
      window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', mostrar);
    mostrar();
    mates(main);
  }

  /* ---------------- bloques ---------------- */
  function bloque(b, apId) {
    if (b.tipo === 'html') { var d = el('div', { class: 'b-html', html: b.html }); return d; }
    if (b.tipo === 'tarjeta') return tarjeta(b);
    if (b.tipo === 'test') return new BloqueTest(b).raiz;
    if (b.tipo === 'numerico') return new BloqueNum(b).raiz;
    if (b.tipo === 'corta' || b.tipo === 'comentario') return new BloqueTexto(b).raiz;
    return el('div', { class: 'err', text: 'Tipo de bloque desconocido: ' + b.tipo });
  }

  function tarjeta(b) {
    var h = '<h3>' + (b.tema ? temaTag(b.tema) + ' ' : '') + esc(b.titulo || '') + '</h3>';
    if (b.definicion_html) h += '<p><b>Definición.</b> ' + b.definicion_html + '</p>';
    if (b.formula_html) h += '<div class="box key"><b>Fórmula.</b> ' + b.formula_html + '</div>';
    if (b.asi_html) h += '<div class="box"><h4>Así lo preguntan</h4>' + b.asi_html + '</div>';
    if (b.errores && b.errores.length) h += '<div class="box warn"><h4>Errores que restan puntos</h4><ol class="small">' + b.errores.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>';
    return el('section', { class: 'ficha tarjeta', html: h });
  }

  function cabBloque(b) {
    var frag = el('div', { class: 'b-cab' });
    if (b.titulo_html) frag.appendChild(el('div', { html: b.titulo_html }));
    var chips = [];
    if (b.modo) chips.push('<span class="chip modo m-' + b.modo + '">' + MODOS[b.modo] + '</span>');
    if (b.minutos) chips.push('<span class="chip">' + b.minutos + ' min</span>');
    if (b.modo === 'diferida' && b.desde) chips.push('<span class="chip">Soluciones desde el ' + fechaCorta(b.desde) + '</span>');
    if (b.fuente && b.tipo !== 'test') chips.push(tag(b.fuente));
    if (b.tema && b.tipo !== 'test') chips.push(temaTag(b.tema));
    frag.appendChild(el('div', { class: 'chips', html: chips.join(' ') }));
    if (b.intro_html) frag.appendChild(el('div', { html: b.intro_html }));
    return frag;
  }

  /* estado persistente de cada bloque */
  function Estado(id) { this.k = 'olimp_b_' + id; this.v = S.get(this.k, {}); }
  Estado.prototype.save = function () { S.set(this.k, this.v); };
  Estado.prototype.reset = function () { this.v = { intento: (this.v.intento || 1) + 1 }; this.save(); };

  /* soluciones: casa → vienen en la página; clase y diferida → llave del servidor */
  function obtenerSol(b, est) {
    if (b.secreto) return Promise.resolve(b.secreto);
    if (!b.sol) return Promise.reject(new Error('sin-sol'));
    return llave(b.label_sol, { bloque: b.id }).then(function (k) { return descifrar(k, b.sol); });
  }

  /* cronómetro */
  function Crono(b, est, opciones) {
    this.b = b; this.est = est; this.o = opciones;
    this.raiz = el('div', { class: 'crono noprint' });
    this.t = el('span', { class: 'crono-t' });
    this.raiz.appendChild(this.t);
    var self = this;
    if (b.modo !== 'clase') {
      this.bPlay = el('button', { class: 'btn sec mini', text: 'Iniciar', onclick: function () { self.alternar(); } });
      this.bReset = el('button', { class: 'btn sec mini', text: 'Reiniciar', onclick: function () { est.v.crono = null; est.save(); self.pinta(); } });
      this.raiz.appendChild(this.bPlay); this.raiz.appendChild(this.bReset);
    } else {
      this.raiz.appendChild(el('span', { class: 'small meta', text: ' · bloqueado: no se pausa ni se reinicia' }));
    }
    this.iv = setInterval(function () { self.pinta(); }, 500);
    this.pinta();
  }
  Crono.prototype.restante = function () {
    var total = this.b.minutos * 60, v = this.est.v;
    if (this.b.modo === 'clase') {
      if (!v.inicio) return total;
      return total - (Date.now() - v.inicio) / 1000;
    }
    var c = v.crono || { usado: 0, desde: null };
    var usado = c.usado + (c.desde ? (Date.now() - c.desde) / 1000 : 0);
    return total - usado;
  };
  Crono.prototype.alternar = function () {
    var c = this.est.v.crono || { usado: 0, desde: null };
    if (c.desde) { c.usado += (Date.now() - c.desde) / 1000; c.desde = null; } else c.desde = Date.now();
    this.est.v.crono = c; this.est.save(); this.pinta();
  };
  Crono.prototype.pinta = function () {
    var r = Math.max(0, Math.ceil(this.restante()));
    var m = Math.floor(r / 60), s = r % 60;
    this.t.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    this.raiz.classList.toggle('poco', r <= 60);
    if (this.bPlay) { var c = this.est.v.crono; this.bPlay.textContent = c && c.desde ? 'Pausar' : (c && c.usado ? 'Seguir' : 'Iniciar'); }
    if (r <= 0 && !this.avisado) {
      var corriendo = this.b.modo === 'clase' ? !!this.est.v.inicio : !!(this.est.v.crono && this.est.v.crono.desde);
      if (corriendo) { this.avisado = true; if (this.b.modo !== 'clase' && this.est.v.crono) { this.est.v.crono.usado = this.b.minutos * 60; this.est.v.crono.desde = null; this.est.save(); } this.o.alAcabar && this.o.alAcabar(); }
    }
  };
  Crono.prototype.parar = function () { clearInterval(this.iv); };

  function iniciarClase(b, est) {
    est.v.inicio = Date.now(); est.save();
    enviar({ accion: 'inicio', bloque: b.id, origen: D.meta.id, label: b.label_sol });
  }

  /* ---------- TEST ---------- */
  function BloqueTest(b) {
    var self = this;
    this.b = b; this.est = new Estado(b.id); this.punt = b.punt;
    this.raiz = el('div', { class: 'bloque b-test', id: 'b-' + b.id, 'data-bloque': b.id });
    this.raiz.appendChild(cabBloque(b));
    var reglas = [];
    if (this.punt.max) reglas.push('Responde como máximo <b>' + this.punt.max + '</b>');
    else reglas.push('Responde las que quieras');
    if (this.punt.fallo) reglas.push('+' + ptsTxt(this.punt.acierto) + ' / −' + ptsTxt(this.punt.fallo) + ' / blanco 0');
    else reglas.push('sin penalización');
    if (this.punt.minimo != null) reglas.push('mínimo ' + ptsTxt(this.punt.minimo));
    this.raiz.appendChild(el('p', { class: 'reglas small', html: reglas.join(' · ') }));
    this.cuerpo = el('div', { class: 'b-cuerpo' });
    this.raiz.appendChild(this.cuerpo);
    this.dibujar();
    document.addEventListener('olimp-respuesta', function (e) {
      if (e.detail.payload.bloque === b.id && e.detail.payload.accion === 'enviar') {
        self.est.v.servidor = e.detail.res; self.est.save(); self.dibujar();
      }
    });
  }
  BloqueTest.prototype.dibujar = function () {
    var self = this, b = this.b, v = this.est.v;
    if (this.crono) { this.crono.parar(); this.crono = null; }
    this.cuerpo.innerHTML = '';
    if (b.modo === 'clase' && !v.inicio && !v.enviado) {
      this.cuerpo.appendChild(el('div', { class: 'box empezar' }, [
        el('p', { html: '<b>Modo clase</b>: ' + (b.minutos ? b.minutos + ' minutos, ' : '') + 'un solo intento. El cronómetro no se puede pausar. Las soluciones aparecen al acabar el tiempo.' }),
        el('button', { class: 'btn', text: 'Empezar', onclick: function () { if (!alumno()) return pedirId(function () { iniciarClase(b, self.est); self.dibujar(); }); iniciarClase(b, self.est); self.dibujar(); } })]));
      this.cuerpo.appendChild(el('div', { class: 'solo-imp', html: b.preguntas.map(function (q) {
        return '<div class="q"><div class="stem"><span class="num">' + q.n + '.</span>' + tag(q.fuente) + ' ' + temaTag(q.tema) + ' ' + q.enunciado_html + '</div><ol class="opts-imp">' +
          q.opciones.map(function (o, i) { return '<li><b>' + 'abcd'[i] + ')</b> ' + o + '</li>'; }).join('') + '</ol></div>'; }).join('') }));
      return;
    }
    if (b.minutos && !v.enviado) {
      this.crono = new Crono(b, this.est, { alAcabar: function () { if (b.modo === 'clase') self.entregar(true); } });
      this.cuerpo.appendChild(this.crono.raiz);
    }
    v.resp = v.resp || {};
    var contador = el('div', { class: 'contador noprint', 'aria-live': 'polite' });
    if (!v.enviado) this.cuerpo.appendChild(contador);
    var lista = el('div', { class: 'preguntas' });
    this.cuerpo.appendChild(lista);
    b.preguntas.forEach(function (q) {
      var d = el('div', { class: 'q', 'data-n': q.n });
      d.appendChild(el('div', { class: 'stem', html: '<span class="num">' + q.n + '.</span>' + tag(q.fuente) + ' ' + temaTag(q.tema) + (q.meta ? ' <span class="meta small">(' + esc(q.meta) + ')</span>' : '') + ' ' + q.enunciado_html }));
      var ops = el('div', { class: 'opts', role: 'radiogroup' });
      q.opciones.forEach(function (o, i) {
        var letra = 'abcd'[i];
        var bt = el('button', { type: 'button', class: 'op' + (v.resp[q.n] === letra ? ' sel' : ''), 'data-l': letra, role: 'radio', 'aria-checked': v.resp[q.n] === letra ? 'true' : 'false', html: '<b>' + letra + ')</b> <span>' + o + '</span>' });
        if (v.enviado) bt.disabled = true;
        else bt.onclick = function () { self.marcar(q.n, letra); };
        ops.appendChild(bt);
      });
      d.appendChild(ops);
      if (!v.enviado) d.appendChild(el('button', { type: 'button', class: 'blanco-btn noprint' + (v.resp[q.n] ? '' : ' oculto'), text: 'Dejar en blanco', onclick: function () { self.marcar(q.n, ''); } }));
      d.appendChild(el('div', { class: 'q-sol' }));
      lista.appendChild(d);
    });
    this.contador = contador;
    var pie = el('div', { class: 'pie-bloque noprint' });
    this.bEnviar = el('button', { class: 'btn', text: b.modo === 'casa' ? 'Corregir' : 'Enviar', onclick: function () { self.entregar(false); } });
    if (!v.enviado) pie.appendChild(this.bEnviar);
    this.res = el('div', { class: 'resultado' });
    this.cuerpo.appendChild(pie);
    this.cuerpo.appendChild(this.res);
    this.pintarContador();
    if (v.enviado) this.mostrarResultado();
    mates(this.cuerpo);
  };
  BloqueTest.prototype.respondidas = function () { var r = this.est.v.resp || {}; return Object.keys(r).filter(function (k) { return r[k]; }).length; };
  BloqueTest.prototype.marcar = function (n, letra) {
    var v = this.est.v, antes = this.respondidas();
    v.resp[n] = letra;
    var despues = this.respondidas();
    if (this.punt.max && despues > this.punt.max && despues > antes) { v.exceso = (v.exceso || 0) + 1; }
    this.est.save();
    var q = $('.q[data-n="' + n + '"]', this.cuerpo);
    $$('.op', q).forEach(function (o) { var s = o.getAttribute('data-l') === letra; o.classList.toggle('sel', s); o.setAttribute('aria-checked', s ? 'true' : 'false'); });
    $('.blanco-btn', q).classList.toggle('oculto', !letra);
    this.pintarContador();
  };
  BloqueTest.prototype.pintarContador = function () {
    if (!this.contador) return;
    var r = this.respondidas(), max = this.punt.max, n = this.b.preguntas.length;
    var pasa = max && r > max;
    this.contador.className = 'contador noprint' + (pasa ? ' mal' : '');
    this.contador.innerHTML = 'Respondidas: <b>' + r + (max ? ' / ' + max : ' de ' + n) + '</b> · En blanco: ' + (n - r) +
      (pasa ? '<br><b>Has marcado ' + r + '.</b> En el examen, responder más de ' + max + ' anula el test. Deja ' + (r - max) + ' en blanco para poder enviar.' : '');
    if (this.bEnviar) this.bEnviar.disabled = !!pasa;
  };
  BloqueTest.prototype.entregar = function (porTiempo) {
    var self = this, b = this.b, v = this.est.v;
    if (v.enviado) return;
    if (!porTiempo && this.punt.max && this.respondidas() > this.punt.max) { this.pintarContador(); return; }
    if (!alumno()) return pedirId(function () { self.entregar(porTiempo); });
    v.enviado = Date.now();
    var tiempo = b.modo === 'clase' && v.inicio ? Math.round((v.enviado - v.inicio) / 1000)
      : (v.crono ? Math.round(v.crono.usado + (v.crono.desde ? (Date.now() - v.crono.desde) / 1000 : 0)) : null);
    if (b.modo === 'clase' && b.minutos) tiempo = Math.min(tiempo, b.minutos * 60);
    v.id_envio = uuid(); v.tiempo = tiempo;
    if (b.secreto) v.local = C.corregirTest(v.resp, b.secreto, this.punt);
    this.est.save();
    enviar({ accion: 'enviar', id_envio: v.id_envio, origen: D.meta.id, bloque: b.id, tipo: 'test', modo: b.modo,
      label_sol: b.label_sol, kb: b.kb, respuestas: v.resp, tiempo_s: tiempo, exceso: v.exceso || 0,
      por_tiempo: !!porTiempo, intento: v.intento || 1 }).then(function (res) {
      if (res) { v.servidor = res; self.est.save(); }
      self.dibujar();
    });
    this.dibujar();
  };
  BloqueTest.prototype.mostrarResultado = function () {
    var self = this, b = this.b, v = this.est.v, res = this.res;
    var r = v.local || (v.servidor && v.servidor.nota != null ? v.servidor : null);
    res.innerHTML = '';
    var maxPts = this.punt.max ? this.punt.max * this.punt.acierto : b.preguntas.length * this.punt.acierto;
    if (r) {
      var lineas = [];
      if (b.formato === 'libre') lineas.push('<b>' + r.aciertos + ' de ' + b.preguntas.length + '</b> aciertos');
      else lineas.push('Nota: <b>' + ptsTxt(r.nota) + '</b> / ' + ptsTxt(maxPts));
      if (r.aciertos != null) lineas.push(r.aciertos + ' aciertos · ' + r.fallos + ' fallos · ' + r.blancos + ' en blanco');
      if (r.anulada) lineas.push('<b>Test anulado</b>: más de ' + this.punt.max + ' respuestas.');
      if (r.minimo != null || this.punt.minimo != null) {
        var sup = r.supera;
        lineas.push(sup ? '✓ Supera el mínimo de ' + ptsTxt(this.punt.minimo) + ': se corregiría el resto del examen.' : '✗ No llega al mínimo de ' + ptsTxt(this.punt.minimo) + '.');
      }
      res.appendChild(el('div', { class: 'box ' + (r.supera === false || r.anulada ? 'warn' : 'key') + ' nota', html: lineas.join('<br>') }));
    } else {
      res.appendChild(el('div', { class: 'box min', html: Cola.leer().some(function (x) { return x.id_envio === v.id_envio; })
        ? 'Respuestas guardadas en este dispositivo. Se enviarán cuando haya conexión y entonces verás tu nota.'
        : 'Enviado. Calculando la nota…' }));
    }
    if (v.exceso) res.appendChild(el('p', { class: 'small meta', text: 'Intentaste marcar más respuestas de las permitidas ' + v.exceso + (v.exceso === 1 ? ' vez.' : ' veces.') }));
    var zona = el('div', { class: 'sol-zona' });
    res.appendChild(zona);
    var pintarSol = function (sol) {
      var det = C.corregirTest(v.resp, { preguntas: sol.preguntas }, self.punt);
      if (!v.local) { v.local = det; self.est.save(); self.mostrarResultado(); return; }
      var porN = {}; sol.preguntas.forEach(function (q) { porN[q.n] = q; });
      det.detalle.forEach(function (d) {
        var q = $('.q[data-n="' + d.n + '"]', self.cuerpo), s = porN[d.n];
        q.classList.add(d.correcta === true ? 'q-ok' : d.correcta === false ? 'q-mal' : 'q-blanco');
        $$('.op', q).forEach(function (o) {
          var l = o.getAttribute('data-l');
          if (String(s.clave).indexOf(l) >= 0) o.classList.add('clave');
        });
        var t = d.correcta === true ? '✓ Correcta' : d.correcta === false ? '✗ Marcaste ' + d.respuesta + ') · la correcta es ' + s.clave + ')' : 'En blanco · la correcta es ' + s.clave + ')';
        $('.q-sol', q).innerHTML = '<div class="sol"><p><b>' + t + '.</b> ' + (s.explicacion_html || '') + '</p>' +
          (s.distractor_html ? '<p class="small"><b>Distractor más tentador:</b> ' + s.distractor_html + '</p>' : '') + '</div>';
      });
      var mal = det.detalle.filter(function (d) { return d.correcta === false; }).map(function (d) { return d.n; });
      if (mal.length && self.punt.fallo) zona.appendChild(el('p', { class: 'small', html: 'Fallaste ' + (mal.length === 1 ? 'la ' : 'las ') + '<b>' + mal.join(', ') + '</b>: si dudabas, mejor en blanco (cada fallo resta ' + ptsTxt(self.punt.fallo) + ').' }));
      mates(self.cuerpo);
    };
    if (b.secreto) { pintarSol(b.secreto); this.pieReintento(); return; }
    var abrirSol = function () {
      zona.appendChild(el('p', { class: 'small meta', text: 'Buscando las soluciones…' }));
      obtenerSol(b, self.est).then(function (sol) { zona.innerHTML = ''; pintarSol(sol); })
        .catch(function (e) {
          zona.innerHTML = '';
          var msg = b.modo === 'diferida' ? 'Las soluciones se abren el <b>' + fechaLarga(b.desde) + '</b>.' :
            'Las soluciones aparecen cuando termina el tiempo de la clase.';
          if (/fetch|network|Failed|sin-endpoint/i.test(e.message)) msg = 'Sin conexión: las soluciones aparecerán cuando vuelvas a tener internet.';
          zona.appendChild(el('p', { class: 'box', html: msg }));
          if (b.modo === 'clase' && !self.reintento) { self.reintento = setTimeout(function () { self.reintento = null; if (document.body.contains(zona)) { zona.innerHTML = ''; abrirSol(); } }, 15000); }
        });
    };
    if (b.modo === 'diferida' && b.desde > hoy() && !token) {
      zona.appendChild(el('p', { class: 'box', html: 'Las soluciones se abren el <b>' + fechaLarga(b.desde) + '</b>.' }));
    } else if (b.modo === 'clase' && v.inicio && Date.now() < v.inicio + b.minutos * 60000 && !token) {
      var espera = v.inicio + b.minutos * 60000 - Date.now();
      zona.appendChild(el('p', { class: 'box', text: 'Las soluciones aparecen al acabar el tiempo (' + Math.ceil(espera / 60000) + ' min).' }));
      setTimeout(function () { if (document.body.contains(zona)) { zona.innerHTML = ''; abrirSol(); } }, espera + 1500);
    } else abrirSol();
  };
  BloqueTest.prototype.pieReintento = function () {
    var self = this;
    if (this.b.modo !== 'casa') return;
    this.res.appendChild(el('div', { class: 'pie-bloque noprint' }, [el('button', { class: 'btn sec', text: 'Repetir el test', onclick: function () { self.est.reset(); self.dibujar(); self.raiz.scrollIntoView(); } })]));
  };

  /* ---------- NUMÉRICO ---------- */
  function BloqueNum(b) {
    var self = this;
    this.b = b; this.est = new Estado(b.id);
    this.raiz = el('div', { class: 'bloque b-num', id: 'b-' + b.id, 'data-bloque': b.id });
    this.raiz.appendChild(cabBloque(b));
    if (b.enunciado_html) this.raiz.appendChild(el('div', { class: 'enunciado', html: b.enunciado_html }));
    this.cuerpo = el('div', { class: 'b-cuerpo' });
    this.raiz.appendChild(this.cuerpo);
    this.dibujar();
    document.addEventListener('olimp-respuesta', function (e) {
      if (e.detail.payload.bloque === b.id && e.detail.payload.accion === 'enviar') { self.est.v.servidor = e.detail.res; self.est.save(); self.dibujar(); }
    });
  }
  BloqueNum.prototype.dibujar = function () {
    var self = this, b = this.b, v = this.est.v;
    if (this.crono) { this.crono.parar(); this.crono = null; }
    this.cuerpo.innerHTML = '';
    v.resp = v.resp || {}; v.pistas = v.pistas || {}; v.primero = v.primero || {};
    if (b.modo === 'clase' && !v.inicio && !v.enviado) {
      this.cuerpo.appendChild(el('div', { class: 'box empezar' }, [
        el('p', { html: '<b>Modo clase</b>: ' + (b.minutos ? b.minutos + ' minutos, ' : '') + 'un solo envío. Lee el enunciado y pulsa «Empezar» para escribir tus resultados.' }),
        el('button', { class: 'btn', text: 'Empezar', onclick: function () { if (!alumno()) return pedirId(function () { iniciarClase(b, self.est); self.dibujar(); }); iniciarClase(b, self.est); self.dibujar(); } })]));
      return;
    }
    if (b.minutos && !v.enviado) {
      this.crono = new Crono(b, this.est, { alAcabar: function () { if (b.modo === 'clase') self.entregar(true); } });
      this.cuerpo.appendChild(this.crono.raiz);
    }
    var tabla = el('div', { class: 'aps-num' });
    this.cuerpo.appendChild(tabla);
    this.filas = {};
    b.apartados.forEach(function (ap) {
      var f = el('div', { class: 'ap-num' + (ap.tipo === 'texto' ? ' ap-texto' : ''), 'data-id': ap.id });
      f.appendChild(el('label', { class: 'ap-et', for: 'in-' + b.id + '-' + ap.id, html: ap.etiqueta }));
      var inp;
      if (ap.tipo === 'texto') {
        inp = el('textarea', { id: 'in-' + b.id + '-' + ap.id, rows: '3', placeholder: 'Escribe tu respuesta' });
        inp.value = v.resp[ap.id] || '';
      } else {
        inp = el('input', { id: 'in-' + b.id + '-' + ap.id, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: v.resp[ap.id] || '' });
      }
      if (v.enviado) inp.disabled = true;
      inp.addEventListener('input', function () { v.resp[ap.id] = inp.value; self.est.save(); });
      var fila = el('div', { class: 'ap-in' }, [inp, ap.unidad ? el('span', { class: 'unidad', text: ap.unidad }) : null]);
      if (b.modo === 'casa' && ap.tipo !== 'texto' && !v.enviado) {
        fila.appendChild(el('button', { class: 'btn sec mini', text: 'Comprobar', onclick: function () { self.comprobar(ap); } }));
      }
      if (ap.pista_html && !v.enviado) {
        fila.appendChild(el('button', { class: 'btn sec mini', text: v.pistas[ap.id] ? 'Pista vista' : 'Pista', onclick: function (e) { v.pistas[ap.id] = true; self.est.save(); e.target.textContent = 'Pista vista'; $('.pista', f).hidden = false; } }));
      }
      f.appendChild(fila);
      if (ap.pista_html) f.appendChild(el('div', { class: 'pista small', hidden: !v.pistas[ap.id], html: '💡 ' + ap.pista_html }));
      f.appendChild(el('div', { class: 'ap-res' }));
      tabla.appendChild(f);
      self.filas[ap.id] = f;
      if (v.comprobado && v.comprobado[ap.id] != null && !v.enviado) self.marcaFila(ap.id, v.comprobado[ap.id], null);
    });
    this.cuerpo.appendChild(el('p', { class: 'small meta noprint', text: 'Escribe los números como en el examen: 15.120 o 6.362,5. Se acepta un margen del ±0,5 % (2 decimales).' }));
    var pie = el('div', { class: 'pie-bloque noprint' });
    if (!v.enviado) pie.appendChild(el('button', { class: 'btn', text: b.modo === 'casa' ? 'Terminar y ver la solución' : 'Enviar', onclick: function () { self.entregar(false); } }));
    this.cuerpo.appendChild(pie);
    this.res = el('div', { class: 'resultado' });
    this.cuerpo.appendChild(this.res);
    if (v.enviado) this.mostrarResultado();
    mates(this.cuerpo);
  };
  BloqueNum.prototype.marcaFila = function (id, ok, sol) {
    var f = this.filas[id]; if (!f) return;
    f.classList.remove('ok', 'mal');
    if (ok === true) f.classList.add('ok'); else if (ok === false) f.classList.add('mal');
    var t = ok === true ? '✓ Correcto' : ok === false ? '✗ No coincide' : '';
    if (sol && sol.valor != null) t += ' · solución: <b>' + C.fmt(C.esperado(sol)) + (sol.unidad ? ' ' + esc(sol.unidad) : '') + '</b>';
    $('.ap-res', f).innerHTML = t;
  };
  BloqueNum.prototype.comprobar = function (ap) {
    var v = this.est.v, sec = this.b.secreto;
    var s = sec.apartados.filter(function (x) { return x.id === ap.id; })[0];
    var txt = v.resp[ap.id] || '';
    var val = C.leerNumero(txt);
    if (val == null) { $('.ap-res', this.filas[ap.id]).textContent = 'Escribe un número.'; return; }
    var ok = C.corregirNumero(val, s);
    v.comprobado = v.comprobado || {}; v.comprobado[ap.id] = ok;
    if (v.primero[ap.id] == null) v.primero[ap.id] = txt;
    this.est.save();
    this.marcaFila(ap.id, ok, null);
  };
  BloqueNum.prototype.entregar = function (porTiempo) {
    var self = this, b = this.b, v = this.est.v;
    if (v.enviado) return;
    if (!alumno()) return pedirId(function () { self.entregar(porTiempo); });
    v.enviado = Date.now();
    var r = {};
    b.apartados.forEach(function (ap) { r[ap.id] = v.primero[ap.id] != null && ap.tipo !== 'texto' ? v.primero[ap.id] : (v.resp[ap.id] || ''); });
    var tiempo = b.modo === 'clase' && v.inicio ? Math.min(Math.round((v.enviado - v.inicio) / 1000), (b.minutos || 999) * 60) : (v.crono ? Math.round(v.crono.usado) : null);
    v.id_envio = uuid(); v.tiempo = tiempo; v.registrado = r;
    if (b.secreto) { v.local = C.corregirNumerico(v.resp, b.secreto); v.alPrimero = C.corregirNumerico(r, b.secreto); }
    this.est.save();
    enviar({ accion: 'enviar', id_envio: v.id_envio, origen: D.meta.id, bloque: b.id, tipo: 'numerico', modo: b.modo,
      label_sol: b.label_sol, kb: b.kb, respuestas: r, pistas: v.pistas, tiempo_s: tiempo, por_tiempo: !!porTiempo, intento: v.intento || 1 })
      .then(function (res) { if (res) { v.servidor = res; self.est.save(); } self.dibujar(); });
    this.dibujar();
  };
  BloqueNum.prototype.mostrarResultado = function () {
    var self = this, b = this.b, v = this.est.v, res = this.res;
    res.innerHTML = '';
    var r = v.local || (v.servidor && v.servidor.aciertos != null ? v.servidor : null);
    if (r) res.appendChild(el('div', { class: 'box key nota', html: 'Apartados numéricos correctos: <b>' + r.aciertos + ' de ' + r.total + '</b>' +
      (v.alPrimero && v.alPrimero.aciertos !== r.aciertos ? '<br><span class="small">A la primera comprobación: ' + v.alPrimero.aciertos + ' de ' + r.total + ' (es lo que queda registrado).</span>' : '') }));
    else res.appendChild(el('div', { class: 'box min', text: Cola.leer().some(function (x) { return x.id_envio === v.id_envio; }) ? 'Guardado en este dispositivo: se enviará cuando haya conexión.' : 'Enviado.' }));
    var zona = el('div', { class: 'sol-zona' }); res.appendChild(zona);
    var pintar = function (sol) {
      var det = C.corregirNumerico(v.resp, sol);
      if (!v.local) { v.local = det; self.est.save(); self.mostrarResultado(); return; }
      var porId = {}; sol.apartados.forEach(function (a) { porId[a.id] = a; });
      det.detalle.forEach(function (d) {
        var a = porId[d.id], pub = b.apartados.filter(function (x) { return x.id === d.id; })[0];
        if (d.tipo === 'texto') {
          $('.ap-res', self.filas[d.id]).innerHTML = '<div class="sol"><b>Respuesta modelo:</b> ' + (a.modelo_html || '') + '</div>';
        } else self.marcaFila(d.id, d.correcta, { valor: a.valor, redondeo: a.redondeo, unidad: pub && pub.unidad });
      });
      if (sol.solucion_html) zona.appendChild(el('details', { class: 'solucion', open: true }, [el('summary', { text: 'Solución paso a paso' }), el('div', { class: 'sol', html: sol.solucion_html })]));
      var textos = b.apartados.filter(function (a) { return a.tipo === 'texto'; });
      if (textos.length) zona.appendChild(autoeval(b, self.est, textos.map(function (a) { return { n: a.id, etiqueta: a.etiqueta, puntos: a.puntos }; })));
      if (b.modo === 'casa') zona.appendChild(el('div', { class: 'pie-bloque noprint' }, [el('button', { class: 'btn sec', text: 'Repetir el problema', onclick: function () { self.est.reset(); self.dibujar(); } })]));
      mates(self.cuerpo);
    };
    if (b.secreto) return pintar(b.secreto);
    solDiferida(b, v, zona, function () { return obtenerSol(b, self.est).then(pintar); });
  };

  /* espera de soluciones en clase / diferida */
  function solDiferida(b, v, zona, abrir) {
    var intentar = function () {
      zona.innerHTML = '<p class="small meta">Buscando las soluciones…</p>';
      abrir().catch(function (e) {
        var msg = b.modo === 'diferida' ? 'Las soluciones se abren el <b>' + fechaLarga(b.desde) + '</b>.' : 'Las soluciones aparecen cuando termina el tiempo de la clase.';
        if (/fetch|network|Failed|sin-endpoint/i.test(e.message)) msg = 'Sin conexión: las soluciones aparecerán cuando vuelvas a tener internet.';
        zona.innerHTML = '<p class="box">' + msg + '</p>';
        if (b.modo === 'clase') setTimeout(function () { if (document.body.contains(zona)) intentar(); }, 15000);
      });
    };
    if (b.modo === 'diferida' && b.desde > hoy() && !token) { zona.innerHTML = '<p class="box">Las soluciones se abren el <b>' + fechaLarga(b.desde) + '</b>.</p>'; return; }
    if (b.modo === 'clase' && v.inicio && Date.now() < v.inicio + b.minutos * 60000 && !token) {
      var espera = v.inicio + b.minutos * 60000 - Date.now();
      zona.innerHTML = '<p class="box">Las soluciones aparecen al acabar el tiempo (' + Math.ceil(espera / 60000) + ' min).</p>';
      setTimeout(function () { if (document.body.contains(zona)) intentar(); }, espera + 1500);
      return;
    }
    intentar();
  }

  /* autoevaluación (respuestas escritas y comentario) */
  function autoeval(b, est, items, rubrica) {
    var v = est.v; v.auto = v.auto || {};
    var caja = el('div', { class: 'box autoeval' });
    caja.appendChild(el('h4', { text: 'Autoevaluación' }));
    if (rubrica) caja.appendChild(el('div', { class: 'small', html: rubrica }));
    items.forEach(function (it) {
      var sel = el('select', { 'aria-label': 'Autoevaluación ' + it.n });
      var ops = [];
      if (it.puntos) { for (var x = 0; x <= it.puntos + 1e-9; x += 0.25) ops.push([C.r(x, 2), C.fmt(x) + ' / ' + C.fmt(it.puntos) + ' pt']); }
      else ops = [[1, 'Bien'], [0.5, 'A medias'], [0, 'Mal']];
      sel.appendChild(el('option', { value: '', text: '—' }));
      ops.reverse().forEach(function (o) { sel.appendChild(el('option', { value: String(o[0]), text: o[1] })); });
      if (v.auto[it.n] != null) sel.value = String(v.auto[it.n]);
      sel.onchange = function () { v.auto[it.n] = sel.value === '' ? null : Number(sel.value); est.save(); };
      if (v.autoEnviada) sel.disabled = true;
      caja.appendChild(el('div', { class: 'auto-fila' }, [el('span', { html: '<b>' + esc(String(it.n)) + '</b> ' + (it.etiqueta ? '· ' + it.etiqueta : '') }), sel]));
    });
    var msg = el('span', { class: 'small meta' });
    var bt = el('button', { class: 'btn', text: v.autoEnviada ? 'Autoevaluación guardada' : 'Guardar autoevaluación', disabled: !!v.autoEnviada, onclick: function () {
      var falt = items.filter(function (it) { return v.auto[it.n] == null; });
      if (falt.length) { msg.textContent = 'Valora todas las respuestas.'; return; }
      var evals = {}; items.forEach(function (it) { evals[it.n] = { puntos: v.auto[it.n], max: it.puntos || 1 }; });
      v.autoEnviada = Date.now(); est.save();
      enviar({ accion: 'autoeval', origen: D.meta.id, bloque: b.id, tipo: b.tipo, modo: b.modo, kb: b.kb, ref: v.id_envio, evals: evals, intento: v.intento || 1 });
      bt.disabled = true; bt.textContent = 'Autoevaluación guardada'; $$('select', caja).forEach(function (s) { s.disabled = true; });
    } });
    caja.appendChild(el('div', { class: 'pie-bloque' }, [bt, msg]));
    return caja;
  }

  /* ---------- RESPUESTA ESCRITA CORTA / COMENTARIO ---------- */
  function BloqueTexto(b) {
    var self = this;
    this.b = b; this.est = new Estado(b.id);
    this.raiz = el('div', { class: 'bloque b-texto', id: 'b-' + b.id, 'data-bloque': b.id });
    this.raiz.appendChild(cabBloque(b));
    if (b.texto_html) this.raiz.appendChild(el('div', { class: 'texto-comentario', html: b.texto_html }));
    this.cuerpo = el('div', { class: 'b-cuerpo' });
    this.raiz.appendChild(this.cuerpo);
    this.dibujar();
  }
  BloqueTexto.prototype.dibujar = function () {
    var self = this, b = this.b, v = this.est.v;
    if (this.crono) { this.crono.parar(); this.crono = null; }
    this.cuerpo.innerHTML = '';
    v.resp = v.resp || {};
    if (b.modo === 'clase' && !v.inicio && !v.enviado) {
      this.cuerpo.appendChild(el('div', { class: 'box empezar' }, [el('p', { html: '<b>Modo clase</b>: ' + (b.minutos ? b.minutos + ' minutos. ' : '') + 'Pulsa «Empezar» para responder.' }),
        el('button', { class: 'btn', text: 'Empezar', onclick: function () { if (!alumno()) return pedirId(function () { iniciarClase(b, self.est); self.dibujar(); }); iniciarClase(b, self.est); self.dibujar(); } })]));
      return;
    }
    if (b.minutos && !v.enviado) { this.crono = new Crono(b, this.est, { alAcabar: function () { if (b.modo === 'clase') self.entregar(true); } }); this.cuerpo.appendChild(this.crono.raiz); }
    this.zonas = {};
    b.preguntas.forEach(function (q) {
      var d = el('div', { class: 'q q-texto', 'data-n': q.n });
      d.appendChild(el('div', { class: 'stem', html: '<span class="num">' + q.n + '.</span>' + tag(q.fuente) + ' ' + temaTag(q.tema) + (q.puntos ? ' <span class="meta small">(' + C.fmt(q.puntos) + ' pt)</span>' : '') + ' ' + q.enunciado_html }));
      var ta = el('textarea', { rows: '5', placeholder: 'Escribe tu respuesta: concepto exacto + dato + argumento.', 'aria-label': 'Respuesta ' + q.n });
      ta.value = v.resp[q.n] || '';
      if (v.enviado) ta.disabled = true;
      ta.addEventListener('input', function () { v.resp[q.n] = ta.value; self.est.save(); });
      d.appendChild(ta);
      d.appendChild(el('div', { class: 'q-sol' }));
      self.zonas[q.n] = d;
      self.cuerpo.appendChild(d);
    });
    if (!v.enviado) this.cuerpo.appendChild(el('div', { class: 'pie-bloque noprint' }, [el('button', { class: 'btn', text: b.modo === 'casa' ? 'Enviar y ver la respuesta modelo' : 'Enviar', onclick: function () { self.entregar(false); } })]));
    this.res = el('div', { class: 'resultado' });
    this.cuerpo.appendChild(this.res);
    if (v.enviado) this.mostrarResultado();
    mates(this.cuerpo);
  };
  BloqueTexto.prototype.entregar = function (porTiempo) {
    var self = this, b = this.b, v = this.est.v;
    if (v.enviado) return;
    if (!alumno()) return pedirId(function () { self.entregar(porTiempo); });
    v.enviado = Date.now(); v.id_envio = uuid(); this.est.save();
    var tiempo = b.modo === 'clase' && v.inicio ? Math.min(Math.round((v.enviado - v.inicio) / 1000), (b.minutos || 999) * 60) : (v.crono ? Math.round(v.crono.usado) : null);
    enviar({ accion: 'enviar', id_envio: v.id_envio, origen: D.meta.id, bloque: b.id, tipo: b.tipo, modo: b.modo, label_sol: b.label_sol, kb: b.kb,
      respuestas: v.resp, tiempo_s: tiempo, por_tiempo: !!porTiempo, intento: v.intento || 1 }).then(function () { self.dibujar(); });
    this.dibujar();
  };
  BloqueTexto.prototype.mostrarResultado = function () {
    var self = this, b = this.b, v = this.est.v;
    this.res.innerHTML = '';
    var pend = Cola.leer().some(function (x) { return x.id_envio === v.id_envio; });
    this.res.appendChild(el('div', { class: 'box ' + (pend ? 'min' : 'key'), text: pend ? 'Respuesta guardada en este dispositivo: se enviará cuando haya conexión.' : 'Respuesta enviada.' }));
    var zona = el('div', { class: 'sol-zona' }); this.res.appendChild(zona);
    var pintar = function (sol) {
      var porN = {}; sol.preguntas.forEach(function (q) { porN[q.n] = q; });
      b.preguntas.forEach(function (q) {
        var s = porN[q.n] || {};
        $('.q-sol', self.zonas[q.n]).innerHTML = '<div class="sol"><p><b>Respuesta modelo</b></p>' + (s.modelo_html || '') + (s.criterios_html ? '<div class="criterios">' + s.criterios_html + '</div>' : '') + '</div>';
      });
      zona.innerHTML = '';
      zona.appendChild(autoeval(b, self.est, b.preguntas.map(function (q) { return { n: q.n, puntos: q.puntos, etiqueta: '' }; }), sol.rubrica_html));
      if (b.modo === 'casa') zona.appendChild(el('div', { class: 'pie-bloque noprint' }, [el('button', { class: 'btn sec', text: 'Volver a responder', onclick: function () { self.est.reset(); self.dibujar(); } })]));
      mates(self.cuerpo);
    };
    if (b.secreto) return pintar(b.secreto);
    solDiferida(b, v, zona, function () { return obtenerSol(b, self.est).then(pintar); });
  };

  /* ===================== PANTALLA DE PROFESORA ===================== */
  function profe() {
    barra({ sinId: true });
    S.set('olimp_token', D.token); token = D.token;
    var main = el('main', { class: 'profe' });
    document.body.appendChild(main);
    main.appendChild(el('h1', { text: 'Pantalla de profesora' }));
    main.appendChild(el('p', { class: 'meta', html: 'Este navegador queda en <b>vista de profesora</b>: puedes abrir las sesiones bloqueadas y ver las soluciones antes de tiempo. <a href="' + esc(D.hoja_url || '#') + '" target="_blank" rel="noopener">Abrir la Hoja de resultados</a>.' }));

    /* registro de exámenes en papel */
    var sec = el('section', { class: 'bloque' });
    main.appendChild(sec);
    sec.appendChild(el('h2', { text: 'Registrar respuestas en papel' }));
    var sel = el('select', { id: 'p-bloque', 'aria-label': 'Ejercicio' });
    sel.appendChild(el('option', { value: '', text: 'Elige el ejercicio…' }));
    var grupos = {};
    D.bloques.forEach(function (b, i) {
      var g = grupos[b.origen]; if (!g) { g = grupos[b.origen] = el('optgroup', { label: b.origen + ' · ' + b.origen_titulo }); sel.appendChild(g); }
      g.appendChild(el('option', { value: String(i), text: b.id + ' · ' + b.descripcion }));
    });
    var idIn = el('input', { type: 'text', id: 'p-alumno', maxlength: '4', placeholder: 'ID', autocapitalize: 'characters', 'aria-label': 'ID del alumno' });
    var form = el('div', { id: 'p-form' });
    var out = el('div', { id: 'p-out' });
    sec.appendChild(el('div', { class: 'fila-botones' }, [sel, idIn]));
    sec.appendChild(form); sec.appendChild(out);
    sel.onchange = function () {
      form.innerHTML = ''; out.innerHTML = '';
      if (sel.value === '') return;
      var b = D.bloques[Number(sel.value)];
      if (b.tipo === 'test') {
        form.appendChild(el('p', { class: 'small', text: 'Escribe la letra marcada (a-d) o déjalo vacío si está en blanco. Con el teclado: escribe y salta solo a la siguiente.' }));
        var g = el('div', { class: 'rejilla' });
        b.preguntas.forEach(function (q, i) {
          var inp = el('input', { type: 'text', maxlength: '1', 'data-n': q.n, 'aria-label': 'Pregunta ' + q.n, autocomplete: 'off' });
          inp.addEventListener('input', function () {
            inp.value = inp.value.toLowerCase().replace(/[^a-d]/g, '');
            if (inp.value) { var nx = g.querySelectorAll('input')[i + 1]; if (nx) nx.focus(); }
            cuenta();
          });
          g.appendChild(el('label', { class: 'celda' }, [el('span', { text: String(q.n) }), inp]));
        });
        form.appendChild(g);
        var cnt = el('p', { class: 'small' });
        var cuenta = function () { var n = $$('input', g).filter(function (x) { return x.value; }).length; cnt.textContent = 'Respondidas: ' + n + (b.punt.max ? ' / ' + b.punt.max + (n > b.punt.max ? ' — más de las permitidas: el test se registrará como anulado' : '') : ''); };
        form.appendChild(cnt); cuenta();
      } else if (b.tipo === 'numerico') {
        b.apartados.forEach(function (a) {
          if (a.tipo === 'texto') return;
          form.appendChild(el('label', { class: 'p-num' }, [el('span', { html: a.etiqueta }), el('input', { type: 'text', inputmode: 'decimal', 'data-id': a.id }), el('span', { class: 'unidad', text: a.unidad || '' })]));
        });
      } else {
        b.preguntas.forEach(function (q) {
          form.appendChild(el('label', { class: 'p-num' }, [el('span', { text: 'Pregunta ' + q.n + (q.puntos ? ' (' + C.fmt(q.puntos) + ' pt)' : '') }), el('input', { type: 'text', inputmode: 'decimal', 'data-n': q.n, placeholder: 'puntos' })]));
        });
      }
      form.appendChild(el('div', { class: 'pie-bloque' }, [el('button', { class: 'btn', text: 'Registrar', onclick: registrar })]));
    };
    function registrar() {
      var b = D.bloques[Number(sel.value)];
      var id = idIn.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(id)) { out.innerHTML = '<p class="err-txt">El ID son 4 caracteres.</p>'; idIn.focus(); return; }
      var p = { accion: 'enviar', alumno: id, origen: b.origen, bloque: b.id, tipo: b.tipo, modo: 'papel', label_sol: b.label_sol, kb: b.kb, respuestas: {}, intento: 1 };
      if (b.tipo === 'test') $$('#p-form input[data-n]').forEach(function (x) { p.respuestas[x.getAttribute('data-n')] = x.value; });
      else if (b.tipo === 'numerico') $$('#p-form input[data-id]').forEach(function (x) { p.respuestas[x.getAttribute('data-id')] = x.value; });
      else { p.accion = 'autoeval'; p.evals = {}; $$('#p-form input[data-n]').forEach(function (x) { var q = b.preguntas.filter(function (y) { return String(y.n) === x.getAttribute('data-n'); })[0]; p.evals[q.n] = { puntos: C.leerNumero(x.value), max: q.puntos || 1 }; }); }
      out.innerHTML = '<p class="small meta">Enviando…</p>';
      enviar(p).then(function (res) {
        if (!res) { out.innerHTML = '<p class="box min">Sin conexión: queda en la cola de este navegador y se enviará solo.</p>'; return; }
        var t = res.nota != null ? 'Nota: <b>' + ptsTxt(res.nota) + '</b>' + (res.supera === true ? ' · supera el mínimo' : res.supera === false ? ' · no llega al mínimo' : '') + (res.anulada ? ' · ANULADO (más respuestas de las permitidas)' : '')
          : res.aciertos != null ? 'Correctos: <b>' + res.aciertos + ' de ' + res.total + '</b>' : 'Registrado.';
        out.innerHTML = '<p class="box key">' + id + ' · ' + esc(b.id) + ' · ' + t + (res.duplicado ? ' (ya estaba registrado)' : '') + '</p>';
        $$('#p-form input').forEach(function (x) { x.value = ''; }); idIn.value = ''; idIn.focus();
      });
    }

    /* herramientas */
    var h = el('section', { class: 'bloque' });
    main.appendChild(h);
    h.appendChild(el('h2', { text: 'Herramientas' }));
    var estado = el('p', { class: 'small' });
    h.appendChild(el('div', { class: 'fila-botones' }, [
      el('button', { class: 'btn sec', text: 'Comprobar conexión con la Hoja', onclick: function () { estado.textContent = '…'; api({ accion: 'ping' }).then(function (j) { estado.textContent = 'Conectado. Filas en el registro: ' + j.filas + ' · versión del script: ' + j.version; }, function (e) { estado.textContent = 'Sin conexión: ' + e.message; }); } }),
      el('button', { class: 'btn sec', text: 'Actualizar el PANEL ahora', onclick: function () { estado.textContent = '…'; api({ accion: 'panel' }).then(function (j) { estado.textContent = 'PANEL actualizado (' + j.filas + ' filas leídas).'; }, function (e) { estado.textContent = 'Error: ' + e.message; }); } })]));
    h.appendChild(estado);
    var purgaId = el('input', { type: 'text', maxlength: '4', placeholder: 'ID', 'aria-label': 'ID a borrar' });
    var purgaConf = el('input', { type: 'text', placeholder: 'escribe BORRAR', 'aria-label': 'Confirmación' });
    var purgaMsg = el('p', { class: 'small' });
    h.appendChild(el('h3', { text: 'Borrar todos los registros de un ID' }));
    h.appendChild(el('p', { class: 'small meta', text: 'Útil para eliminar identificadores de prueba. No se puede deshacer.' }));
    h.appendChild(el('div', { class: 'fila-botones' }, [purgaId, purgaConf, el('button', { class: 'btn peligro', text: 'Borrar', onclick: function () {
      var id = purgaId.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(id) || purgaConf.value.trim() !== 'BORRAR') { purgaMsg.textContent = 'Escribe el ID y la palabra BORRAR.'; return; }
      purgaMsg.textContent = '…';
      api({ accion: 'purgar', alumno: id }).then(function (j) { purgaMsg.textContent = 'Borradas ' + j.borradas + ' filas de ' + id + '.'; purgaConf.value = ''; }, function (e) { purgaMsg.textContent = 'Error: ' + e.message; });
    } })]));
    h.appendChild(purgaMsg);
    h.appendChild(el('h3', { text: 'Este navegador' }));
    h.appendChild(el('div', { class: 'fila-botones' }, [el('button', { class: 'btn sec', text: 'Salir de la vista de profesora', onclick: function () { S.del('olimp_token'); token = null; location.href = CFG.base + 'index.html'; } })]));
  }

  /* ---------------- arranque ---------------- */
  function arrancar() {
    document.body.classList.add('pag-' + D.pagina);
    if (D.pagina === 'portada') portada();
    else if (D.pagina === 'profe') profe();
    else pagina();
    if (D.pagina !== 'profe' && !alumno()) pedirId(function (v) { var c = $('#chip-id'); if (c) c.textContent = 'ID ' + v; });
    Cola.vaciar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
  window.Olimp = { Cola: Cola, S: S, D: D, version: CFG.version };
})();
