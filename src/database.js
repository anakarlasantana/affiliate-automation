/**
 * database.js
 * Deduplicação de ofertas com SQLite (better-sqlite3).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'ofertas.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS fila_envio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja TEXT,
    titulo TEXT,
    mensagem TEXT NOT NULL,
    url_limpa TEXT,
    chave_final TEXT,
    imagem_base64 TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ofertas_enviadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_limpa TEXT UNIQUE NOT NULL,
    data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

const stmtBusca = db.prepare('SELECT 1 FROM ofertas_enviadas WHERE url_limpa = ? LIMIT 1');
const stmtInsere = db.prepare('INSERT OR IGNORE INTO ofertas_enviadas (url_limpa) VALUES (?)');
const stmtContaHoje = db.prepare(
  "SELECT COUNT(*) AS total FROM ofertas_enviadas WHERE DATE(data_envio, 'localtime') = DATE('now', 'localtime')"
);

/**
 * @param {string} urlLimpa
 * @returns {boolean} true se a URL já foi enviada.
 */
export function jaFoiEnviada(urlLimpa) {
  return !!stmtBusca.get(urlLimpa);
}

/**
 * Registra a URL limpa após envio bem-sucedido.
 * @param {string} urlLimpa
 */
export function registrarEnvio(urlLimpa) {
  stmtInsere.run(urlLimpa);
}

/**
 * Quantas ofertas já foram enviadas hoje (para o limite diário).
 * @returns {number}
 */
export function contarEnviosHoje() {
  return stmtContaHoje.get().total;
}

/* ================= Fila persistente de envios ================= */

const stmtFilaInsere = db.prepare(
  'INSERT INTO fila_envio (loja, titulo, mensagem, url_limpa, chave_final, imagem_base64) VALUES (?, ?, ?, ?, ?, ?)'
);
const stmtFilaLista = db.prepare('SELECT * FROM fila_envio ORDER BY id ASC');
const stmtFilaRemove = db.prepare('DELETE FROM fila_envio WHERE id = ?');

/**
 * Persiste um item na fila (sobrevive a reinicio do app).
 * @returns {number} id da linha (usado para remover apos o envio).
 */
export function enfileirarDb({ loja = '', titulo = '', mensagem, urlLimpa = '', chaveFinal = '', imagemBase64 = null }) {
  return stmtFilaInsere.run(loja, titulo, mensagem, urlLimpa, chaveFinal, imagemBase64).lastInsertRowid;
}

/** Lista os itens pendentes da fila, na ordem de chegada. */
export function listarFilaDb() {
  return stmtFilaLista.all();
}

/** Remove um item da fila apos envio bem-sucedido. */
export function removerDaFilaDb(id) {
  stmtFilaRemove.run(id);
}
