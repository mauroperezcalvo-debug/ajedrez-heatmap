import { Chess } from '../vendor/chess.js';
import { Motor } from './motor.js';
import { vaciar } from './cache.js';
import { dividirPGN, parsearPartida, analizarPartida, estimarElo } from './analisis.js';
import { dibujarTablero } from './tablero.js';

const $ = (id) => document.getElementById(id);
const RUTA_MOTOR = 'vendor/sf19-lite.js';

let motor = null;
let partidas = [];
let cancelar = false;
let ocupado = false;
let cuadroSel = null;
let errorSel = null;

const FASES = { ap: [1, 10], me: [11, 30], fi: [31, 999] };

function recordar(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ }
}
function recuperar(clave) {
  try { return localStorage.getItem(clave) || ''; } catch (e) { return ''; }
}

function fmtEval(cp, mate) {
  if (mate !== null && mate !== undefined) return '#' + mate;
  const v = cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

// ---------- Análisis ----------

async function cargarTextos() {
  const textos = [];
  for (const f of $('archivos').files) textos.push(await f.text());
  if ($('pegado').value.trim()) textos.push($('pegado').value);
  return textos;
}

async function analizar() {
  if (ocupado) return;
  const textos = await cargarTextos();
  if (textos.length === 0) { $('estado').textContent = 'Subí al menos un archivo PGN o pegá uno.'; return; }

  const usuarios = $('usuario').value.split(',');
  recordar('usuario', $('usuario').value);

  const nuevas = [];
  let invalidas = 0;
  let sinUsuario = 0;
  textos.flatMap(dividirPGN).forEach((txt) => {
    try {
      const p = parsearPartida(txt, nuevas.length, usuarios);
      if (p.lados.size === 0) sinUsuario++; else nuevas.push(p);
    } catch (e) { invalidas++; }
  });

  if (nuevas.length === 0) {
    $('estado').textContent = 'No hay partidas para analizar. ' + (sinUsuario ? sinUsuario + ' no tienen a ese usuario (revisá cómo se escribe en el PGN). ' : '') + (invalidas ? invalidas + ' PGN inválidos.' : '');
    return;
  }

  $('estado').textContent = 'Cargando Stockfish…';
  if (!motor) motor = new Motor(RUTA_MOTOR);
  const arranco = await Promise.race([motor.listo.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
  if (!arranco) {
    $('estado').textContent = 'No se pudo cargar Stockfish' + (motor.fallo ? ' (' + motor.fallo + ')' : '') + '. Abrí la consola del navegador (F12) para ver el detalle.';
    motor = null;
    return;
  }
  partidas = [];
  cuadroSel = null;
  errorSel = null;
  cancelar = false;
  ocupado = true;
  $('analizar').hidden = true;
  $('cancelar').hidden = false;
  $('progreso').hidden = false;
  $('resultados').hidden = false;
  $('detalle').hidden = true;

  const total = nuevas.reduce((s, p) => s + p.fens.length, 0);
  let hechas = 0;
  $('progreso').max = total;
  const profundidad = +$('prof').value;
  const avisos = () => (sinUsuario ? ' · ' + sinUsuario + ' sin tu usuario' : '') + (invalidas ? ' · ' + invalidas + ' PGN inválidos' : '');

  for (let i = 0; i < nuevas.length; i++) {
    const ok = await analizarPartida(nuevas[i], motor, profundidad, () => {
      hechas++;
      $('progreso').value = hechas;
      $('estado').textContent = 'Partida ' + (i + 1) + ' de ' + nuevas.length + ' · posición ' + hechas + ' de ' + total + avisos();
    }, () => cancelar);
    if (!ok) break;
    partidas.push(nuevas[i]);
    actualizar();
  }

  $('estado').textContent = (cancelar ? 'Cancelado. ' : 'Listo. ') + partidas.length + ' partidas analizadas' + avisos() + '.';
  ocupado = false;
  $('analizar').hidden = false;
  $('cancelar').hidden = true;
  $('progreso').hidden = true;
}

// ---------- Mapa de calor ----------

// paraCausas: ignora los filtros de tipo y de modo, para que los porcentajes sumen 100%.
function erroresFiltrados(paraCausas = false) {
  const umbral = +$('umbral').value;
  const color = $('fColor').value;
  const fase = $('fFase').value;
  const pieza = $('fPieza').value;
  const modo = $('modo').value;
  const tipo = $('fTipo').value;
  const out = [];
  for (const p of partidas) {
    for (const e of p.errores) {
      if (e.perdida < umbral) continue;
      if (color !== 'todos' && e.color !== color) continue;
      if (fase !== 'todas' && (e.num < FASES[fase][0] || e.num > FASES[fase][1])) continue;
      if (pieza !== 'todas' && e.pieza !== pieza) continue;
      if (!paraCausas && modo === 'colgadas' && !e.colgada) continue;
      if (!paraCausas && tipo !== 'todos' && e.tipo !== tipo) continue;
      out.push(e);
    }
  }
  return out;
}

// ---------- Nivel estimado ----------

const MIN_JUGADAS_NIVEL = 5;

function celdaNivel(p, color) {
  const td = document.createElement('td');
  const nombre = color === 'w' ? p.blancas : p.negras;
  const q = p.calidad[color];
  if (p.lados.has(color) && p.lados.size === 1) td.className = 'yo';
  td.append(nombre);
  const sub = document.createElement('span');
  sub.className = 'sub';
  if (q.n < MIN_JUGADAS_NIVEL) {
    sub.textContent = 'partida muy corta';
  } else {
    const acpl = q.suma / q.n;
    sub.textContent = `ACPL ${Math.round(acpl)} · ≈ ${estimarElo(acpl)}` + (p.eloPGN[color] ? ` (PGN: ${p.eloPGN[color]})` : '');
  }
  td.appendChild(sub);
  return td;
}

function dibujarNivel() {
  const cont = $('nivel');
  cont.hidden = partidas.length === 0;
  if (partidas.length === 0) return;

  // promedio sobre tus jugadas (respeta el filtro de color)
  const color = $('fColor').value;
  let suma = 0;
  let n = 0;
  let cuenta = 0;
  for (const p of partidas) {
    let aporto = false;
    for (const c of ['w', 'b']) {
      if (!p.lados.has(c) || (color !== 'todos' && color !== c)) continue;
      suma += p.calidad[c].suma;
      n += p.calidad[c].n;
      aporto = true;
    }
    if (aporto) cuenta++;
  }
  if (n < MIN_JUGADAS_NIVEL) {
    $('nivelResumen').textContent = 'Todavía no hay jugadas suficientes para estimar tu nivel.';
  } else {
    const acpl = suma / n;
    $('nivelResumen').textContent = `Tu nivel estimado: ≈ ${estimarElo(acpl)} Elo (pérdida media de ${Math.round(acpl)} centipeones por jugada, sobre ${n} jugadas de ${cuenta} partidas).`;
  }

  const filas = partidas.map((p) => {
    const tr = document.createElement('tr');
    const t = document.createElement('td');
    t.textContent = `${p.fecha && !p.fecha.includes('?') ? p.fecha : 'sin fecha'} · ${p.resultado}`;
    tr.append(t, celdaNivel(p, 'w'), celdaNivel(p, 'b'));
    return tr;
  });
  $('nivelTabla').tBodies[0].replaceChildren(...filas);
}

// ---------- Causas de los errores ----------

const TIPOS = {
  colgada: { nombre: 'Pieza colgada', corto: 'colgada', ayuda: 'El rival se la lleva gratis, sin recaptura.' },
  tactica: { nombre: 'Táctica', corto: 'táctica', ayuda: 'Captura con recaptura, jaque o mate del rival, o una captura/jaque ganador tuyo que no jugaste.' },
  apertura: { nombre: 'Error de apertura', corto: 'apertura', ayuda: 'Jugada floja hasta la jugada 10, sin táctica de por medio.' },
  medio: { nombre: 'Medio juego', corto: 'medio juego', ayuda: 'Error posicional en el medio juego.' },
  final: { nombre: 'Final mal jugado', corto: 'final', ayuda: 'Error con poco material en el tablero (sin damas ni piezas pesadas de sobra).' },
};
const PIEZA_PLURAL = { p: 'peones', n: 'caballos', b: 'alfiles', r: 'torres', q: 'damas', k: 'rey' };
const PIEZA_JUGADA = { p: 'de peón', n: 'de caballo', b: 'de alfil', r: 'de torre', q: 'de dama', k: 'de rey' };

function masFrecuente(valores) {
  const cuenta = {};
  for (const v of valores) cuenta[v] = (cuenta[v] || 0) + 1;
  return Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0];
}

function dibujarCausas() {
  const errs = erroresFiltrados(true);
  const total = errs.length;
  const activo = $('fTipo').value;
  const cont = $('causas');
  cont.hidden = total === 0;
  if (total === 0) return;

  const filas = Object.keys(TIPOS).map((t) => {
    const n = errs.filter((e) => e.tipo === t).length;
    const pct = Math.round((100 * n) / total);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'causa' + (activo === t ? ' activa' : '');
    b.title = TIPOS[t].ayuda;
    const nombre = document.createElement('span');
    nombre.textContent = TIPOS[t].nombre;
    const pista = document.createElement('span');
    pista.className = 'pista';
    const relleno = document.createElement('span');
    relleno.className = 'relleno t-' + t;
    relleno.style.width = pct + '%';
    pista.appendChild(relleno);
    const cifra = document.createElement('span');
    cifra.className = 'cifra';
    cifra.textContent = `${n} · ${pct}%`;
    b.append(nombre, pista, cifra);
    b.addEventListener('click', () => {
      $('fTipo').value = activo === t ? 'todos' : t;
      cuadroSel = null;
      actualizar();
    });
    return b;
  });

  const principal = Object.keys(TIPOS).sort((a, b) => errs.filter((e) => e.tipo === b).length - errs.filter((e) => e.tipo === a).length)[0];
  const deEsteTipo = errs.filter((e) => e.tipo === principal);
  const pct = Math.round((100 * deEsteTipo.length) / total);
  let frase = `El ${pct}% de tus errores (${deEsteTipo.length} de ${total}) son de tipo «${TIPOS[principal].nombre.toLowerCase()}»`;
  if (principal === 'colgada') frase += ', sobre todo ' + PIEZA_PLURAL[masFrecuente(deEsteTipo.map((e) => e.colgada.pieza))];
  else frase += ', sobre todo con jugadas ' + PIEZA_JUGADA[masFrecuente(deEsteTipo.map((e) => e.pieza))];
  const fraseEl = document.createElement('p');
  fraseEl.className = 'frase';
  fraseEl.textContent = frase + '.';

  cont.replaceChildren(fraseEl, ...filas);
}

const casillaDe = (e) => ($('modo').value === 'colgadas' ? e.colgada.sq : e.to);

function actualizar() {
  const errores = erroresFiltrados();
  const porCasilla = new Map();
  for (const e of errores) {
    const sq = casillaDe(e);
    const a = porCasilla.get(sq) || { n: 0, suma: 0 };
    a.n++;
    a.suma += e.perdida;
    porCasilla.set(sq, a);
  }
  const maximo = Math.max(1, ...[...porCasilla.values()].map((a) => a.n));

  const colores = new Map();
  const titulos = new Map();
  const etiquetas = new Map();
  for (const [sq, a] of porCasilla) {
    const t = a.n / maximo;
    colores.set(sq, `rgba(220, ${Math.round(150 * (1 - t)) + 20}, 30, ${(0.3 + 0.6 * t).toFixed(2)})`);
    titulos.set(sq, `${sq}: ${a.n} ${a.n === 1 ? 'error' : 'errores'}, pérdida media ${Math.round(a.suma / a.n)} cp`);
    etiquetas.set(sq, String(a.n));
  }

  dibujarTablero($('mapa'), {
    invertido: $('invertir').checked, colores, titulos, etiquetas, seleccion: cuadroSel,
    alClick: (sq) => { cuadroSel = cuadroSel === sq ? null : sq; actualizar(); },
  });

  dibujarCausas();
  dibujarNivel();

  const jugadas = partidas.reduce((s, p) => s + p.jugadas.filter((m) => p.lados.has(m.color)).length, 0);
  const colgadas = errores.filter((e) => e.colgada).length;
  $('resumen').textContent = `${partidas.length} partidas · ${jugadas} jugadas tuyas · ${errores.length} errores en el filtro (${colgadas} con pieza perdida).`;

  const lista = errores.filter((e) => !cuadroSel || casillaDe(e) === cuadroSel).sort((a, b) => b.perdida - a.perdida).slice(0, 30);
  $('tituloLista').textContent = cuadroSel ? 'Peores jugadas en ' + cuadroSel : 'Peores jugadas';
  $('lista').replaceChildren(...lista.map(itemLista));
}

function itemLista(e) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  const p = e.partida;
  const rival = e.color === 'w' ? p.negras : p.blancas;
  b.textContent = `${e.num}${e.color === 'w' ? '.' : '…'} ${e.san} vs ${rival} · −${(e.perdida / 100).toFixed(1)}`;
  b.addEventListener('click', () => mostrarDetalle(e));
  li.appendChild(b);
  const tag = document.createElement('span');
  tag.className = 'tag t-' + e.tipo;
  tag.textContent = TIPOS[e.tipo].corto;
  li.appendChild(tag);
  return li;
}

// ---------- Detalle de una posición ----------

function sanDe(fen, uci) {
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m.san;
  } catch (err) { return uci; }
}

