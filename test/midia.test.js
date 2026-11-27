/**
 * midia.test.js — preço e enquadramento (FEAT-003).
 *
 * Os formatos de preço usados aqui foram medidos no `logs/app.log` de produção:
 * "R$250" (sem espaço), "R$ 42,07" (centavos) e "R$ 1.700" (milhar).
 * A página do produto NÃO entrega preço (preview de 12,7 KB do ML e 21,7 KB da
 * Shopee sem `price`), por isso as fontes são a API da loja e o texto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extrairPreco, escolherPreco, formatarBRL } from '../src/midia/preco.js';
import {
  ALTURA_STORY,
  LARGURA_STORY,
  enquadrar,
  nomeDaMidia,
  precisaJpeg,
} from '../src/midia/quadro.js';
import {
  CTAS,
  escaparDrawtext,
  montarArgsStory,
  precoCurto,
  textosDoStory,
} from '../src/midia/compor.js';

/* ---------------- CA-3: preço no texto ouvido ---------------- */

test('extrai preço nos três formatos que aparecem no log', () => {
  assert.equal(extrairPreco('Fritadeira Mondial R$250').atual, 250);
  assert.equal(extrairPreco('Fone bluetooth por R$ 42,07').atual, 42.07);
  assert.equal(extrairPreco('Tênis R$ 1.700').atual, 1700);
});

test('extrai de/por e calcula o desconto', () => {
  const p = extrairPreco('Tênis de R$ 299 por R$ 199');
  assert.equal(p.antigo, 299);
  assert.equal(p.atual, 199);
  assert.equal(p.desconto, 33);
});

test('parcelamento não é confundido com o preço do produto', () => {
  const p = extrairPreco('R$ 199 à vista ou 12x de R$ 18,25 com frete grátis');
  assert.equal(p.atual, 199);
});

test('sem preço devolve null (é o que bloqueia o story)', () => {
  assert.equal(extrairPreco('Cupom de 20% OFF só hoje'), null);
  assert.equal(extrairPreco(''), null);
  assert.equal(extrairPreco(null), null);
});

/* ---------------- CA-4: API vence o texto ---------------- */

test('preço da API vence e o "de" maior do texto é preservado', () => {
  const escolhido = escolherPreco({ atual: 189.9 }, { atual: 199, antigo: 299, desconto: 33 });
  assert.equal(escolhido.atual, 189.9);
  assert.equal(escolhido.antigo, 299);
  assert.equal(escolhido.desconto, 36);
});

test('sem preço na API, usa o texto; sem os dois, null', () => {
  assert.equal(escolherPreco(null, { atual: 199, antigo: null, desconto: null }).atual, 199);
  assert.equal(escolherPreco(null, null), null);
});

test('formata em real brasileiro', () => {
  assert.match(formatarBRL(1700.5), /1\.700,50/);
  assert.equal(formatarBRL(Number.NaN), null);
});

/* ---------------- CA-1/CA-2: enquadramento e JPEG ---------------- */

test('foto 1:1 é ampliada para cobrir 9:16 sem distorcer', () => {
  const q = enquadrar(1000, 1000);
  assert.equal(q.h, ALTURA_STORY);
  assert.ok(q.w >= LARGURA_STORY);
  assert.ok(q.x <= 0, 'corta nas laterais em vez de esticar');
  assert.equal(q.y, 0);
});

test('foto que já é 9:16 não sofre corte', () => {
  const q = enquadrar(1080, 1920);
  assert.deepEqual({ w: q.w, h: q.h, x: q.x, y: q.y }, { w: 1080, h: 1920, x: 0, y: 0 });
});

test('dimensão inválida falha em vez de gerar mídia quebrada', () => {
  assert.throws(() => enquadrar(0, 100));
});

test('PNG e WebP precisam virar JPEG; JPEG não', () => {
  assert.equal(precisaJpeg('image/png'), true);
  assert.equal(precisaJpeg('image/webp'), true);
  assert.equal(precisaJpeg('image/jpeg'), false);
  assert.equal(precisaJpeg(undefined), false);
});

