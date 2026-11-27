/**
 * instagram.test.js — containers do feed (FEAT-013 · CA-4 e vizinhos).
 *
 * HTTP é falso (nada sai para a Meta): o que se prova é o CONTRATO de cada
 * formato — `media_type`, `share_to_feed`, filhos do carrossel — e a ordem
 * (o vídeo só se publica depois de `FINISHED`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  criarContainer,
  publicarFeed,
} from '../src/canais/instagram.js';

const IG = { userId: '1784', token: 'token-fake', graphVersion: 'v21.0' };

/** Registra a ordem das chamadas e responde o mínimo que a API devolve. */
function httpFalso({ status = 'FINISHED', ids = [] } = {}) {
  const chamadas = [];
  let n = 0;
  return {
    chamadas,
    async post(url, corpo, cfg) {
      chamadas.push({ metodo: 'post', url, params: cfg.params });
      n += 1;
      return { data: { id: ids.shift() || `container-${n}` } };
    },
    async get(url, cfg) {
      chamadas.push({ metodo: 'get', url, params: cfg.params });
      return { data: { status_code: status } };
    },
  };
}

const deps = (http) => ({ http, tentativas: 2, esperaMs: 0, dormir: async () => {} });

/* ================= CA-2: post de imagem única ================= */

test('CA-2: post cria container IMAGE com image_url e legenda', async () => {
  // 1ª chamada cria o container, 2ª publica e devolve o mediaId.
  const http = httpFalso({ ids: ['container-img', 'media-publicada'] });
  const mediaId = await publicarFeed(
    IG,
    { formato: 'post', imagens: ['https://x/a.jpg'], legenda: 'Olha isso' },
    deps(http),
  );

  const criacao = http.chamadas.find((c) => c.url.endsWith('/media'));
  assert.equal(criacao.params.image_url, 'https://x/a.jpg');
  assert.equal(criacao.params.caption, 'Olha isso');
  assert.equal(criacao.params.media_type, undefined, 'IMAGE é o padrão da API');
  assert.equal(mediaId, 'media-publicada');
});

/* ================= CA-4: reels ================= */

test('CA-4: reels usa media_type=REELS, video_url e share_to_feed', async () => {
  const http = httpFalso({ ids: ['reels-1'] });
  await publicarFeed(
    IG,
    { formato: 'reels', videoUrl: 'https://x/a.mp4', legenda: 'Reel' },
    deps(http),
  );

  const criacao = http.chamadas.find((c) => c.url.endsWith('/media'));
  assert.equal(criacao.params.media_type, 'REELS');
  assert.equal(criacao.params.video_url, 'https://x/a.mp4');
  assert.equal(criacao.params.share_to_feed, 'true');
});

test('CA-4/CA-5: o vídeo só é publicado depois de FINISHED', async () => {
  const http = httpFalso({ status: 'FINISHED', ids: ['reels-2'] });
  await publicarFeed(
    IG,
    { formato: 'reels', videoUrl: 'https://x/a.mp4' },
    deps(http),
  );

  const ordem = http.chamadas.map((c) => (c.url.endsWith('/media') ? 'criar' : c.url.includes('media_publish') ? 'publicar' : 'status'));
  assert.deepEqual(ordem, ['criar', 'status', 'publicar']);
});

test('CA-5: container de vídeo em processamento NÃO publica', async () => {
  const http = httpFalso({ status: 'IN_PROGRESS', ids: ['reels-3'] });
  await assert.rejects(
    () => publicarFeed(IG, { formato: 'reels', videoUrl: 'https://x/a.mp4' }, deps(http)),
    /não ficou pronto/,
  );
  assert.equal(
    http.chamadas.some((c) => c.url.includes('media_publish')),
    false,
    'não pode publicar container incompleto',
  );
});

test('CA-4: reels sem vídeo falha antes de chamar a API', async () => {
  const http = httpFalso();
  await assert.rejects(() => criarContainer(IG, { tipo: 'REELS' }), /videoUrl/);
  assert.equal(http.chamadas.length, 0);
});

/* ================= CA-3: carrossel ================= */

test('CA-3: carrossel cria filhos e o pai com children na ordem', async () => {
  const http = httpFalso({ ids: ['f1', 'f2', 'pai', 'media-9'] });
  await publicarFeed(
    IG,
    {
      formato: 'carrossel',
      imagens: ['https://x/1.jpg', 'https://x/2.jpg'],
      legenda: 'Carrossel',
    },
    deps(http),
  );

  const criacoes = http.chamadas.filter((c) => c.url.endsWith('/media'));
  assert.equal(criacoes.length, 3, 'dois filhos + o pai');
  assert.equal(criacoes[0].params.is_carousel_item, 'true');
  assert.equal(criacoes[0].params.image_url, 'https://x/1.jpg');
  assert.equal(criacoes[1].params.is_carousel_item, 'true');
  assert.equal(criacoes[2].params.media_type, 'CAROUSEL');
  assert.equal(criacoes[2].params.children, 'f1,f2');
  assert.equal(criacoes[2].params.caption, 'Carrossel');
});

test('CA-3: carrossel com menos de 2 fotos é recusado', async () => {
  const http = httpFalso();
  await assert.rejects(
    () => criarContainer(IG, { tipo: 'CAROUSEL', children: ['um'] }),
    /2 ou mais filhos/,
  );
  assert.equal(http.chamadas.length, 0);
});
