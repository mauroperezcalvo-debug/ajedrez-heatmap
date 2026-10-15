import { Chess } from '../vendor/chess.js';
import { leer, guardar } from './cache.js';

export const MATE = 1000; // tope en centipeones; los mates se tratan como ±1000
const PERDIDA_MINIMA = 50; // por debajo de esto no se guarda como "error"

const limitar = (cp) => Math.max(-MATE, Math.min(MATE, cp));
const fen4 = (fen) => fen.split(' ').slice(0, 4).join(' ');

// Material "pesado" (sin peones ni reyes) de ambos bandos; la posición inicial suma 62.
const VALOR_PIEZA = { n: 3, b: 3, r: 5, q: 9 };
function materialPesado(fen) {
  let total = 0;
  for (const ch of fen.split(' ')[0].toLowerCase()) total += VALOR_PIEZA[ch] || 0;
  return total;
}

export function dividirPGN(texto) {
  const t = texto.replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  if (!/^\[Event /m.test(t)) return [t];
  return t.split(/\n(?=\[Event )/).map((s) => s.trim()).filter(Boolean);
}

// Devuelve la partida lista para analizar, o lanza si el PGN es inválido.
export function parsearPartida(texto, id, usuarios) {
  const c = new Chess();
  c.loadPgn(texto);
  const cab = c.getHeaders();
  const jugadas = c.history({ verbose: true });
  if (jugadas.length === 0) throw new Error('sin jugadas');

  const nombres = usuarios.map((u) => u.trim().toLowerCase()).filter(Boolean);
  const lados = new Set();
  if (nombres.length === 0) {
    lados.add('w');
    lados.add('b');
  } else {
    if (nombres.includes(String(cab.White || '').toLowerCase())) lados.add('w');
    if (nombres.includes(String(cab.Black || '').toLowerCase())) lados.add('b');
  }

  return {
    id,
    blancas: cab.White || '?',
    negras: cab.Black || '?',
    resultado: cab.Result || '*',
    fecha: cab.Date || '',
    eloPGN: { w: parseInt(cab.WhiteElo, 10) || null, b: parseInt(cab.BlackElo, 10) || null },
    lados,
    jugadas,
    fens: [jugadas[0].before, ...jugadas.map((m) => m.after)],
    evals: null,
    errores: [],
  };
}

// Evalúa todas las posiciones de la partida. Devuelve false si se canceló.
export async function analizarPartida(partida, motor, profundidad, alPosicion, cancelado) {
  const evals = [];
  const ultima = partida.fens.length - 1;

  for (let i = 0; i <= ultima; i++) {
    if (cancelado()) return false;
    const fen = partida.fens[i];
    const turno = fen.split(' ')[1];
    let ev;

    if (i === ultima && new Chess(fen).isGameOver()) {
      const mate = new Chess(fen).isCheckmate();
      ev = { cp: mate ? (turno === 'w' ? -MATE : MATE) : 0, best: null };
    } else {
      const clave = profundidad + '|' + fen4(fen);
      let crudo = await leer(clave);
      if (!crudo) {
        crudo = await motor.evaluar(fen4(fen), profundidad);
        if (cancelado()) return false;
        await guardar(clave, crudo);
      }
      // pasar a perspectiva de las blancas
      let cp = crudo.mate !== null ? Math.sign(crudo.mate) * MATE : limitar(crudo.cp ?? 0);
      if (turno === 'b') cp = -cp;
      ev = { cp, best: crudo.best };
    }
    evals.push(ev);
    alPosicion();
  }

  partida.evals = evals;
  partida.errores = construirErrores(partida);
  partida.calidad = calcularCalidad(partida);
  return true;
}

// ---------- Nivel estimado ----------

const PERDIDA_TOPE = 500; // una jugada no suma más que esto al promedio
const JUGADAS_DE_LIBRO = 5; // las primeras jugadas de cada bando no cuentan

// Elo aproximado a partir de la pérdida media por jugada (ACPL):
// fórmula empírica Elo ≈ 3100·e^(−0,01·ACPL). Es una referencia, no una medición:
// depende de la profundidad usada y de pocas jugadas por partida.
export function estimarElo(acpl) {
  return Math.round((3100 * Math.exp(-0.01 * acpl)) / 50) * 50;
}

// Suma de pérdidas y cantidad de jugadas por color; se juntan después entre partidas.
function calcularCalidad(partida) {
  const q = { w: { suma: 0, n: 0 }, b: { suma: 0, n: 0 } };
  partida.jugadas.forEach((m, i) => {
    if (Math.floor(i / 2) + 1 <= JUGADAS_DE_LIBRO) return;
    const signo = m.color === 'w' ? 1 : -1;
    const perdida = Math.max(0, (partida.evals[i].cp - partida.evals[i + 1].cp) * signo);
    q[m.color].suma += Math.min(PERDIDA_TOPE, perdida);
    q[m.color].n++;
  });
  return q;
}

// Jugadas del usuario que perdieron al menos PERDIDA_MINIMA centipeones.
function construirErrores(partida) {
  const out = [];
  const { jugadas, evals } = partida;

  jugadas.forEach((m, i) => {
    if (!partida.lados.has(m.color)) return;
    const signo = m.color === 'w' ? 1 : -1;
    const antes = evals[i].cp * signo;
    const despues = evals[i + 1].cp * signo;
    const perdida = antes - despues;
    if (perdida < PERDIDA_MINIMA) return;

    // Clasificación (en orden de prioridad):
    //  colgada: la mejor respuesta del rival captura una pieza tuya y no podés recapturar
    //  tactica: el rival tiene captura con recaptura, jaque o mate; o vos tenías una
    //           captura/jaque/promoción ganadora y no la jugaste
    //  apertura / final / medio: error "quieto", según la fase
    let colgada = null;
    let tactica = false;
    const respuesta = evals[i + 1].best;
    if (respuesta) {
      const pos = new Chess(m.after);
      const rep = pos.moves({ verbose: true }).find((x) => x.from + x.to === respuesta.slice(0, 4));
      if (rep) {
        if (rep.captured && !/#/.test(rep.san)) {
          pos.move({ from: rep.from, to: rep.to, promotion: rep.promotion });
          const recaptura = pos.moves({ verbose: true }).some((x) => x.to === rep.to && x.captured);
          if (recaptura) tactica = true; else colgada = { sq: rep.to, pieza: rep.captured };
        } else if (/[+#]/.test(rep.san)) {
          tactica = true;
        }
      }
    }
    if (!colgada && !tactica && evals[i].best) {
      const mejorJugada = new Chess(m.before).moves({ verbose: true })
        .find((x) => x.from + x.to === evals[i].best.slice(0, 4));
      if (mejorJugada && (mejorJugada.captured || mejorJugada.promotion || /[+#]/.test(mejorJugada.san))) tactica = true;
    }
    const num = Math.floor(i / 2) + 1;
    let tipo = 'medio';
    if (colgada) tipo = 'colgada';
    else if (tactica) tipo = 'tactica';
    else if (num <= 10) tipo = 'apertura';
    else if (materialPesado(m.before) <= 24) tipo = 'final';

    out.push({
      partida,
      num,
      tipo,
      color: m.color,
      san: m.san,
      from: m.from,
      to: m.to,
      pieza: m.piece,
      perdida,
      antes,
      despues,
      mejor: evals[i].best,
      colgada,
      fen: m.before,
    });
  });

  return out;
}
