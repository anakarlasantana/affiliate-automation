/**
 * links-ouvidos.test.js — guarda do fixture usado pela verificação de rede
 * (`npm run verify:links` / `ai verify api`).
 *
 * Por que existe: o fixture é a entrada do CA-4 e do CA-5 da FEAT-001 (links
 * REALMENTE ouvidos nos grupos). Se ele apodrecer — URL truncada, JSON
 * quebrado, case duplicado — a "prova de API" passaria a testar nada. Este
 * teste roda offline (`node --test`) e falha antes de a rede mascarar o
 * problema.
 *
 * Procedência das URLs: `ofertas_enviadas` do banco de produção (publicadas em
 * 24/09/2026) + o encurtador `meli.la` que aparece no journal do serviço.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ARQUIVO = path.join(FIXTURES, 'links-ouvidos.json');

const links = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));

test('o fixture de links ouvidos é uma lista não vazia de URLs https', () => {
  assert.ok(Array.isArray(links), 'o fixture é um array');
  assert.ok(links.length >= 4, `esperava >=4 casos, veio ${links.length}`);

  for (const item of links) {
    assert.equal(typeof item.url, 'string', 'cada caso tem url');
    assert.match(item.url, /^https:\/\//, `url deve ser https: ${item.url}`);
    assert.ok(new URL(item.url), `url parseável: ${item.url}`);
    assert.ok(item.rotulo && item.rotulo.length > 5, 'cada caso tem rótulo explicativo');
  }
});

test('o fixture não tem url repetida (cada caso é uma prova distinta)', () => {
  const urls = links.map((l) => l.url);
  assert.equal(new Set(urls).size, urls.length, 'sem duplicatas');
});

test('o fixture cobre encurtador, produto canônico e mais de uma loja', () => {
  const urls = links.map((l) => l.url);
  assert.ok(
    urls.some((u) => /meli\.la|amzn\.to|s\.shopee\.com\.br|promoby\.me/.test(u)),
    'precisa exercitar a expansão de encurtador',
  );
  assert.ok(
    urls.some((u) => /produto\.mercadolivre\.com\.br\/MLB-/.test(u)),
    'precisa exercitar a URL canônica de produto',
  );
  const lojas = new Set(
    urls.map((u) => new URL(u).hostname.replace(/^www\./, '').split('.').slice(-2).join('.')),
  );
  assert.ok(lojas.size >= 2, `esperava >=2 lojas, veio ${[...lojas].join(', ')}`);
});
