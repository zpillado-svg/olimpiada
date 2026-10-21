# Formato de los datos de la web

La web se genera con `tools/build.mjs` a partir de archivos JSON **que no están en este repositorio** (contienen las soluciones). Añadir una sesión, un test o un simulacro es escribir un JSON nuevo y volver a construir: el motor (`assets/engine.js`, `assets/core.js`, `assets/style.css`) no se toca.

```
fuente/
  catalogo.json          calendario de la portada (todas las sesiones, simulacros e hitos)
  sesiones/S04.json      una sesión (página s/S04.html)
  tests/TF01.json        un test de filtro (página t/TF01.html)
  simulacros/SIM-L1.json un simulacro (página x/SIM-L1.html)
```

## Página (sesión, test o simulacro)

```json
{
  "id": "S04",                       // S01-S40 · TF00, TF01… · SIM-L1, SIM-N2…  (debe coincidir con catalogo.json)
  "tipo": "sesion",                  // sesion | test | simulacro
  "numero": 4,                       // solo sesiones
  "fecha": "2026-11-17",
  "tramo": "A",
  "titulo": "Análisis: fondo de maniobra, ratios y rentabilidades",
  "temas": ["M14"],
  "abrir": "2026-11-17",             // opcional: bloqueada hasta ese día (la llave la da el servidor)
  "acceso": "profesora",             // opcional: protegida con el código de profesora en vez del de grupo
  "cabecera_html": "<header class=\"cover\">…</header>",
  "apartados": [
    { "id": "teoria",   "bloques": [ … ] },
    { "id": "flash",    "bloques": [ … ] },
    { "id": "nacional", "bloques": [ … ] },
    { "id": "problema", "bloques": [ … ] },
    { "id": "comentario","bloques": [ … ] },
    { "id": "bateria",  "bloques": [ … ] },
    { "id": "tarea",    "bloques": [ … ] }
  ]
}
```

Solo se muestran los apartados que existan, en ese orden. Los `id` de bloque deben ser **únicos en toda la web** (convención: `S04-flash`, `S04-problema`, `S04-tarea`…).

## Campos comunes de los bloques interactivos

| campo | valores | notas |
|---|---|---|
| `modo` | `clase` · `casa` · `diferida` | clase: cronómetro bloqueado, un intento, soluciones al acabar el tiempo · casa: sin bloqueo, soluciones al corregir · diferida: nota al enviar, soluciones desde `desde` |
| `minutos` | número | cronómetro (obligatorio en clase; opcional en casa y diferida) |
| `desde` | `AAAA-MM-DD` | obligatorio en diferida (normalmente la fecha de la sesión siguiente). En clase, por defecto, la fecha de la página |
| `fuente` | `L-2022-P-4`, `N-2023-T-14`, `PROPIA`, `L-2015-CC-6 → test` | se muestra como etiqueta |
| `tema` | `M07`, `E05`, `H1`, `COM`, `EST` | código de la matriz |
| `titulo_html`, `intro_html` | HTML | encabezado e instrucciones |

Fórmulas con KaTeX: `\( … \)` en línea y `\[ … \]` en bloque (el motor carga KaTeX solo si la página las usa). Gráficos: SVG en línea dentro de cualquier campo HTML, envuelto en `<div class="fig">…<div class="cap">pie</div></div>`.

## 1. Teoría

Texto libre (se copia tal cual):
```json
{ "tipo": "html", "html": "<section class=\"ficha\">…</section>" }
```
Tarjeta escueta:
```json
{ "tipo": "tarjeta", "tema": "M07", "titulo": "Umbral de rentabilidad",
  "definicion_html": "Cantidad que hace el beneficio cero…",
  "formula_html": "\\( Q^* = \\dfrac{CF}{p - c_v} \\) (al alza)",
  "asi_html": "<ul><li>Test: «¿cuál es el umbral…?»</li></ul>",
  "errores": ["No anualizar los costes mensuales.", "Redondear a la baja."] }
```

## 2-3. Test (local, nacional o libre)

