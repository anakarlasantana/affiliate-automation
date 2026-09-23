/**
 * linkResolver.test.js — testes da expansão de redirect JS (caso Promobit)
 * e da normalização de origem usada pela regra FONTES_FOTO_SOMENTE_SITE.
 *
 * As fixtures sao HTML REAL de redirect do Promobit
 * (test/fixtures/promoby-redirect.html — ver test/fixtures/ORIGEM.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extrairRedirectJS } from '../src/linkResolver.js';
import { normalizarOrigem } from '../src/config.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (nome) => fs.readFileSync(path.join(FIXTURES, nome), 'utf8');

/* ================== redirect JS do Promobit ================== */

test('extrai o destino do HTML REAL do promoby.me (padrao "l = \'...\'")', () => {
  const html = ler('promoby-redirect.html');
  const destino = extrairRedirectJS(html, 'https://api.promobit.com.br/v4/redirect/rvz4mkwdgf7');
  assert.equal(destino, 'https://meli.la/2DbQi7D');
});

test('fallback no ancora "clique aqui" quando o JS nao casa', () => {
  const html = `<p>Se nao ocorrer, <a href="https://s.shopee.com.br/abc123" href="#">clique aqui.</a></p>`;
  const destino = extrairRedirectJS(html, 'https://www.promobit.com.br/Redirect/to/2985905/');
  assert.equal(destino, 'https://s.shopee.com.br/abc123');
});

test('extrairRedirectJS devolve null em pagina sem redirect (HTML de loja)', () => {
  const html = '<html><head><title>Produto</title></head><body><h1>Camiseta</h1></body></html>';
  assert.equal(extrairRedirectJS(html, 'https://www.mercadolivre.com.br/p/MLB123'), null);
});

test('extrairRedirectJS ignora destino no MESMO host (nao e redirect)', () => {
  const html = `function a(){ var _ = 3, l = 'https://www.promobit.com.br/outra-pagina'; }`;
  assert.equal(extrairRedirectJS(html, 'https://www.promobit.com.br/Redirect/to/1/'), null);
});

test('extrairRedirectJS descarta dominios de tracker', () => {
  const html = `location.href = 'https://www.google-analytics.com/collect?x=1';`;
  assert.equal(extrairRedirectJS(html, 'https://encurtador.com/x'), null);
});

/* ================== normalizacao de origem (regra de foto) ================== */

test('normalizarOrigem remove esquema, dois-pontos e "@"', () => {
  assert.equal(normalizarOrigem('whatsapp:120363419781062962@g.us'), '120363419781062962@g.us');
  assert.equal(normalizarOrigem('telegram:@promobit_oficial'), 'promobit_oficial');
  assert.equal(normalizarOrigem('@PROMOBIT_OFICIAL'), 'promobit_oficial');
  assert.equal(normalizarOrigem(''), '');
  assert.equal(normalizarOrigem(null), '');
});

test('origemSoFotoSite casa a lista FONTES_FOTO_SOMENTE_SITE em qualquer formato', async () => {
  // Formato do .env: whatsapp:<id>@g.us + promobit_oficial
  const anterior = process.env.FONTES_FOTO_SOMENTE_SITE;
  process.env.FONTES_FOTO_SOMENTE_SITE = 'whatsapp:120363419781062962@g.us,promobit_oficial';
  // Reimporta o config com a env nova (o module cache quebra via query string).
  const cfg = await import(`../src/config.js?t=${Date.now()}`);
  try {
    assert.equal(cfg.origemSoFotoSite('whatsapp:120363419781062962@g.us'), true, 'whatsapp: prefixado');
    assert.equal(cfg.origemSoFotoSite('120363419781062962@g.us'), true, 'so o id');
    assert.equal(cfg.origemSoFotoSite('telegram:@promobit_oficial'), true, 'telegram @canal');
    assert.equal(cfg.origemSoFotoSite('promobit_oficial'), true, 'canal sem @');
    // Origens que NAO estao na lista continuam com a cascata normal (foto da mensagem)
    assert.equal(cfg.origemSoFotoSite('whatsapp:120363403040134708@g.us'), false);
    assert.equal(cfg.origemSoFotoSite('telegram:@achadinhos'), false);
    assert.equal(cfg.origemSoFotoSite(''), false);
  } finally {
    if (anterior === undefined) delete process.env.FONTES_FOTO_SOMENTE_SITE;
    else process.env.FONTES_FOTO_SOMENTE_SITE = anterior;
  }
});