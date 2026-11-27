/**
 * docs.test.js — a documentação não pode mentir (FEAT-016).
 *
 * POR QUÊ: o README ficou uma aplicação atrás — descrevia um bot só de WhatsApp
 * quando o sistema já publica story e feed no Instagram, e citava 6 de 17
 * comandos. Doc sem verificação volta a divergir; estes testes travam o
 * contrato mínimo entre o que está escrito e o que o código oferece.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ler = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

const README = ler('README.md');
const RECEITAS = ler('docs/harness/receitas.md');
const AGENTS = ler('AGENTS.md');
const SCRIPTS = Object.keys(
  JSON.parse(ler('package.json')).scripts || {},
);

/* ============ CA-1: os dois canais aparecem na apresentação ============ */

test('CA-1: o README descreve WhatsApp E Instagram (story, feed, link da bio)', () => {
  assert.match(README, /Instagram/i, 'precisa citar o Instagram');
  assert.match(README, /story|stories/i, 'precisa citar story');
  assert.match(README, /feed/i, 'precisa citar o feed');
  assert.match(README, /\/go\//, 'precisa explicar o link curto /go/<chave>');
  assert.match(README, /link na bio/i, 'precisa explicar o "link na bio"');
});

/* ============ CA-2: todo comando citado existe ============ */

test('CA-2: todo `npm run <script>` citado na documentação existe', () => {
  const citados = new Set();
  for (const texto of [README, RECEITAS, AGENTS]) {
    for (const achado of texto.matchAll(/npm run ([a-z][\w:.-]*)/g)) {
      citados.add(achado[1]);
    }
  }

  const inexistentes = [...citados].filter((nome) => !SCRIPTS.includes(nome));
  assert.deepEqual(inexistentes, [], `comandos citados e inexistentes: ${inexistentes.join(', ')}`);
  assert.ok(citados.size >= 8, `a doc deveria citar boa parte dos comandos (citou ${citados.size})`);
});

test('CA-2: os comandos essenciais do Instagram estão documentados', () => {
  const texto = README + RECEITAS + AGENTS;
  for (const comando of ['publicar', 'publicar:feed', 'verify:ig', 'status']) {
    assert.ok(texto.includes(`npm run ${comando}`), `falta documentar npm run ${comando}`);
  }
});

/* ============ CA-3: estrutura de pastas ============ */

test('CA-3: a estrutura documentada cobre os diretórios reais de src/', () => {
  const bloco = README.slice(README.indexOf('## Estrutura'));
  // A árvore mostra os nomes dentro de `src/`, então basta cada pasta aparecer.
  for (const pasta of ['midia/', 'canais/', 'publicacao/', 'affiliates/']) {
    assert.ok(bloco.includes(pasta), `a estrutura precisa listar ${pasta}`);
  }
  for (const raiz of ['assets/template/', 'data/', 'deploy/', 'tokens/']) {
    assert.ok(bloco.includes(raiz), `a estrutura precisa listar ${raiz}`);
  }
});

/* ============ CA-4: parar e reiniciar ============ */

test('CA-4: o README ensina a ver e PARAR a aplicação', () => {
  assert.match(README, /Parar e reiniciar/i, 'precisa de uma seção de parada');
  assert.match(README, /tokens\/app\.lock/, 'precisa citar a trava do perfil');
  assert.match(README, /kill \$\(head -1 tokens\/app\.lock\)/, 'precisa do comando de parada limpa');
  assert.match(README, /src\/servidor\.js/, 'precisa citar o servidor de mídia como processo filho');
  assert.match(README, /Ctrl\+C/, 'precisa explicar por que o Ctrl+C não para quando está desacoplado');
});

/* ============ CA-5: runbook de deploy ============ */

test('CA-5: o deploy documenta ffmpeg, Caddy, exclusões e rollback', () => {
  assert.match(README, /ffmpeg/i, 'ffmpeg é obrigatório para compor story e post');
  assert.match(README, /Caddy/i, 'a Meta exige HTTPS; Caddy é quem expõe');
  assert.match(README, /deploy\/Caddyfile/, 'precisa apontar o Caddyfile do repo');
  assert.match(README, /npm run deploy:vps/, 'precisa apontar o script de deploy');
  assert.match(README, /exclui|--exclude|nunca sobrescreve/i, 'precisa avisar sobre data/ e .env');
  assert.match(README, /rollback/i, 'precisa do caminho de volta');
  assert.match(RECEITAS, /Parar|reiniciar/i, 'receitas precisa do runbook de operação');
});

/* ============ débito registrado ============ */

test('DT-006: a rotação de log está registrada como débito', () => {
  const debitos = ler('docs/debitos-tecnicos.md');
  assert.match(debitos, /DT-006/);
  assert.match(debitos, /rota[çc][ãa]o/i);
});
