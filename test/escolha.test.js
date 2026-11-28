/**
 * escolha.test.js — qual pendente publicar no ciclo (FEAT-020 · CA-1..CA-5).
 *
 * O caso real: em 28/11 havia 2 posts compostos e nenhum publicado, porque o
 * story tinha prioridade absoluta e cada oferta nova furava a fila.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escolherDoCiclo } from '../src/publicacao/escolha.js';

const cfg = {
  maxStoriesDia: 12,
  maxPostsDia: 6,
  maxReelsDia: 1,
  storiesPorPost: 0, // desliga o interleave nos testes de antiguidade
};

const story = (criado) => ({ chave: 'meli-A', criado });
const post = (criado) => ({ chave: 'meli-A:post', criado });

/* ============ CA-1 / CA-2: o mais antigo vence ============ */

test('CA-1: post mais antigo que o story → publica POST', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('2026-11-28T16:00:00Z'),
      post: post('2026-11-28T15:00:00Z'),
    },
    doDia: { story: 2, post: 0 },
    cfg,
  });
  assert.equal(r.formato, 'post', 'o post espera há mais tempo');
  assert.equal(r.motivo, 'mais-antigo');
  assert.equal(r.alvo.chave, 'meli-A:post');
});

test('CA-2: story mais antigo que o post → publica STORY', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('2026-11-28T15:00:00Z'),
      post: post('2026-11-28T16:00:00Z'),
    },
    doDia: { story: 2, post: 0 },
    cfg,
  });
  assert.equal(r.formato, 'story');
  assert.equal(r.motivo, 'mais-antigo');
});

/* ============ CA-3: interleave fura a fila ============ */

test('CA-3: interleave força o post mesmo com story mais antigo', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('2026-11-28T14:00:00Z'), // mais antigo
      post: post('2026-11-28T16:00:00Z'),
    },
    doDia: { story: 2, post: 0 },
    cfg: { ...cfg, storiesPorPost: 2 }, // 2 >= (0+1)*2
  });
  assert.equal(r.formato, 'post');
  assert.equal(r.motivo, 'interleave');
});

test('CA-3: interleave não força quando a razão ainda não foi atingida', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('2026-11-28T14:00:00Z'),
      post: post('2026-11-28T16:00:00Z'),
    },
    doDia: { story: 1, post: 0 }, // 1 < 2
    cfg: { ...cfg, storiesPorPost: 2 },
  });
  assert.equal(r.formato, 'story');
  assert.equal(r.motivo, 'mais-antigo');
});

/* ============ CA-4: teto por formato é soberano ============ */

test('CA-4: post no teto diário → story assume', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('2026-11-28T16:00:00Z'),
      post: post('2026-11-28T15:00:00Z'),
    },
    doDia: { story: 2, post: 6 }, // post no teto
    cfg,
  });
  assert.equal(r.formato, 'story');
});

test('CA-4: story no teto diário → post assume', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('2026-11-28T14:00:00Z'),
      post: post('2026-11-28T16:00:00Z'),
    },
    doDia: { story: 12, post: 0 },
    cfg,
  });
  assert.equal(r.formato, 'post');
});

/* ============ CA-5: reel e fila vazia ============ */

test('CA-5: só reel pendente → publica o reel', () => {
  const r = escolherDoCiclo({
    pendentes: { reel: { chave: 'meli-A:reel', criado: '2026-11-28T15:00:00Z' } },
    doDia: { story: 0, post: 0, reel: 0 },
    cfg,
  });
  assert.equal(r.formato, 'reel');
  assert.equal(r.motivo, 'unico');
});

test('CA-5: sem candidato devolve null (ciclo não publica)', () => {
  assert.equal(escolherDoCiclo({ pendentes: {}, doDia: {}, cfg }), null);
  assert.equal(
    escolherDoCiclo({
      pendentes: { story: story('2026-11-28T16:00:00Z') },
      doDia: { story: 12 },
      cfg,
    }),
    null,
    'no teto e sem alternativa = nada a publicar',
  );
});

test('CA-5: criado inválido vai para o fim da fila (não quebra)', () => {
  const r = escolherDoCiclo({
    pendentes: {
      story: story('data-invalida'),
      post: post('2026-11-28T16:00:00Z'),
    },
    doDia: { story: 0, post: 0 },
    cfg,
  });
  assert.equal(r.formato, 'post', 'o com data válida vence');
});
