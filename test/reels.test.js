/**
 * reels.test.js — formato, argv do ffmpeg e payloads (FEAT-006 · CA-1..CA-5).
 *
 * Nenhuma loja entrega vídeo utilizável (ML dá `video_id` do YouTube, Shopee não
 * tem o campo, Magalu não entrega imagem), então o vídeo é gerado. O argv é
 * provado aqui sem executar o binário — assim o teste roda em qualquer máquina.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DURACAO_MAX_SEG,
  LIMITE_DESCRICAO,
  LIMITE_TITULO,
  MAX_FOTOS_CARROSSEL,
  canaisComFeed,
  dentroDoLimite,
  escolherFormato,
  limiteAtingido,
  montarArgsFfmpeg,
  montarPacotePublicacao,
  payloadCarrossel,
  payloadReels,
} from '../src/canais/reels.js';

const fotos = (n) => Array.from({ length: n }, (_, i) => `foto-${i + 1}.jpg`);

/* ---------------- CA-1: carrossel ---------------- */

test('com 3 ou mais fotos, o formato é carrossel', () => {
  assert.deepEqual(escolherFormato(fotos(3)), { formato: 'carrossel', itens: 3 });
});

test('carrossel é limitado a 10 itens', () => {
  assert.equal(escolherFormato(fotos(15)).itens, MAX_FOTOS_CARROSSEL);
});

test('payload de carrossel exige de 2 a 10 itens', () => {
  assert.equal(payloadCarrossel(['a', 'b']).media_type, 'CAROUSEL');
  assert.throws(() => payloadCarrossel(['a']));
  assert.throws(() => payloadCarrossel(fotos(11)));
});

/* ---------------- CA-5: pouca foto vira movimento ---------------- */

test('1 ou 2 fotos viram zoom; sem foto não publica', () => {
  assert.equal(escolherFormato(fotos(1)).formato, 'zoom');
  assert.equal(escolherFormato(fotos(2)).formato, 'zoom');
  assert.deepEqual(escolherFormato([]), { formato: 'nenhum', motivo: 'sem-foto' });
  assert.equal(escolherFormato().formato, 'nenhum');
});

/* ---------------- CA-2: vídeo sempre REELS ---------------- */

test('payload de vídeo é sempre REELS', () => {
  assert.deepEqual(payloadReels({ videoUrl: 'https://x/v.mp4', legenda: 'oi' }), {
    media_type: 'REELS',
    video_url: 'https://x/v.mp4',
    caption: 'oi',
  });
  assert.throws(() => payloadReels({}));
});

/* ---------------- CA-3: argv 9:16 H.264 AAC ---------------- */

test('argv do ffmpeg monta 9:16 com H.264 e AAC', () => {
  const args = montarArgsFfmpeg({ fotos: fotos(3), duracaoSeg: 15 });
  const linha = args.join(' ');

  assert.ok(linha.includes('libx264'), 'H.264');
  assert.ok(linha.includes('aac'), 'áudio AAC');
  assert.ok(linha.includes('scale=1080:1920'), 'escala 9:16');
  assert.ok(linha.includes('crop=1080:1920'), 'enquadramento cover');
  assert.ok(linha.includes('concat=n=3'), 'as 3 fotos entram');

  const ultimoT = args.lastIndexOf('-t');
  assert.equal(args[ultimoT + 1], '15', 'duração final respeitada');
});

test('duração acima do limite ou sem foto é recusada', () => {
  assert.throws(() => montarArgsFfmpeg({ fotos: fotos(2), duracaoSeg: DURACAO_MAX_SEG + 1 }));
  assert.throws(() => montarArgsFfmpeg({ fotos: [], duracaoSeg: 10 }));
  assert.throws(() => montarArgsFfmpeg({ fotos: fotos(2), duracaoSeg: 0 }));

  assert.equal(dentroDoLimite(DURACAO_MAX_SEG), true);
  assert.equal(dentroDoLimite(DURACAO_MAX_SEG + 0.1), false);
});

/* ---------------- CA-4: limite diário ---------------- */

test('limite diário de reels', () => {
  assert.equal(limiteAtingido(1, 1), true);
  assert.equal(limiteAtingido(0, 1), false);
  assert.equal(limiteAtingido(5, 0), false, '0 = sem limite');
});

/* ---------------- CA-6: pacote de publicação ---------------- */

test('pacote traz arquivo, copy, id do produto e canais', () => {
  const pacote = montarPacotePublicacao({
    arquivo: 'reel-MLB4161352905.mp4',
    titulo: 'Fritadeira Mondial 5L',
    descricao: 'R$ 299 no Pix',
    chave: 'shopee:762281166.23697998466',
    loja: 'Shopee',
    duracaoSeg: 15,
  });

  assert.equal(pacote.arquivo, 'reel-MLB4161352905.mp4');
  assert.equal(pacote.titulo, 'Fritadeira Mondial 5L');
  assert.equal(pacote.descricao, 'R$ 299 no Pix');
  assert.equal(pacote.produtoId, 'shopee:762281166.23697998466');
  assert.deepEqual(pacote.canais, ['shopee']);
});

test('canal do pacote depende de onde existe feed com produto anexado', () => {
  assert.deepEqual(canaisComFeed('Shopee'), ['shopee']);
  assert.deepEqual(canaisComFeed('Magalu'), ['magalu']);
  assert.deepEqual(canaisComFeed('MercadoLivre'), ['instagram'], 'Clips é do vendedor');
  assert.deepEqual(canaisComFeed('LojaDesconhecida'), ['instagram']);
});

test('pacote trunca copy longa e recusa arquivo ausente', () => {
  const pacote = montarPacotePublicacao({
    arquivo: 'reel.mp4',
    titulo: 'x'.repeat(500),
    descricao: 'y'.repeat(5000),
  });

  assert.equal(pacote.titulo.length, LIMITE_TITULO);
  assert.equal(pacote.descricao.length, LIMITE_DESCRICAO);
  assert.equal(pacote.produtoId, null, 'sem chave, sem id');
  assert.throws(() => montarPacotePublicacao({}));
  assert.throws(() => montarPacotePublicacao({ arquivo: 'r.mp4', duracaoSeg: 99 }));
});

