/**
 * preco-origem.test.js — de onde vêm o preço e o título do story (FEAT-011).
 *
 * Nasceu de um caso real: a oferta de cupom
 * `R$ 300 OFF acima de R$ 1.999` virou story com preço **R$ 300** — o desconto,
 * não o produto. Aqui ficam presas as três defesas: cupom não é preço, a origem
 * vence o texto e o título é o nome do produto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { extrairPreco, precoDoHtml, resolverPreco } from '../src/midia/preco.js';
import { tituloDaPagina } from '../src/linkResolver.js';

const CUPOM =
  '*NOVOS CUPONS NO ML* — R$ 300 OFF acima de R$ 1.999 | Use Cupom: *MEUDESCONTOBLACK*';

/* ================= CA-3: cupom não é preço ================= */

test('CA-3: valor de desconto/cupom não vira preço', () => {
  assert.equal(extrairPreco(CUPOM), null, '300 é o desconto, não o produto');
  assert.equal(extrairPreco('R$ 120 OFF acima de R$ 799'), null);
  assert.equal(extrairPreco('Frete grátis acima de R$ 79'), null);
});

test('CA-3: preço de produto continua sendo extraído', () => {
  assert.equal(extrairPreco('Fone bluetooth por R$ 89,90').atual, 89.9);
  assert.equal(extrairPreco('R$ 49,90 com cupom BLACK10').atual, 49.9);

  const dePor = extrairPreco('de R$ 199,90 por R$ 149,90');
  assert.equal(dePor.atual, 149.9);
  assert.equal(dePor.antigo, 199.9);
  assert.equal(dePor.desconto, 25);
});

test('CA-3: parcelamento não é preço', () => {
  assert.equal(extrairPreco('12x de R$ 18,25'), null);
});

test('CA-3: preço válido depois de um cupom inválido', () => {
  const texto = 'Cupom de R$ 50 OFF acima de R$ 499. Air fryer por R$ 299,90';
  assert.equal(extrairPreco(texto).atual, 299.9);
});

/* ================= CA-1: preço na origem (HTML já baixado) ================= */

test('CA-1: og:price:amount é lido do HTML', () => {
  const html = '<meta property="og:price:amount" content="199.90">';
  assert.deepEqual(precoDoHtml(html), {
    atual: 199.9,
    antigo: null,
    desconto: null,
  });
});

test('CA-1: JSON-LD "price" é lido quando não há meta', () => {
  const html =
    '<script type="application/ld+json">{"@type":"Product","price":"1699.90"}</script>';
  assert.equal(precoDoHtml(html).atual, 1699.9);
});

test('CA-1: milhar brasileiro no meta não vira 1,999', () => {
  const html = '<meta property="product:price:amount" content="1.999">';
  assert.equal(precoDoHtml(html).atual, 1999);
});

test('CA-1: página sem preço devolve null (caso Mercado Livre/captcha)', () => {
  assert.equal(precoDoHtml('<html><title>Mercado Libre</title></html>'), null);
  assert.equal(precoDoHtml(''), null);
});

/* ================= CA-2: a origem vence o texto ================= */

test('CA-2: preço da API vence o texto, mas o "de" maior é preservado', () => {
  const preco = resolverPreco({
    texto: 'de R$ 199,90 por R$ 159,90',
    daApi: { atual: 149.9, antigo: null, desconto: null },
  });
  assert.equal(preco.atual, 149.9, 'API é a fonte viva do preço');
  assert.equal(preco.antigo, 199.9, '"de" do texto dá a percepção de desconto');
  assert.equal(preco.desconto, 25);
});

test('CA-2: sem API o HTML decide; sem origem o texto decide', () => {
  const comHtml = resolverPreco({
    texto: 'por R$ 199,90',
    html: '<meta property="og:price:amount" content="179.90">',
  });
  assert.equal(comHtml.atual, 179.9);

  const soTexto = resolverPreco({ texto: 'por R$ 199,90' });
  assert.equal(soTexto.atual, 199.9);
});

test('CA-2: origem sem preço + texto de cupom = sem story', () => {
  assert.equal(resolverPreco({ texto: CUPOM, html: '<html></html>' }), null);
});

/* ================= CA-4: título do produto ================= */

test('CA-4: og:title é o título do produto (não a manchete da mensagem)', () => {
  const html =
    '<meta property="og:title" content="Fone Bluetooth JBL Tune 510BT &amp; estojo">';
  assert.equal(tituloDaPagina(html), 'Fone Bluetooth JBL Tune 510BT & estojo');
});

test('CA-4: sem og:title cai no <title>', () => {
  assert.equal(
    tituloDaPagina('<title>Air Fryer Mondial 4L</title>'),
    'Air Fryer Mondial 4L',
  );
  assert.equal(tituloDaPagina('<html></html>'), '');
});

test('CA-2: API vence a página, a página vence o texto', () => {
  const daPagina = { atual: 179.9, antigo: null, desconto: null };
  assert.equal(
    resolverPreco({ texto: 'por R$ 199,90', daPagina }).atual,
    179.9,
    'página vence o texto',
  );
  assert.equal(
    resolverPreco({ texto: 'por R$ 199,90', daApi: { atual: 149.9 }, daPagina }).atual,
    149.9,
    'API vence a página',
  );
});

test('CA-2: o bloco de preço roda DEPOIS de `mensagemFinal` existir', () => {
  // Regressão real (27/11): o bloco de preço entrou ANTES da declaração de
  // `mensagemFinal` (const) e toda oferta quebrava com TDZ —
  // "Cannot access 'mensagemFinal' before initialization". `node --check` não
  // pega isso, e `app.js` não é importável (boota o app no import), então a
  // ordem é conferida no texto do próprio pipeline.
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const declaracao = app.indexOf('let mensagemFinal');
  const uso = app.indexOf('resolverPreco({');

  assert.ok(declaracao > 0, 'mensagemFinal precisa ser declarada no pipeline');
  assert.ok(uso > declaracao, 'resolverPreco deve vir depois de mensagemFinal');
});
