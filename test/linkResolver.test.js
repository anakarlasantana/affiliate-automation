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
import {
  extrairRedirectJS,
  extrairGaleria,
  subirResolucao,
  urlCanonicaDeProduto,
} from '../src/linkResolver.js';
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

/* ============ Nível 2.5: URL canônica, galeria e resolução ============ */

/*
 * BUG DE PRODUÇÃO (26/09/2026): a cascata consultava a URL com slug do ML
 * (www.../MLB-<id>-<slug>-_JM), que responde 404, e a oferta caía no
 * placeholder. Validado ao vivo: a mesma oferta na URL canônica devolve
 * og:image de 42 KB. Estes testes travam a correção.
 */
test('URL com slug que dá 404 é convertida na canônica do produto', () => {
  assert.equal(
    urlCanonicaDeProduto(
      'https://www.mercadolivre.com.br/MLB-4278799345-tnis-fila-duality-2-feminina-cinza-e-preto-_JM?searchVariation=192381593865',
    ),
    'https://produto.mercadolivre.com.br/MLB-4278799345-_JM',
  );
});

test('catálogo /p/MLB também vira canônica', () => {
  assert.equal(
    urlCanonicaDeProduto('https://www.mercadolivre.com.br/p/MLB123456789'),
    'https://produto.mercadolivre.com.br/MLB-123456789-_JM',
  );
});

test('loja sem formato MLB devolve null (não inventa URL)', () => {
  assert.equal(urlCanonicaDeProduto('https://shopee.com.br/product/1537142489/234987121'), null);
  assert.equal(urlCanonicaDeProduto('nao-e-url'), null);
  assert.equal(urlCanonicaDeProduto(''), null);
});

test('upgrade de resolução da Magalu (o og:image vem em miniatura)', () => {
  // O og:image da Magalu aponta para 470x352 (~16 KB); o mesmo arquivo em
  // 1280x1280 devolve ~116 KB. Sem isso a foto saía baixa no grupo.
  assert.equal(
    subirResolucao('https://a-static.mlcdn.com.br/470x352/slug/241203300/f7dd.jpg'),
    'https://a-static.mlcdn.com.br/1280x1280/slug/241203300/f7dd.jpg',
  );
  // Placeholder de template {w}x{h} tambem vira URL real.
  assert.equal(
    subirResolucao('https://a-static.mlcdn.com.br/{w}x{h}/slug/x.jpg'),
    'https://a-static.mlcdn.com.br/1280x1280/slug/x.jpg',
  );
});

test('CDN sem tamanho no caminho NÃO é reescrita (fallback intacto)', () => {
  const mlstatic = 'https://http2.mlstatic.com/D_Q_NP_926032-MLB81783442178_012025-V-x.jpg';
  assert.equal(subirResolucao(mlstatic), null, 'mlstatic fica intacto');
  assert.equal(subirResolucao('https://exemplo.com/foto.jpg'), null);
  assert.equal(subirResolucao(''), null);
});

test('galeria extrai as fotos do produto e descarta sprite/logo', () => {
  // Trechos REAIS da pagina canonica do ML (medidos ao vivo).
  const html = `
    <img src="https://http2.mlstatic.com/frontend-assets/ml-web-navigation/logo-2x.png">
    <img src="https://http2.mlstatic.com/D_NQ_NP_926032-MLB81783442178_012025-O-produto.jpg">
    <img src="https://http2.mlstatic.com/D_Q_NP_926032-MLB81783442178_012025-V-produto.jpg">
    <img src="https://http2.mlstatic.com/D_Q_NP_926032-MLB81783442178_012025-V-produto.jpg">
  `;
  const galeria = extrairGaleria(html);
  assert.ok(galeria.length >= 2, `esperava >=2 fotos, veio ${galeria.length}`);
  assert.ok(
    galeria.every((u) => !/frontend-assets|logo/i.test(u)),
    'sprite/logo não entram na galeria',
  );
  assert.ok(
    galeria.every((u) => !u.includes('.png')),
    'o logo em PNG foi descartado',
  );
  assert.equal(
    new Set(galeria).size,
    galeria.length,
    'URL repetida aparece uma vez só',
  );
});

test('galeria ordena a variante grande antes da menor', () => {
  const html = `
    <img src="https://a-static.mlcdn.com.br/175x170/slug/x.jpg">
    <img src="https://a-static.mlcdn.com.br/1280x1280/slug/x.jpg">
  `;
  const galeria = extrairGaleria(html);
  assert.match(galeria[0], /1280x1280/, 'maior resolução primeiro');
});

test('galeria devolve lista vazia em página sem foto de produto', () => {
  assert.deepEqual(extrairGaleria('<html><body>sem foto</body></html>'), []);
  assert.deepEqual(extrairGaleria(''), []);
  assert.deepEqual(extrairGaleria(null), []);
});
});