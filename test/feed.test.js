/**
 * feed.test.js — composição do post do feed (FEAT-013 · CA-1).
 *
 * O layout foi medido do `post-base.jpeg` (928×1152); aqui se garante que a
 * composição respeita o que a Meta aceita (4:5 a 1.91:1), que as zonas existem e
 * que emoji não vira quadradinho no JPEG.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import os from 'node:os';
import path from 'node:path';

import {
  carregarTemplateDoPost,
  comporFeed,
  proporcaoAceita,
  semEmoji,
} from '../src/midia/feed.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('CA-1: o template do post está em 4:5 e carrega com as zonas', () => {
  const { layout, proporcao } = carregarTemplateDoPost(RAIZ);

  assert.equal(layout.largura, 1080);
  assert.equal(layout.altura, 1350);
  assert.equal(proporcao.toFixed(3), '0.800');
  for (const zona of ['foto', 'titulo', 'preco', 'cta']) {
    assert.ok(layout[zona], `faltou a zona ${zona}`);
  }
  assert.ok(
    layout.foto.y + layout.foto.h <= layout.altura,
    'a foto não pode passar do canvas',
  );
});

test('CA-1: 9:16 do story seria recusado no feed', () => {
  assert.equal(proporcaoAceita(1080, 1920).ok, false);
  assert.equal(proporcaoAceita(1080, 1350).ok, true);
  assert.equal(proporcaoAceita(1080, 1080).ok, true);
  // 1080/566 = 1,908 ainda é aceito (limite 1,91); 1080/500 = 2,16 não é.
  assert.equal(proporcaoAceita(1080, 566).ok, true);
  assert.equal(proporcaoAceita(1080, 500).ok, false, 'acima de 1.91:1');
});

test('CA-1: emoji do título é removido (vira tofu na fonte do ffmpeg)', () => {
  assert.equal(semEmoji('OPORTUNIDADE RARA! 🎟️ cupons'), 'OPORTUNIDADE RARA! cupons');
  assert.equal(semEmoji('Fone 🎧 com 40h'), 'Fone com 40h');
  assert.equal(semEmoji(''), '');
});

test('CA-1: comporFeed usa a base do template e sanitiza os textos', async () => {
  const chamadas = [];
  const saida = path.join(os.tmpdir(), 'post-feed-teste.jpg');

  const r = await comporFeed({
    foto: '/tmp/foto.jpg',
    saida,
    raiz: RAIZ,
    dimensoesFoto: { largura: 500, altura: 500 },
    textos: {
      titulo: 'Tênis FILA 🎾',
      preco: 'R$ 239',
      de: 'de R$ 299 (-20%)',
      principal: 'LINK NA BIO',
    },
    deps: {
      compor: async (opcoes) => {
        chamadas.push(opcoes);
      },
    },
  });

  assert.equal(r, saida);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].base, /post-base\.png$/);
  assert.equal(chamadas[0].layout.altura, 1350);
  assert.equal(chamadas[0].textos.titulo, 'Tênis FILA');
});
