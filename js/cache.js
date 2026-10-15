// Caché de evaluaciones en IndexedDB (con respaldo en memoria si el navegador no la deja usar).

const memoria = new Map();
let dbPromesa = null;

function abrir() {
  if (!dbPromesa) {
    dbPromesa = new Promise((resolver, rechazar) => {
      try {
        const req = indexedDB.open('heatmap-ajedrez', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('evals');
        req.onsuccess = () => resolver(req.result);
        req.onerror = () => rechazar(req.error);
      } catch (err) {
        rechazar(err);
      }
    }).catch(() => null);
  }
  return dbPromesa;
}

function pedir(db, modo, fn) {
  return new Promise((resolver) => {
    try {
      const tx = db.transaction('evals', modo);
      const req = fn(tx.objectStore('evals'));
      tx.oncomplete = () => resolver(req ? req.result : undefined);
      tx.onerror = () => resolver(undefined);
    } catch (err) {
      resolver(undefined);
    }
  });
}

export async function leer(clave) {
  if (memoria.has(clave)) return memoria.get(clave);
  const db = await abrir();
  if (!db) return undefined;
  const valor = await pedir(db, 'readonly', (s) => s.get(clave));
  if (valor !== undefined) memoria.set(clave, valor);
  return valor;
}

export async function guardar(clave, valor) {
  memoria.set(clave, valor);
  const db = await abrir();
  if (db) await pedir(db, 'readwrite', (s) => s.put(valor, clave));
}

export async function vaciar() {
  memoria.clear();
  const db = await abrir();
  if (db) await pedir(db, 'readwrite', (s) => s.clear());
}
