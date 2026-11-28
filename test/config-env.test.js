/**
 * config-env.test.js — valorEnv corta comentário do `.env` (regressão 27/11).
 *
 * O `dotenv` NÃO remove comentário no fim da linha. Com
 * `IG_ACCESS_TOKEN=EAG…ZDZD   # token de usuário (~60d)` o app enviava o
 * comentário junto e a Meta respondia 400 "invalid token" — sem erro de código.
 * Foi o que me fez concluir, por engano, que o token havia expirado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { valorEnv } from '../src/config.js';

/** Troca a variável só durante o teste e restaura depois. */
function comEnv(nome, valor, executar) {
  const antes = process.env[nome];
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
  try {
    return executar();
  } finally {
    if (antes === undefined) delete process.env[nome];
    else process.env[nome] = antes;
  }
}

test('corta o comentário grudado no valor', () => {
  assert.equal(
    comEnv('TESTE_TOKEN', 'EAG123abc   # token de usuário (~60d)', () =>
      valorEnv('TESTE_TOKEN'),
    ),
    'EAG123abc',
  );
});

test('tira espaços em branco das pontas', () => {
  assert.equal(
    comEnv('TESTE_ID', '17841433805968223                ', () =>
      valorEnv('TESTE_ID'),
    ),
    '17841433805968223',
  );
});

test('remove aspas que envolvem o valor inteiro', () => {
  assert.equal(
    comEnv('TESTE_QUOTE', '"garimpa.123"', () => valorEnv('TESTE_QUOTE')),
    'garimpa.123',
  );
});

test('valor normal passa intacto', () => {
  assert.equal(
    comEnv('TESTE_OK', 'https://147-15-55-124.sslip.io', () => valorEnv('TESTE_OK')),
    'https://147-15-55-124.sslip.io',
  );
});

test('ausente ou só comentário devolvem o padrão', () => {
  assert.equal(comEnv('TESTE_VAZIO', undefined, () => valorEnv('TESTE_VAZIO', 'x')), 'x');
  assert.equal(
    comEnv('TESTE_BRANCO', '   # só comentário', () => valorEnv('TESTE_BRANCO', 'y')),
    'y',
  );
});

test('as credenciais do Instagram passam pelo sanitizador', () => {
  const fonte = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  for (const campo of ['IG_USER_ID', 'IG_ACCESS_TOKEN', 'IG_APP_SECRET', 'IG_VERIFY_TOKEN']) {
    assert.ok(
      fonte.includes(`valorEnv('${campo}')`),
      `${campo} precisa passar por valorEnv()`,
    );
  }
});
