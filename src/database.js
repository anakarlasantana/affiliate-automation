/**
 * database.js
 * Deduplicação de ofertas com SQLite (better-sqlite3).
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_DIR, inicioDoDiaOperacional } from './config.js';

const db = new Database(path.join(DATA_DIR, 'ofertas.db'));
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
    origem_foto TEXT DEFAULT '',
    meu_link TEXT DEFAULT '',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS fila_espera_midia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja TEXT,
    titulo TEXT,
    mensagem TEXT NOT NULL,
    url_limpa TEXT,
    chave_final TEXT,
    meu_link TEXT DEFAULT '',
    msg_id TEXT DEFAULT '',
    chat_id TEXT DEFAULT '',
    origem TEXT DEFAULT '',
    tentativas INTEGER NOT NULL DEFAULT 0,
    deadline TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ofertas_enviadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_limpa TEXT UNIQUE NOT NULL,
    contabiliza INTEGER NOT NULL DEFAULT 1,
    data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migração idempotente: `contabiliza` separa DEDUPLICAÇÃO (0) de ENVIO (1).
// Antes, cada oferta gravava 2 linhas (URL limpa + chave do produto) e as duas
// contavam no limite diário — o MAX_ENVIOS_DIA valia pela metade.
const colunasOfertas = db.prepare('PRAGMA table_info(ofertas_enviadas)').all();
if (!colunasOfertas.some((coluna) => coluna.name === 'contabiliza')) {
  db.transaction(() => {
    db.exec('ALTER TABLE ofertas_enviadas ADD COLUMN contabiliza INTEGER NOT NULL DEFAULT 1');
    // Histórico: mantém contável só a 1ª linha de cada segundo — a fila
    // anti-ban nunca envia duas ofertas no mesmo segundo.
    db.exec(
      `UPDATE ofertas_enviadas SET contabiliza = 0
       WHERE id NOT IN (SELECT MIN(id) FROM ofertas_enviadas GROUP BY data_envio)`
    );
  })();
  console.log('🗃️  Migração: deduplicação x contagem diária separadas.');
}

// Migração idempotente: origem da foto + meu link na fila (cascata de imagem).
for (const [col, tipo] of [['origem_foto', 'TEXT DEFAULT \'\''], ['meu_link', 'TEXT DEFAULT \'\'']]) {
  const cols = db.prepare('PRAGMA table_info(fila_envio)').all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE fila_envio ADD COLUMN ${col} ${tipo}`);
    console.log(`🗃️  Migração: coluna fila_envio.${col} criada.`);
  }
}

const stmtBusca = db.prepare('SELECT 1 FROM ofertas_enviadas WHERE url_limpa = ? LIMIT 1');
const stmtInsere = db.prepare('INSERT OR IGNORE INTO ofertas_enviadas (url_limpa, contabiliza) VALUES (?, ?)');
// A virada do dia usa o FUSO DE OPERACAO (config), nao o fuso do servidor:
// num VPS em UTC o limite diario zeraria as 21h de Brasilia.
const stmtContaHoje = db.prepare(
  'SELECT COUNT(*) AS total FROM ofertas_enviadas WHERE contabiliza = 1 AND data_envio >= ?'
);

/**
 * A chave (URL limpa ou identidade do produto, ex.: "produto:meli:MLB123")
 * já foi divulgada?
 * @param {string} chave
 * @returns {boolean} true se a chave já foi enviada.
 */
export function jaFoiEnviada(chave) {
  return !!stmtBusca.get(chave);
}

/**
 * Registra uma chave após envio bem-sucedido.
 * @param {string} chave URL limpa ou identidade do produto
 * @param {boolean} contabiliza true = conta no limite diário (apenas a chave
 *   principal da oferta; as demais servem só para deduplicação).
 */
export function registrarEnvio(chave, contabiliza = true) {
  stmtInsere.run(chave, contabiliza ? 1 : 0);
}

/**
 * Quantas ofertas já foram enviadas hoje (para o limite diário).
 * @returns {number}
 */
export function contarEnviosHoje() {
  return stmtContaHoje.get(inicioDoDiaOperacional()).total;
}

/* ================= Fila persistente de envios ================= */

const stmtFilaInsere = db.prepare(
  'INSERT INTO fila_envio (loja, titulo, mensagem, url_limpa, chave_final, imagem_base64, origem_foto, meu_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const stmtFilaLista = db.prepare('SELECT * FROM fila_envio ORDER BY id ASC');
const stmtFilaRemove = db.prepare('DELETE FROM fila_envio WHERE id = ?');

/**
 * Persiste um item na fila (sobrevive a reinicio do app).
 * @returns {number} id da linha (usado para remover apos o envio).
 */
export function enfileirarDb({ loja = '', titulo = '', mensagem = null, mensagemFinal = null, urlLimpa = '', chaveFinal = '', imagemBase64 = null, origemFoto = '', meuLink = '' }) {
  const texto = mensagem || mensagemFinal;
  if (!texto) throw new Error('enfileirarDb: item sem texto de mensagem (mensagem/mensagemFinal vazios)');
  return stmtFilaInsere.run(loja, titulo, texto, urlLimpa, chaveFinal, imagemBase64, origemFoto || '', meuLink || '').lastInsertRowid;
}

/** Lista os itens pendentes da fila, na ordem de chegada. */
export function listarFilaDb() {
  return stmtFilaLista.all();
}

/** Remove um item da fila apos envio bem-sucedido. */
export function removerDaFilaDb(id) {
  stmtFilaRemove.run(id);
}

/* ================= Fila de espera de midia (gate de imagem) ================= */
/* Oferta sem foto pronta NAO entra na fila de envio: aguarda a midia do grupo
 * (re-hidratacao via getMessageById) ate o deadline; depois tenta o site e,
 * em ultimo caso, a logo da loja. Nada e enviado sem foto, nada e descartado.
 * deadline no formato "YYYY-MM-DD HH:MM:SS" (UTC, como CURRENT_TIMESTAMP). */

const stmtEsperaInsere = db.prepare(
  'INSERT INTO fila_espera_midia (loja, titulo, mensagem, url_limpa, chave_final, meu_link, msg_id, chat_id, origem, tentativas, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)'
);
const stmtEsperaLista = db.prepare('SELECT * FROM fila_espera_midia ORDER BY id ASC');
const stmtEsperaToca = db.prepare('UPDATE fila_espera_midia SET tentativas = tentativas + 1 WHERE id = ?');
const stmtEsperaRemove = db.prepare('DELETE FROM fila_espera_midia WHERE id = ?');

function deadlineEspera(minutos) {
  const d = new Date(Date.now() + minutos * 60000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function colocarEmEspera({ loja = '', titulo = '', mensagem = '', urlLimpa = '', chaveFinal = '', meuLink = '', msgId = '', chatId = '', origem = '', esperaMin = 60 }) {
  return stmtEsperaInsere.run(loja, titulo, mensagem, urlLimpa, chaveFinal, meuLink, msgId, chatId, origem, deadlineEspera(esperaMin)).lastInsertRowid;
}

export function listarEspera() {
  return stmtEsperaLista.all();
}

export function marcarTentativaEspera(id) {
  stmtEsperaToca.run(id);
}

export function removerDaEspera(id) {
  stmtEsperaRemove.run(id);
}
