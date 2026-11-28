#!/usr/bin/env node
/**
 * deploy-vps.mjs — atualiza a aplicação na VPS (FEAT-015).
 *
 *   node scripts/deploy-vps.mjs --host 147.15.55.124 --dry-run
 *   node scripts/deploy-vps.mjs --host 147.15.55.124 --dns garimpa-ai.duckdns.org --apply
 *   node scripts/deploy-vps.mjs --host 147.15.55.124 --rollback --backup <arquivo> --apply
 *
 * Regras que este script garante (e que o README não cobria):
 *  - `data/`, `tokens/`, `.env` e `logs/` NUNCA vão no rsync — no update, o banco
 *    de produção tem o dedup dos envios; sobrescrever faz o app reenviar tudo;
 *  - o `.env` é MERGE: lista as chaves que faltam em vez de copiar o exemplo por
 *    cima (o que apagaria as credenciais);
 *  - backup datado do banco + cópia do código em `.prev` antes de mexer;
 *  - nada sobe sem ffmpeg, Caddy, `npm ci` e `better-sqlite3` validados.
 *
 * Sem `--apply` nada é executado: imprime o plano.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  blocoParaColar,
  chavesFaltantes,
  exclusoesRsync,
  hostDeMidia,
  passosRollback,
  validarAssets,
} from '../src/deploy.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);

const pegar = (nome, padrao = '') => {
  const pos = args.indexOf(`--${nome}`);
  return pos >= 0 ? args[pos + 1] : padrao;
};

const host = pegar('host');
const dns = pegar('dns');
const chave = pegar(
  'key',
  path.join(process.env.HOME || '', 'Downloads/ssh-key-2026-09-21.key'),
);
const usuario = pegar('user', 'ubuntu');
const alvo = pegar('alvo', '/opt/affiliate-automation');
const prev = `${alvo}.prev`;
const aplicar = args.includes('--apply');
const rollback = args.includes('--rollback');
const restaurarBanco = !args.includes('--so-codigo');

const log = (msg) => console.log(msg);
const passo = (n, msg) => console.log(`\n[${n}] ${msg}`);

function ssh(comando, { silencioso = false } = {}) {
  if (!aplicar) {
    log(`    ssh ${comando.slice(0, 130)}${comando.length > 130 ? '…' : ''}`);
    return '';
  }
  const saida = execFileSync(
    'ssh',
    [
      '-i',
      chave,
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      `${usuario}@${host}`,
      comando,
    ],
    // ARMADILHA: com stdio 'inherit' o execFileSync devolve null — a leitura do
    // .env remoto vinha vazia e a comparação mentia ("faltam 2 chaves" quando
    // faltavam 24). Quem precisa da saída pede `silencioso`, que captura o pipe.
    { encoding: 'utf8', stdio: silencioso ? ['ignore', 'pipe', 'pipe'] : 'inherit' },
  );
  return silencioso ? saida ?? '' : '';
}

if (!host) {
  console.error(
    'uso: node scripts/deploy-vps.mjs --host <ip> [--dns <nome>] [--apply|--dry-run] [--rollback]',
  );
  process.exit(1);
}
if (!fs.existsSync(chave)) {
  console.error(`⛔ chave SSH não encontrada: ${chave}`);
  process.exit(1);
}

const assets = validarAssets(RAIZ);
if (!assets.ok) {
  console.error(`⛔ assets do template faltando: ${assets.faltando.join(', ')}`);
  process.exit(1);
}

const midia = hostDeMidia({ host, dns });

log('════════════════════════════════════════════════════════════');
log(`  DEPLOY ${aplicar ? 'REAL' : 'SIMULADO (--dry-run)'} · ${host} · ${alvo}`);
log(`  mídia pública: ${midia.baseUrl}`);
log('════════════════════════════════════════════════════════════');

if (rollback) {
  const backup = pegar('backup', '');
  passo(1, 'ROLLBACK');
  for (const comando of passosRollback({
    alvo,
    prev,
    bancoBackup: backup || null,
    restaurarBanco: restaurarBanco && Boolean(backup),
  })) {
    log(`    sudo ${comando}`);
    ssh(`sudo -n ${comando}`);
  }
  log('\n✅ rollback concluído — confira: journalctl -u affiliate-automation -n 40');
  process.exit(0);
}
passo(1, 'backup do banco + cópia do código atual');
const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const backupBanco = `${alvo}/data/ofertas.db.bak.${carimbo}`;
ssh(
  `sudo -n cp ${alvo}/data/ofertas.db ${backupBanco} && ` +
    `sudo -n rsync -a ${alvo}/ ${prev}/ && echo backup-ok`,
);
log(`    backup do banco: ${backupBanco}`);

passo(2, 'enviando código (sem data/, tokens/, .env, logs/)');
log(`    rsync -a ${exclusoesRsync().join(' ')} ./ ${usuario}@${host}:${alvo}/`);
if (aplicar) {
  execFileSync(
    'rsync',
    [
      '-a',
      '-e',
      `ssh -i ${chave} -o BatchMode=yes`,
      ...exclusoesRsync(),
      './',
      `${usuario}@${host}:${alvo}/`,
    ],
    { cwd: RAIZ, stdio: 'inherit' },
  );
  ssh(`sudo -n chown -R affiliate:affiliate ${alvo}`);
}

passo(3, 'dependências e ferramentas (ffmpeg, Caddy, better-sqlite3)');
ssh(
  `cd ${alvo} && sudo -n -u affiliate npm ci && ` +
    `sudo -n -u affiliate node -e "require('better-sqlite3')" && ` +
    `ffmpeg -version | head -1 && caddy version`,
);

passo(4, 'variáveis: só aponta o que falta (não sobrescreve o .env)');
let faltam = [];
if (aplicar) {
  // Leitura do .env do servidor tem de ser CONFIÁVEL: se vier vazia, o diff
  // mentiria (foi o bug de 27/11 — reportou 2 chaves quando faltavam 24).
  const envServidor = ssh(`sudo -n cat ${alvo}/.env`, { silencioso: true });
  if (!String(envServidor || '').trim()) {
    console.error(
      '⛔ não consegui ler o .env do servidor — abortando ANTES de mexer em qualquer coisa',
    );
    process.exit(3);
  }
  const envExemplo = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
  faltam = chavesFaltantes(envServidor, envExemplo);
  if (faltam.length) {
    log(`    ⚠️  ${faltam.length} chave(s) faltando no .env do servidor:`);
    log(blocoParaColar(faltam).replace(/^/gm, '    '));
    log('    preencha o .env da VPS e rode de novo — o deploy NÃO copia o .env');
    // As chaves de mídia/Instagram são obrigatórias: sem elas o app sobe e não
    // publica. Parar aqui evita "deploy verde" com configuração incompleta.
    const obrigatorias = faltam.filter((c) =>
      /^(PUBLIC_BASE_URL|GO_BASE_URL|IG_USER_ID|IG_ACCESS_TOKEN|CHROME_PATH)$/.test(c),
    );
    if (obrigatorias.length) {
      console.error(`⛔ faltam chaves obrigatórias: ${obrigatorias.join(', ')}`);
      process.exit(2);
    }
  } else {
    log('    ✅ nenhuma chave faltando');
  }
} else {
  log('    (no --apply: compara .env do servidor com .env.example e lista o que falta)');
}

passo(5, 'Caddyfile com o host de mídia');
ssh(
  `sudo -n sed "s/SEU_HOST_AQUI/${midia.hostname}/" ${alvo}/deploy/Caddyfile > /tmp/Caddyfile && ` +
    `sudo -n cp /tmp/Caddyfile /etc/caddy/Caddyfile && sudo -n systemctl reload caddy`,
);

passo(6, 'verificação antes de religar');
ssh(`cd ${alvo} && sudo -n -u affiliate npm run verify`);

passo(7, 'religando o serviço');
ssh(
  `sudo -n systemctl daemon-reload && sudo -n systemctl restart affiliate-automation && ` +
    `sleep 5 && systemctl is-active affiliate-automation`,
);

passo(8, 'validação de fora');
log(`    curl -sI ${midia.baseUrl}/health`);
if (aplicar) {
  try {
    const saida = execFileSync(
      'curl',
      ['-sI', '-m', '15', `${midia.baseUrl}/health`],
      { encoding: 'utf8' },
    );
    log(`    ${saida.split(/\r?\n/)[0]}`);
  } catch (erro) {
    log(`    ⚠️  /health não respondeu: ${erro.message}`);
    log('    portas 80/443 abertas na Security List do OCI? caddy ativo?');
  }
}

log('\n────────────────────────────────────────────────────────────');
log(aplicar ? '✅ deploy concluído' : '🧪 simulação: rode com --apply para executar');
log('   acompanhar: sudo journalctl -u affiliate-automation -f');
log(`   PUBLIC_BASE_URL=${midia.baseUrl}  ·  GO_BASE_URL=${midia.baseUrl}`);
