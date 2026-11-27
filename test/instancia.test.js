/**
 * instancia.test.js — uma instância por perfil e recuperação da conexão
 * (FEAT-010 · CA-1..CA-4).
 *
 * O que se prova aqui é o que causou o ciclo "logado → QR de novo" em produção:
 * dois processos no mesmo `userDataDir`, app seguindo vivo sem navegador e QR
 * com janela curta demais no servidor (sem TTY).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARQUIVO_TRAVA,
  QR_HEADLESS_SEG_PADRAO,
  adquirirTrava,
  deveEncerrarPorStatus,
  janelaQrMs,
  liberarTrava,
  processosDoApp,
} from '../src/instancia.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Diretório isolado por teste: nada toca o `tokens/` real. */
function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'instancia-'));
}

/** A varredura de `ps` é injetada: o teste não depende do que roda na máquina. */
function semOutrosProcessos() {
  return [];
}

function gravarTrava(diretorio, pid) {
  fs.writeFileSync(path.join(diretorio, ARQUIVO_TRAVA), `${pid}\n`);
}

/* ================= CA-1: uma instância por perfil do Chrome ================= */

test('CA-1: trava viva de outro processo impede a segunda instância', () => {
  const diretorio = pastaTemporaria();
  gravarTrava(diretorio, 4242);

  const trava = adquirirTrava({
    diretorio,
    pid: 1111,
    estaVivo: () => true,
    processos: semOutrosProcessos,
  });

  assert.equal(trava.ok, false);
  assert.equal(trava.motivo, 'trava-ocupada');
  assert.equal(trava.pidDono, 4242);
  // A trava do outro continua intacta: quem falhou não pode liberar por ele.
  assert.equal(fs.readFileSync(trava.arquivo, 'utf8').split('\n')[0], '4242');
});

test('CA-1: app rodando sem trava também barra (versão antiga/pm2)', () => {
  const diretorio = pastaTemporaria();

  const trava = adquirirTrava({
    diretorio,
    pid: 1111,
    estaVivo: () => false,
    processos: () => [4242, 4343],
  });

  assert.equal(trava.ok, false);
  assert.equal(trava.motivo, 'instancia-ativa');
  assert.equal(trava.pidDono, 4242);
  assert.deepEqual(trava.pids, [4242, 4343]);
  // Não pode deixar trava para trás: senão o próximo boot fica bloqueado.
  assert.equal(fs.existsSync(trava.arquivo), false);
});

test('CA-1: sem concorrente, a instância adquire o perfil', () => {
  const diretorio = pastaTemporaria();

  const trava = adquirirTrava({
    diretorio,
    pid: 1111,
    estaVivo: () => false,
    processos: semOutrosProcessos,
  });

  assert.equal(trava.ok, true);
  assert.equal(fs.readFileSync(trava.arquivo, 'utf8').split('\n')[0], '1111');
  assert.equal(trava.liberar(), true);
  assert.equal(fs.existsSync(trava.arquivo), false);
});

/* ============ CA-2: navegador fechado depois de conectar encerra ============ */

test('CA-2: browserClose com sessão ativa manda encerrar', () => {
  const decisao = deveEncerrarPorStatus({ status: 'browserClose', jaConectou: true });

  assert.deepEqual(decisao, { encerrar: true, motivo: 'navegador-fechado' });
});

test('CA-2: browserClose durante o boot NÃO encerra (o retry cuida)', () => {
  assert.equal(
    deveEncerrarPorStatus({ status: 'browserClose', jaConectou: false }),
    null,
  );
});

test('CA-2: outros status não derrubam o app', () => {
  for (const status of ['notLogged', 'inChat', 'autocloseCalled', 'disconnectedMobile']) {
    assert.equal(deveEncerrarPorStatus({ status, jaConectou: true }), null);
  }
});
/* ============ CA-3: janela do QR sem terminal (VPS/systemd) ============ */

test('CA-3: sem TTY e sem configuração, a janela é de 300s', () => {
  assert.equal(QR_HEADLESS_SEG_PADRAO, 300);
  assert.equal(janelaQrMs({ ehTTY: false, timeoutQrMs: 300000 }), 300000);
});

