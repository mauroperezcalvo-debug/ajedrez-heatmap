// Envoltorio mínimo de Stockfish (UCI sobre postMessage) corriendo en un Web Worker.
// Los puntajes devueltos son desde el punto de vista del bando que mueve.

export class Motor {
  constructor(ruta) {
    this.w = new Worker(ruta);
    this.fallo = null;
    this.w.addEventListener('error', (e) => { this.fallo = e.message || 'no se pudo cargar el motor'; });
    this.listo = this._iniciar();
  }

  _enviar(cmd) {
    this.w.postMessage(cmd);
  }

  _iniciar() {
    return new Promise((resolver) => {
      const escuchar = (e) => {
        const linea = typeof e.data === 'string' ? e.data : '';
        if (linea === 'uciok') this._enviar('isready');
        if (linea === 'readyok') {
          this.w.removeEventListener('message', escuchar);
          resolver();
        }
      };
      this.w.addEventListener('message', escuchar);
      this._enviar('uci');
    });
  }

  // Devuelve { cp, mate, best } (cp o mate es null según corresponda; best en notación UCI).
  async evaluar(fen, profundidad) {
    await this.listo;
    return new Promise((resolver) => {
      let cp = null;
      let mate = null;
      const escuchar = (e) => {
        const linea = e.data;
        if (typeof linea !== 'string') return;
        if (linea.startsWith('info') && linea.includes(' score ')) {
          const m = linea.match(/score (cp|mate) (-?\d+)/);
          if (m) {
            if (m[1] === 'cp') { cp = +m[2]; mate = null; } else { mate = +m[2]; cp = null; }
          }
        } else if (linea.startsWith('bestmove')) {
          this.w.removeEventListener('message', escuchar);
          const mejor = linea.split(' ')[1];
          resolver({ cp, mate, best: !mejor || mejor === '(none)' ? null : mejor });
        }
      };
      this.w.addEventListener('message', escuchar);
      this._enviar('position fen ' + fen);
      this._enviar('go depth ' + profundidad);
    });
  }

  detener() {
    this._enviar('stop');
  }
}