```json
{ "tipo": "test", "id": "S04-flash", "formato": "local", "modo": "clase", "minutos": 15,
  "max": 10, "minimo": 2.4,              // opcionales: por defecto los del formato
  "preguntas": [
    { "n": 1, "fuente": "L-2023-T-6", "tema": "M14", "meta": "fase nacional",
      "enunciado_html": "¿Qué operación aumenta el fondo de maniobra?",
      "opciones": ["…", "…", "…", "…"],
      "clave": "b",                       // "b,c" si la plantilla oficial da dos válidas
      "explicacion_html": "Por qué es la b…",
      "distractor_html": "a): por qué tienta y por qué falla." } ] }
```
Formatos: `local` +0,4 / −0,1, máx. 10 respuestas, mínimo 2,4 · `nacional` +0,25 / −0,25/3 (−0,083), sin máximo · `libre` sin penalización (test flash). Se pueden sobrescribir con `acierto`, `fallo`, `max`, `minimo` (`null` = sin mínimo).

## 4. Numérico (problema con apartados)

```json
{ "tipo": "numerico", "id": "S06-problema", "modo": "clase", "minutos": 25,
  "fuente": "L-2022-P-3", "tema": "M07",
  "enunciado_html": "<div class=\"box\">…</div>",
  "apartados": [
    { "id": "a1", "etiqueta": "a) Umbral de rentabilidad", "valor": 1599.2, "unidad": "u.",
      "redondeo": "alza",                 // unidades físicas: se espera el entero superior (1.600)
      "pista_html": "Anualiza los costes fijos." },
    { "id": "b1", "etiqueta": "b) Beneficio", "valor": 12500, "unidad": "€",
      "tolerancia": 0.5 },                // % (por defecto 0,5 %); o "tolerancia_abs": 0.01
    { "id": "c1", "tipo": "texto", "etiqueta": "c) Interpreta el resultado",
      "modelo_html": "Respuesta modelo…" } ],
  "solucion_html": "<p>Paso 1…</p>" }
```
En modo casa cada apartado tiene «Comprobar» y se registra el **primer** valor comprobado. Los apartados `texto` se autoevalúan.

## 5. Comentario de texto

```json
{ "tipo": "comentario", "id": "S09-comentario", "modo": "casa", "fuente": "L-2022-C",
  "texto_html": "<blockquote>Texto de actualidad…</blockquote>",
  "rubrica_html": "<p>Cada respuesta: concepto exacto · dato del texto · argumento · conclusión.</p>",
  "preguntas": [
    { "n": 1, "tema": "E17", "puntos": 0.5, "enunciado_html": "…", "modelo_html": "…", "criterios_html": "…" },
    { "n": 2, "tema": "E17", "puntos": 0.75, "enunciado_html": "…", "modelo_html": "…" },
    { "n": 3, "tema": "E16", "puntos": 0.75, "enunciado_html": "…", "modelo_html": "…" } ] }
```
Las preguntas deben sumar 2 puntos (el script lo comprueba).

## 6. Respuesta escrita corta

Igual que el comentario pero con `"tipo": "corta"`, sin `texto_html` y sin la suma obligatoria de 2 puntos. `puntos` es opcional (sin puntos, la autoevaluación es bien / a medias / mal).

## Calendario (`catalogo.json`)

```json
{ "titulo": "Olimpiada de Economía", "curso": "2026-27",
  "tramos": { "A": "Tramo A · …" },
  "calendario": [
    { "id": "S04", "tipo": "sesion", "numero": 4, "fecha": "2026-11-17", "titulo": "…", "tramo": "A" },
    { "id": "SIM-L1", "tipo": "simulacro", "fecha": "2027-01-30", "titulo": "Simulacro local 1 (2 h 15)", "tramo": "B" },
    { "id": null, "tipo": "hito", "fecha": "2027-03-13", "titulo": "FASE LOCAL (fecha estimada)", "tramo": "B" } ],
  "tests": [ { "id": "TF00", "tipo": "test", "fecha": "2026-10-21", "titulo": "…" } ] }
```
Lo que aparece en el calendario sin página construida sale como «Próximamente».

## Construir y publicar

```
cd tools && npm install          # solo la primera vez (StatiCrypt)
node tools/build.mjs --fuente <carpeta fuente> --secretos <secretos.json> --out . --codigo-gs <ruta>/Code.gs
git add -A && git commit -m "Sesión 4" && git push
```
El script valida los datos (fuentes, temas, claves, ids repetidos, modo diferida sin fecha…) y se detiene si algo no cuadra.
