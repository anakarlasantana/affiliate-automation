/**
 * legenda.test.js — copy do post do feed (FEAT-014 · CA-1..CA-8).
 *
 * A legenda é o que faz o clique: produto + preço na primeira linha (o feed corta
 * em 125 chars) e o CTA tem de casar com o destino real do /go.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITE_GANCHO,
  LIMITE_LEGENDA,
  MAX_HASHTAGS,
  extrairCupom,
  gancho,
  legendaDoFeed,
  linhaDoPreco,
  montarHashtags,
  truncarPorLinha,
} from '../src/midia/legenda.js';

const TEXTO_GRUPO = `*MENOR PREÇO JÁ POSTADO NO MEDICUBE*

Fone JBL Tune 510BT original com 40h de bateria.
Use Cupom: BLACK10 até 30/11

https://mercadolivre.com/sec/abc123`;

const PRECO = { atual: 68, antigo: 119, desconto: 43 };

/* ================= CA-1 / CA-3: primeira linha ================= */

test('CA-1/CA-3: primeira linha tem produto e preço, em até 125 chars', () => {
  const l = gancho({ titulo: 'Fone JBL Tune 510BT', preco: PRECO });
  assert.match(l, /Fone JBL Tune 510BT/);
  assert.match(l, /R\$ 68/);
  assert.ok(l.length <= LIMITE_GANCHO, `veio com ${l.length}`);
});

test('CA-3: título gigante é cortado com reticências, sem estourar', () => {
  const l = gancho({
    titulo:
      'Smart TV 65 Polegadas 4K UHD QLED Processador com Inteligência Artificial ' +
      'Wi-Fi Bluetooth Controle por Voz 3 HDMI 2 USB Design sem Bordas',
    preco: PRECO,
  });
  assert.ok(l.length <= LIMITE_GANCHO, `veio com ${l.length}`);
  assert.ok(l.endsWith('…'), 'corte precisa ser visível');
});

/* ================= CA-2: preço calculado ================= */

test('CA-2: linha do preço traz de/por e o desconto calculado', () => {
  assert.equal(linhaDoPreco(PRECO), '💰 R$ 68  de R$ 119 (-43%)');
});

test('CA-2: sem preço não há linha de preço (nunca inventa)', () => {
  assert.equal(linhaDoPreco(null), null);
  assert.equal(linhaDoPreco({ atual: Number.NaN }), null);
  assert.doesNotMatch(legendaDoFeed({ titulo: 'X' }), /💰/);
});

/* ================= CA-4: hashtags ================= */

test('CA-4: hashtag da loja vem primeiro, sem repetir e no máximo 10', () => {
  const tags = montarHashtags({
    loja: 'MercadoLivre',
    extras: ['#achadinhos', 'mercadolivre', 'OfertaDoDia'],
  });
  assert.equal(tags[0], '#mercadolivre');
  assert.ok(tags.length <= MAX_HASHTAGS, `veio com ${tags.length}`);
  assert.equal(new Set(tags).size, tags.length, 'sem repetição');
  assert.ok(tags.includes('#achadinhos'));
});

/* ================= CA-5: CTA coerente com GO_DESTINO ================= */

test('CA-5: CTA segue o destino real do link da bio', () => {
  const oferta = legendaDoFeed({
    titulo: 'Fone',
    preco: PRECO,
    loja: 'MercadoLivre',
    goDestino: 'oferta',
  });
  assert.match(oferta, /Link na bio → abre a oferta/);

  const grupo = legendaDoFeed({
    titulo: 'Fone',
    preco: PRECO,
    goDestino: 'grupo',
  });
  assert.match(grupo, /Link na bio → entra no grupo/);
});

test('CA-5: nunca promete link clicável no próprio post', () => {
  const l = legendaDoFeed({ titulo: 'Fone', preco: PRECO });
  assert.doesNotMatch(l, /clique aqui|link abaixo|link no post/i);
});

/* ================= CA-6: limite e truncamento ================= */

test('CA-6: truncar por linha respeita o limite e não corta palavra', () => {
  const longo = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)].join('\n');
  const r = truncarPorLinha(longo, 120);
  assert.ok(r.length <= 120);
  assert.ok(!r.includes('c'.repeat(10)), 'não pode pegar linha pela metade');

  assert.equal(truncarPorLinha('curto', LIMITE_LEGENDA), 'curto');
  const semQuebra = truncarPorLinha('palavra '.repeat(400), 100);
  assert.ok(semQuebra.length <= 101);
});

/* ================= CA-7: cupom ================= */

test('CA-7: cupom e validade saem do texto do grupo', () => {
  assert.deepEqual(extrairCupom(TEXTO_GRUPO), {
    codigo: 'BLACK10',
    validade: '30/11',
  });
  const l = legendaDoFeed({ titulo: 'Fone', preco: PRECO, texto: TEXTO_GRUPO });
  assert.match(l, /🏷️ Cupom: BLACK10 \(até 30\/11\)/);
  assert.equal(extrairCupom('sem cupom aqui'), null);
});

/* ================= CA-8: sanitização ================= */

test('CA-8: remove link cru e não inventa frete grátis/menor preço', () => {
  const l = legendaDoFeed({ titulo: 'Fone', preco: PRECO, texto: TEXTO_GRUPO });
  assert.doesNotMatch(l, /https?:\/\//);
  assert.doesNotMatch(l, /frete gr[áa]tis/i);
  assert.doesNotMatch(l, /menor preço/i, 'não repete a manchete do grupo');

  const semClaim = legendaDoFeed({
    titulo: 'Panela',
    preco: { atual: 99 },
    texto: 'Panela antiaderente 24cm.',
  });
  assert.doesNotMatch(semClaim, /frete gr[áa]tis|menor preço/i);
});

/* ================= integração: legenda completa ================= */

test('CA-1/CA-2/CA-4: legenda completa tem gancho, preço, loja e tags', () => {
  const l = legendaDoFeed({
    titulo: 'Fone JBL Tune 510BT',
    preco: PRECO,
    loja: 'MercadoLivre',
    texto: TEXTO_GRUPO,
    goDestino: 'oferta',
  });

  assert.match(l, /^Fone JBL Tune 510BT por R\$ 68/);
  assert.match(l, /💰 R\$ 68  de R\$ 119 \(-43%\)/);
  assert.match(l, /🏬 MercadoLivre/);
  assert.match(l, /#mercadolivre/);
  assert.ok(l.length <= LIMITE_LEGENDA);
});
