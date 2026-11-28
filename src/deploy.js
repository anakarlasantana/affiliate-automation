/**
 * deploy.js — regras do deploy de atualização na VPS (FEAT-015).
 *
 * POR QUÊ separado do script: as decisões que já causaram estrago precisam ser
 * testáveis. A receita do README manda
 *
 *   rsync -a --exclude node_modules --exclude tokens .
 *
 * que está certa na PRIMEIRA instalação e é perigosa no UPDATE: `data/` fica de
 * fora da exclusão e o banco de produção (com o histórico de envios) é
 * sobrescrito pelo banco local de teste — o dedup zera e o app reenvia tudo.
 * Aqui as exclusões são uma decisão explícita, com teste.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * O que NUNCA vai no rsync, em nenhum modo.
 *
 * - `data/` e `tokens/` são do servidor (banco com dedup + sessão do WhatsApp);
 * - `.env` é credencial de produção;
 * - `logs/` é histórico local do servidor;
 * - `node_modules` é reinstalado com `npm ci` no destino.
 */
export const EXCLUSOES = [
  'node_modules',
  '.git',
  '.env',
  'logs',
  'data',
  'tokens',
];

/** Argumentos `--exclude` prontos para o rsync. */
export function exclusoesRsync() {
  return EXCLUSOES.flatMap((item) => ['--exclude', item]);
}

/** Assets sem os quais story e post não compõem. */
export const ASSETS_OBRIGATORIOS = [
  'assets/template/story-base.png',
  'assets/template/story.json',
  'assets/template/post-base.png',
  'assets/template/post.json',
];

/**
 * Confere os assets do template.
 * @param {string} raiz
 * @returns {{ok:boolean, faltando:string[]}}
 */
export function validarAssets(raiz) {
  const faltando = ASSETS_OBRIGATORIOS.filter(
    (relativo) => !fs.existsSync(path.join(raiz, relativo)),
  );
  return { ok: faltando.length === 0, faltando };
}

/**
 * Lê as chaves `CHAVE=` de um texto de .env.
 *
 * `aceitarComentadas` existe para o **.env.example**, onde a chave nova é
 * documentada como `#CHAVE=valor` (sugestão). No `.env` real, comentário NÃO é
 * configuração — lá a chave comentada continua faltando.
 *
 * POR QUÊ: sem isso, `chavesFaltantes()` comparava só as linhas ativas do
 * exemplo e reportava "faltam 2" quando na verdade faltavam 24 (bloco inteiro do
 * Instagram estava comentado no exemplo).
 */
export function chavesDoEnv(texto, { aceitarComentadas = false } = {}) {
  return String(texto || '')
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha && (aceitarComentadas || !linha.startsWith('#')))
    .map((linha) => linha.replace(/^#+\s*/, ''))
    .filter((linha) => /^[A-Z][A-Z0-9_]*=/.test(linha))
    .map((linha) => linha.split('=')[0].trim());
}

/**
 * Chaves que existem no `.env.example` (ativas **ou** comentadas) e faltam no
 * `.env` do servidor.
 *
 * POR QUÊ não copiar o exemplo por cima: `cp .env.example .env` apaga as
 * credenciais de produção. Aqui só se APONTA o que falta.
 * @param {string} envDoServidor
 * @param {string} envExemplo
 * @returns {string[]}
 */
export function chavesFaltantes(envDoServidor, envExemplo) {
  const atuais = new Set(chavesDoEnv(envDoServidor));
  // `.env.example` documenta a mesma chave em mais de um bloco (ex.: MAX_REELS_DIA
  // perto do feed e no bloco de kill switches). Deduplica para a lista não
  // repetir item e o operador não achar que são variáveis diferentes.
  return [...new Set(chavesDoEnv(envExemplo, { aceitarComentadas: true }))].filter(
    (chave) => !atuais.has(chave),
  );
}

/**
 * Bloco pronto para colar no `.env` do servidor (comentado, para preencher).
 * @param {string[]} chaves
 */
export function blocoParaColar(chaves = []) {
  if (!chaves.length) return '';
  return [
    '',
    '# ---- adicionado pelo deploy (preencha os valores) ----',
    ...chaves.map((chave) => `#${chave}=`),
  ].join('\n');
}

/**
 * Hostname público gratuito a partir do IP (sem conta) ou do DuckDNS.
 *
 * POR QUÊ: a Meta só baixa mídia por HTTPS; túnel efêmero já derrubou a
 * publicação (erro 9004) e a bio. `sslip.io` resolve o IP sem conta nenhuma.
 * @param {{host?:string, dns?:string}} [alvo]
 * @returns {{hostname:string, baseUrl:string}}
 */
export function hostDeMidia({ host = '', dns = '' } = {}) {
  const nome = String(dns || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (nome) return { hostname: nome, baseUrl: `https://${nome}` };

  const ip = String(host || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    throw new Error('host inválido: informe o IP da VPS ou --dns=<nome>');
  }
  const hostname = `${ip.replace(/\./g, '-')}.sslip.io`;
  return { hostname, baseUrl: `https://${hostname}` };
}

/**
 * Passos do rollback: volta o código e, opcionalmente, o banco.
 * @param {{alvo:string, prev:string, bancoBackup:string|null, restaurarBanco?:boolean}} opcoes
 * @returns {string[]} comandos shell, na ordem
 */
export function passosRollback({
  alvo,
  prev,
  bancoBackup = null,
  restaurarBanco = true,
} = {}) {
  if (!alvo || !prev) throw new Error('alvo e prev são obrigatórios');
  const passos = [
    'systemctl stop affiliate-automation',
    `rsync -a --delete ${prev}/ ${alvo}/`,
  ];
  if (restaurarBanco && bancoBackup) {
    passos.push(`cp ${bancoBackup} ${alvo}/data/ofertas.db`);
    passos.push(`rm -f ${alvo}/data/ofertas.db-wal ${alvo}/data/ofertas.db-shm`);
  }
  passos.push('systemctl start affiliate-automation');
  return passos;
}
