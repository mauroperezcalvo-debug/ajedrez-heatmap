import { Chess } from '../vendor/chess.js';
import { leer, guardar } from './cache.js';

export const MATE = 1000; // tope en centipeones; los mates se tratan como ±1000
const PERDIDA_MINIMA = 50; // por debajo de esto no se guarda como "error"

const limitar = (cp) => Math.max(-MATE, Math.min(MATE, cp));
const fen4 = (fen) => fen.split(' ').slice(0, 4).join(' ');

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
  return true;
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

    // ¿La mejor respuesta del rival captura una pieza? -> pieza colgada / perdida
    let colgada = null;
    const respuesta = evals[i + 1].best;
    if (respuesta) {
      const rep = new Chess(m.after).moves({ verbose: true })
        .find((x) => x.from + x.to === respuesta.slice(0, 4));
      if (rep && rep.captured) colgada = { sq: rep.to, pieza: rep.captured };
    }

    out.push({
      partida,
      num: Math.floor(i / 2) + 1,
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