function mostrarDetalle(e) {
  errorSel = e;
  $('detalle').hidden = false;
  $('profundoTexto').textContent = '';
  const flechas = [{ from: e.from, to: e.to, color: '#c62828' }];
  if (e.mejor) flechas.push({ from: e.mejor.slice(0, 2), to: e.mejor.slice(2, 4), color: '#2e7d32' });
  dibujarTablero($('mapaDetalle'), { fen: e.fen, invertido: e.color === 'b', flechas });

  const p = e.partida;
  let txt = `Tipo: ${TIPOS[e.tipo].nombre.toLowerCase()}. ${p.blancas} - ${p.negras} (${p.resultado}${p.fecha ? ', ' + p.fecha : ''}). Jugaste ${e.san} (rojo): la evaluación pasó de ${fmtEval(e.antes)} a ${fmtEval(e.despues)} desde tu punto de vista.`;
  if (e.mejor) txt += ` Stockfish prefería ${sanDe(e.fen, e.mejor)} (verde).`;
  $('detalleTexto').textContent = txt;
  $('detalle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function profundizar() {
  if (!errorSel || ocupado) return;
  if (!motor) motor = new Motor(RUTA_MOTOR);
  ocupado = true;
  $('profundoTexto').textContent = 'Pensando…';
  const r = await motor.evaluar(errorSel.fen.split(' ').slice(0, 4).join(' '), 20);
  ocupado = false;
  // la posición es antes de la jugada del usuario: mueve él, el puntaje ya está de su lado
  $('profundoTexto').textContent = `Profundidad 20: ${fmtEval(r.cp, r.mate)}` + (r.best ? `, mejor jugada ${sanDe(errorSel.fen, r.best)}.` : '.');
}

// ---------- Eventos ----------

$('usuario').value = recuperar('usuario');
$('analizar').addEventListener('click', analizar);
$('cancelar').addEventListener('click', () => { cancelar = true; if (motor) motor.detener(); });
$('profundizar').addEventListener('click', profundizar);
$('limpiar').addEventListener('click', async () => { await vaciar(); $('estado').textContent = 'Caché vaciada.'; });
['modo', 'umbral', 'fColor', 'fFase', 'fPieza', 'fTipo', 'invertir'].forEach((id) => {
  $(id).addEventListener('change', () => {
    if (id === 'fColor') $('invertir').checked = $('fColor').value === 'b';
    cuadroSel = null;
    actualizar();
  });
});
