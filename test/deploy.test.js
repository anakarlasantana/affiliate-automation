/**
 * deploy.test.js — regras do deploy (FEAT-015).
 *
 * O que se prova aqui são as decisões que já causaram estrago: não sobrescrever
 * `data/`/`.env` no rsync, apontar as variáveis que faltam em vez de copiar o
 * exemplo por cima, validar os assets e saber voltar atrás.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ASSETS_OBRIGATORIOS,
  EXCLUSOES,
  blocoParaColar,
  chavesDoEnv,
  chavesFaltantes,
  exclusoesRsync,
  hostDeMidia,
  passosRollback,
  validarAssets,
} from '../src/deploy.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/* ================= CA-1: o update não sobrescreve produção ================= */

test('CA-1: rsync nunca envia data/, tokens/ nem .env', () => {
  const args = exclusoesRsync();
  for (const proibido of ['data', 'tokens', '.env', 'logs', 'node_modules']) {
    assert.ok(EXCLUSOES.includes(proibido), `${proibido} deve estar excluído`);
    assert.ok(args.includes(proibido), `${proibido} precisa virar --exclude`);
  }
  // pares --exclude <item>
  assert.equal(args.length, EXCLUSOES.length * 2);
  assert.equal(args.filter((a) => a === '--exclude').length, EXCLUSOES.length);
});

/* ================= CA-2: .env é merge, não cópia ================= */

test('CA-2: aponta as chaves que faltam sem tocar nas existentes', () => {
  const servidor = 'SHOPEE_APP_ID=abc\nMEU_GRUPO_WHATSAPP=120@g.us\n';
  const exemplo =
    'SHOPEE_APP_ID=\nMEU_GRUPO_WHATSAPP=\nGO_DESTINO=\nMAX_POSTS_DIA=\n# comentario\n';

  assert.deepEqual(chavesFaltantes(servidor, exemplo), [
    'GO_DESTINO',
    'MAX_POSTS_DIA',
  ]);

  const bloco = blocoParaColar(['GO_DESTINO', 'MAX_POSTS_DIA']);
  assert.match(bloco, /#GO_DESTINO=/);
  assert.doesNotMatch(bloco, /SHOPEE_APP_ID/, 'não mexe no que já existe');
});

test('CA-2: chavesDoEnv ignora comentários e linhas vazias', () => {
  assert.deepEqual(chavesDoEnv('#A=1\n\nB=2\n  C=3\nD=\n'), ['B', 'C', 'D']);
});

/* ================= CA-5: assets do template ================= */

test('CA-5: os quatro assets existem no repositório', () => {
  const r = validarAssets(RAIZ);
  assert.equal(r.ok, true, `faltando: ${r.faltando.join(', ')}`);
  assert.equal(ASSETS_OBRIGATORIOS.length, 4);
});

test('CA-5: reprova quando falta asset', () => {
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-assets-'));
  try {
    const r = validarAssets(vazio);
    assert.equal(r.ok, false);
    assert.equal(r.faltando.length, 4);
  } finally {
    fs.rmSync(vazio, { recursive: true, force: true });
  }
});

/* ================= CA-8: host de mídia estável ================= */

test('CA-8: sem DNS, deriva o sslip.io do IP (sem conta)', () => {
  assert.deepEqual(hostDeMidia({ host: '147.15.55.124' }), {
    hostname: '147-15-55-124.sslip.io',
    baseUrl: 'https://147-15-55-124.sslip.io',
  });
});

test('CA-8: com DuckDNS usa o nome informado', () => {
  assert.equal(
    hostDeMidia({ host: '147.15.55.124', dns: 'garimpa-ai.duckdns.org' }).baseUrl,
    'https://garimpa-ai.duckdns.org',
  );
  assert.equal(
    hostDeMidia({ dns: 'https://garimpa-ai.duckdns.org/' }).hostname,
    'garimpa-ai.duckdns.org',
  );
});

test('CA-8: sem IP e sem DNS, reprova em vez de inventar', () => {
  assert.throws(() => hostDeMidia({}), /host inválido/);
});

/* ================= CA-10: rollback ================= */

test('CA-10: rollback para o serviço, volta código e banco, e sobe', () => {
  const passos = passosRollback({
    alvo: '/opt/affiliate-automation',
    prev: '/opt/affiliate-automation.prev',
    bancoBackup: '/opt/backups/ofertas-2026-11-27.db',
  });

  assert.equal(passos[0], 'systemctl stop affiliate-automation');
  assert.match(passos[1], /rsync -a --delete \/opt\/affiliate-automation\.prev\//);
  assert.ok(passos.some((p) => p.includes('cp /opt/backups/ofertas-2026-11-27.db')));
  assert.ok(passos.some((p) => p.includes('ofertas.db-wal')), 'limpa o WAL');
  assert.equal(passos.at(-1), 'systemctl start affiliate-automation');
});

test('CA-10: rollback só do código quando pedido', () => {
  const passos = passosRollback({
    alvo: '/opt/app',
    prev: '/opt/app.prev',
    bancoBackup: '/opt/b.db',
    restaurarBanco: false,
  });
  assert.equal(passos.some((p) => p.startsWith('cp ')), false);
});

/* ===== prova dos passos do script, do unit e do Caddyfile ===== */

const ler = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

test('CA-3: o backup acontece ANTES de enviar o código', () => {
  const script = ler('scripts/deploy-vps.mjs');
  const backup = script.indexOf('ofertas.db.bak');
  const envio = script.indexOf('passo(2,');
  assert.ok(backup > 0, 'script precisa gerar backup do banco');
  assert.ok(backup < envio, 'backup tem de vir antes do rsync de envio');
  assert.match(script, /rsync -a \$\{alvo\}\/ \$\{prev\}\/|\$\{alvo\}\/ \$\{prev\}/);
});

test('CA-4: o deploy valida ffmpeg, caddy e better-sqlite3', () => {
  const script = ler('scripts/deploy-vps.mjs');
  assert.match(script, /ffmpeg -version/);
  assert.match(script, /caddy version/);
  assert.match(script, /require\('better-sqlite3'\)/);
});

test('CA-6: npm ci e verify vêm antes de religar o serviço', () => {
  const script = ler('scripts/deploy-vps.mjs');
  const verify = script.indexOf('npm run verify');
  const restart = script.indexOf('systemctl restart affiliate-automation');
  assert.ok(script.includes('npm ci'), 'precisa reinstalar dependências');
  assert.ok(verify > 0 && restart > 0);
  assert.ok(verify < restart, 'verificar antes de religar');
});

test('CA-7: o unit mantém Restart=always e KillMode=control-group', () => {
  const unit = ler('deploy/affiliate-automation.service');
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^KillMode=control-group$/m);
  assert.match(unit, /^User=affiliate$/m);
});

test('CA-9: o Caddyfile encaminha para o loopback, sem expor o app', () => {
  const caddy = ler('deploy/Caddyfile');
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3000/);
  assert.match(caddy, /SEU_HOST_AQUI/);
  assert.doesNotMatch(caddy, /:80\s|:443\s/, 'portas vêm do hostname, não fixas');
});
