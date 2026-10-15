// Dibujo del tablero en SVG: piezas, mapa de calor por casilla y flechas.

const NS = 'http://www.w3.org/2000/svg';
const GLIFOS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function el(tag, attrs, texto) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (texto !== undefined) e.textContent = texto;
  return e;
}

export function parsearFEN(fen) {
  const piezas = new Map();
  fen.split(' ')[0].split('/').forEach((fila, r) => {
    let f = 0;
    for (const ch of fila) {
      if (/\d/.test(ch)) f += +ch;
      else { piezas.set(String.fromCharCode(97 + f) + (8 - r), ch); f++; }
    }
  });
  return piezas;
}

// colores: Map casilla -> color CSS (capa del mapa de calor)
// titulos: Map casilla -> texto del tooltip
// etiquetas: Map casilla -> texto corto dibujado en la casilla
export function dibujarTablero(svg, opc = {}) {
  const { fen = null, invertido = false, colores = new Map(), titulos = new Map(),
    etiquetas = new Map(), seleccion = null, flechas = [], alClick = null } = opc;

  svg.replaceChildren();
  svg.setAttribute('viewBox', '0 0 800 800');
  const piezas = fen ? parsearFEN(fen) : new Map();
  const pos = (sq) => {
    let f = sq.charCodeAt(0) - 97;
    let r = +sq[1] - 1;
    if (invertido) { f = 7 - f; r = 7 - r; }
    return { x: f * 100, y: (7 - r) * 100 };
  };

  for (let rango = 1; rango <= 8; rango++) {
    for (let f = 0; f < 8; f++) {
      const sq = String.fromCharCode(97 + f) + rango;
      const { x, y } = pos(sq);
      const g = el('g', {});
      if (alClick) { g.style.cursor = 'pointer'; g.addEventListener('click', () => alClick(sq)); }
      if (titulos.has(sq)) g.appendChild(el('title', {}, titulos.get(sq)));

      const clara = (f + rango) % 2 === 0;
      g.appendChild(el('rect', { x, y, width: 100, height: 100, fill: clara ? '#dfe3e8' : '#9aa5b1' }));
      if (colores.has(sq)) g.appendChild(el('rect', { x, y, width: 100, height: 100, fill: colores.get(sq) }));
      if (seleccion === sq) {
        g.appendChild(el('rect', { x: x + 4, y: y + 4, width: 92, height: 92, fill: 'none', stroke: '#0b57d0', 'stroke-width': 8 }));
      }
      if (x === 0) g.appendChild(el('text', { x: x + 6, y: y + 20, 'font-size': 18, fill: '#334', 'pointer-events': 'none' }, String(rango)));
      if (y === 700) g.appendChild(el('text', { x: x + 94, y: y + 94, 'font-size': 18, fill: '#334', 'text-anchor': 'end', 'pointer-events': 'none' }, String.fromCharCode(97 + f)));

      const p = piezas.get(sq);
      if (p) {
        const blanca = p === p.toUpperCase();
        g.appendChild(el('text', {
          x: x + 50, y: y + 54, 'font-size': 78, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          fill: blanca ? '#ffffff' : '#111111', stroke: blanca ? '#222' : '#fff',
          'stroke-width': blanca ? 3 : 1.2, 'pointer-events': 'none',
        }, GLIFOS[p.toLowerCase()] + '︎'));
      }
      if (etiquetas.has(sq)) {
        g.appendChild(el('text', {
          x: x + 50, y: y + 56, 'font-size': 44, 'font-weight': 700, 'text-anchor': 'middle',
          'dominant-baseline': 'central', fill: '#fff', stroke: '#000', 'stroke-width': 1.5,
          'paint-order': 'stroke', 'pointer-events': 'none',
        }, etiquetas.get(sq)));
      }
      svg.appendChild(g);
    }
  }

  for (const fl of flechas) {
    const a = pos(fl.from);
    const b = pos(fl.to);
    const x1 = a.x + 50, y1 = a.y + 50, x2 = b.x + 50, y2 = b.y + 50;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const punta = { x: x2 - cos * 8, y: y2 - sin * 8 };
    const base = { x: punta.x - cos * 40, y: punta.y - sin * 40 };
    svg.appendChild(el('line', { x1, y1, x2: base.x, y2: base.y, stroke: fl.color, 'stroke-width': 14, opacity: 0.85, 'pointer-events': 'none' }));
    svg.appendChild(el('polygon', {
      points: `${punta.x},${punta.y} ${base.x - sin * 22},${base.y + cos * 22} ${base.x + sin * 22},${base.y - cos * 22}`,
      fill: fl.color, opacity: 0.85, 'pointer-events': 'none',
    }));
  }
}
