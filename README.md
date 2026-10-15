# Puntos ciegos de ajedrez

Sitio estático: subís tus partidas en PGN y Stockfish (WASM, en el navegador) marca en el tablero
las casillas donde más errores cometés y dónde dejás piezas colgadas.

## Correr en local

Tiene que servirse por HTTP (los Web Workers y los módulos ES no andan con `file://`):

- Con WAMP: `http://localhost/Ajedrez_Heatmap/`
- O desde la carpeta: `php -S localhost:8080` y abrir `http://localhost:8080/`

## Publicar

Es todo estático: se sube la carpeta tal cual (Netlify, GitHub Pages, cualquier hosting).
El servidor tiene que servir `.wasm` como `application/wasm` (Netlify lo hace solo).

## Estructura

- `index.html`, `estilos.css`: pantalla.
- `js/app.js`: interfaz, filtros y mapa de calor.
- `js/analisis.js`: parseo de PGN, evaluación de cada posición y detección de errores.
- `js/motor.js`: envoltorio UCI de Stockfish en un Web Worker.
- `js/cache.js`: caché de evaluaciones en IndexedDB (re-subir las mismas partidas es instantáneo).
- `js/tablero.js`: dibujo del tablero en SVG (piezas, mapa de calor, flechas).
- `vendor/`: Stockfish 19 lite (single-thread, GPLv3, ver `Copying.txt`) y chess.js, copiados de npm.

## Cómo se calcula un "error"

Por cada jugada tuya: pérdida = evaluación antes − evaluación después (en centipeones, desde tu lado).
Los mates cuentan como ±1000. Se guardan las pérdidas desde 50 cp; el umbral se elige en pantalla.
## Nivel estimado

Por cada bando y partida se calcula la pérdida media por jugada (ACPL), sin contar las primeras 5 jugadas
y con un tope de 500 cp por jugada. El Elo sale de la fórmula empírica `3100·e^(−0,01·ACPL)`, redondeada a 50.
Es una referencia: depende de la profundidad elegida y de la cantidad de jugadas. Si el PGN trae
`WhiteElo`/`BlackElo`, se muestra al lado para comparar.

## Tipos de error

Cada error se clasifica con esta prioridad (heurística a partir de las jugadas de Stockfish, no es exacta):

1. **Pieza colgada**: la mejor respuesta del rival captura una pieza tuya y no podés recapturar.
2. **Táctica**: el rival tiene una captura con recaptura, un jaque o un mate; o vos tenías una captura,
   jaque o promoción ganadora y no la jugaste.
3. **Error de apertura**: hasta la jugada 10, sin táctica de por medio.
4. **Final mal jugado**: material pesado (sin peones ni reyes) de ambos bandos ≤ 24 (en la posición inicial es 62).
5. **Medio juego**: el resto (error posicional).

## Licencia

GPLv3 (ver `LICENSE`). Stockfish.js es GPLv3, por eso todo el proyecto se publica bajo la misma licencia.
chess.js es BSD-2-Clause.
