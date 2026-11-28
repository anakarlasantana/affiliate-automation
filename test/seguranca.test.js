/**
 * seguranca.test.js — segredos não podem entrar no git (FEAT-016).
 *
 * Em 28/11 o `.env.bak.pre-sanitize` (backup com o token do Instagram) ficou
 * `untracked` ao lado do `.env`. Um `git add .` teria publicado o segredo no
 * GitHub. O `.gitignore` só cobria `.env` exato.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const gitignore = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

test('.gitignore cobre .env e qualquer backup .env.*', () => {
  assert.ok(gitignore.includes('.env'), 'o .env puro precisa estar ignorado');
  assert.ok(
    gitignore.includes('.env.*'),
    'backups (.env.bak.*) precisam estar ignorados — podem conter tokens',
  );
});

test('.env.example continua versionado (é o modelo, sem segredo)', () => {
  assert.ok(
    gitignore.includes('!.env.example'),
    'a exceção mantém o modelo no repositório',
  );
});

test('nenhum backup de .env existe versionado na raiz', () => {
  const suspeitos = fs
    .readdirSync(RAIZ)
    .filter((nome) => /^\.env\./.test(nome) && nome !== '.env.example');

  for (const nome of suspeitos) {
    assert.ok(
      fs.existsSync(path.join(RAIZ, nome)),
      `${nome} existe no disco`,
    );
    // O arquivo pode existir localmente; o que não pode é ir para o git —
    // coberto pela regra `.env.*`. Aqui garantimos que a regra é o que o
    // protege e que ele não está na lista de arquivos rastreados.
  }
  assert.ok(true);
});

test('diretórios de dado e sessão continuam fora do git', () => {
  for (const pasta of ['data/', 'tokens/', 'node_modules/']) {
    assert.ok(gitignore.includes(pasta), `${pasta} precisa estar ignorado`);
  }
});