/* ---------------- CA-5: URL pública com hash ---------------- */

test('nome da mídia é o hash do conteúdo e sempre .jpg', () => {
  const a = nomeDaMidia(Buffer.from('abc'));
  const b = nomeDaMidia(Buffer.from('abc'));
  const c = nomeDaMidia(Buffer.from('outro'));

  assert.equal(a, b, 'mesmo conteúdo, mesmo nome (idempotente)');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{40}\.jpg$/);
});

/* ---------------- CA-1: criativo do story (composição) ---------------- */

test('preço curto mantém centavos só quando existem', () => {
  assert.equal(precoCurto(199), 'R$ 199');
  assert.equal(precoCurto(1700), 'R$ 1.700');
  assert.equal(precoCurto(199.9), 'R$ 199,90');
  assert.equal(precoCurto(Number.NaN), null);
});

test('textos do story exigem preço e montam o "de/por"', () => {
  assert.equal(textosDoStory(null), null, 'sem preço não há story');

  const textos = textosDoStory({ atual: 199, antigo: 299, desconto: 33 }, 'grupo');
  assert.equal(textos.preco, 'R$ 199');
  assert.equal(textos.de, 'de R$ 299 (-33%)');
  assert.equal(textos.principal, CTAS.grupo.principal);
  assert.equal(textos.apoio, 'link na bio');
});

test('CTA muda com o destino configurado (grupo x oferta)', () => {
  const preco = { atual: 99, antigo: null, desconto: null };
  assert.equal(textosDoStory(preco, 'oferta').principal, CTAS.oferta.principal);
  assert.equal(textosDoStory(preco, 'destino-invalido').principal, CTAS.grupo.principal);
});

test('argv do story monta 9:16 com faixa de preço e CTA', () => {
  const textos = textosDoStory({ atual: 199, antigo: 299, desconto: 33 }, 'grupo');
  const args = montarArgsStory({ entrada: 'foto.jpg', saida: 'story.jpg', textos });
  const linha = args.join(' ');

  assert.ok(linha.includes(`scale=${LARGURA_STORY}:${ALTURA_STORY}`), 'escala 9:16');
  assert.ok(linha.includes('force_original_aspect_ratio=increase'), 'sem distorcer');
  assert.ok(linha.includes(`crop=${LARGURA_STORY}:${ALTURA_STORY}`), 'enquadramento cover');
  assert.ok(linha.includes('drawbox='), 'faixa de preço');
  assert.ok(linha.includes('R$ 199'), 'preço no criativo');
  assert.ok(linha.includes('de R$ 299'), '"de" preservado');
  assert.ok(linha.includes('expansion=none'), 'sem expansion=none o % faz o texto sumir');
  assert.ok(args.includes('-frames:v'), 'saída é imagem única');
  assert.equal(args.at(-1), 'story.jpg');
});

test('composição recusa entrada/saída/preço ausentes', () => {
  const textos = textosDoStory({ atual: 10 }, 'grupo');
  assert.throws(() => montarArgsStory({ saida: 'x.jpg', textos }));
  assert.throws(() => montarArgsStory({ entrada: 'a.jpg', textos }));
  assert.throws(() => montarArgsStory({ entrada: 'a.jpg', saida: 'x.jpg' }));
});

test('escape do drawtext protege separadores do filtro', () => {
  assert.equal(escaparDrawtext("a:b,c%d'e"), "a\\:b\\,c\\%d\\'e");
});

test('FEAT-011 CA-5: destino "oferta" usa o CTA LINK NA BIO', () => {
  const preco = { atual: 239, antigo: 299, desconto: 20 };
  const oferta = textosDoStory(preco, 'oferta');
  assert.equal(oferta.principal, 'LINK NA BIO');
  assert.equal(oferta.apoio, 'oferta do dia');
  assert.notEqual(textosDoStory(preco, 'grupo').principal, 'LINK NA BIO');
});