test('CA-3: WPP_QR_HEADLESS_SEG manda na janela sem TTY', () => {
  assert.equal(
    janelaQrMs({ ehTTY: false, headlessSeg: '900' }),
    900000,
  );
});

test('CA-3: valor inválido cai no default (nunca vira NaN)', () => {
  for (const invalido of ['', 'abc', '0', '-5', undefined, null]) {
    assert.equal(
      janelaQrMs({ ehTTY: false, headlessSeg: invalido }),
      QR_HEADLESS_SEG_PADRAO * 1000,
      `headlessSeg=${String(invalido)}`,
    );
  }
});

test('CA-3: janela mínima de 30s mesmo se configurarem menos', () => {
  assert.equal(janelaQrMs({ ehTTY: false, headlessSeg: '10' }), 30000);
});

test('CA-3: com TTY vale WPP_TIMEOUT_QR', () => {
  assert.equal(janelaQrMs({ ehTTY: true, timeoutQrMs: 300000, headlessSeg: '900' }), 300000);
});

test('CA-3: a variável está documentada e é lida pelo app', () => {
  const exemplo = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
  assert.match(exemplo, /WPP_QR_HEADLESS_SEG=/);

  const app = fs.readFileSync(path.join(RAIZ, 'src', 'app.js'), 'utf8');
  assert.match(app, /WPP_QR_HEADLESS_SEG/);
  assert.match(app, /janelaQrMs\(/);
});

/* ============ CA-4: a trava nunca sobrevive ao processo ============ */

test('CA-4: SIGINT/SIGTERM liberam a trava', () => {
  const diretorio = pastaTemporaria();
  const trava = adquirirTrava({
    diretorio,
    pid: 1111,
    estaVivo: () => false,
    processos: semOutrosProcessos,
  });
  assert.equal(trava.ok, true);

  // É o que o handler de encerramento chama.
  assert.equal(liberarTrava({ diretorio, pid: 1111 }), true);
  assert.equal(fs.existsSync(trava.arquivo), false);
});

test('CA-4: quem não é dono não apaga a trava alheia', () => {
  const diretorio = pastaTemporaria();
  gravarTrava(diretorio, 4242);

  assert.equal(liberarTrava({ diretorio, pid: 1111 }), false);
  assert.equal(fs.existsSync(path.join(diretorio, ARQUIVO_TRAVA)), true);
});

test('CA-4: trava de processo morto é reaproveitada', () => {
  const diretorio = pastaTemporaria();
  gravarTrava(diretorio, 999999);

  const trava = adquirirTrava({
    diretorio,
    pid: 1111,
    estaVivo: () => false,
    processos: semOutrosProcessos,
  });

  assert.equal(trava.ok, true);
  assert.equal(fs.readFileSync(trava.arquivo, 'utf8').split('\n')[0], '1111');
});

test('CA-4: processosDoApp ignora o próprio pid e lê a saída do ps', () => {
  const saida = [
    '  111 node src/app.js',
    '  222 node src/app.js --diag-midia',
    `  ${process.pid} node src/app.js`,
    '  333 /usr/bin/google-chrome --type=renderer',
    '',
  ].join('\n');

  assert.deepEqual(processosDoApp({ executar: () => saida }), [111, 222]);
});

test('CA-4: ps indisponível não derruba o boot', () => {
  const falha = () => {
    throw new Error('ps: not found');
  };
  assert.deepEqual(processosDoApp({ executar: falha }), []);
});

test('CA-1: shell/grep que apenas CITAM o caminho não são instância', () => {
  // Regressão do bug real: com `linha.includes('src/app.js')` o app barrava a si
  // mesmo quando o comando do shell (grep, pgrep, editor) citava o arquivo.
  const saida = [
    '  444 /bin/bash -c pgrep -af "node src/app.js"',
    '  555 grep -rn src/app.js src/',
    '  666 node --test test/instancia.test.js',
    '  777 vim src/app.js',
    '  888 node src/app.js',
    '',
  ].join('\n');

  assert.deepEqual(processosDoApp({ executar: () => saida }), [888]);
});

