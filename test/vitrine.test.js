/**
 * vitrine.test.js — vitrine sem ancora nao vira produto aleatorio (FEAT-022 · CA-1..CA-3, CA-5).
 *
 * O caso real: cupom do Promobit gerou link para um case Starlink escolhido ao
 * acaso (primeiro MLB do HTML da vitrine). Em 6h, 31 ofertas de vitrine e
 * NENHUMA com token ref.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linkDaVitrinePropria } from '../src/affiliates/mercadolivre.js';
import { textoCitaProduto } from '../src/midia/bloqueio-oferta.js';

const SOCIAL = 'jn202602020924';
const AFF = '20619494';

/* ============ CA-1 / CA-5: link da vitrine propria ============ */

test('CA-1: gera link da vitrine propria com tracking', () => {
  const link = linkDaVitrinePropria({ affiliateId: AFF, socialId: SOCIAL });

  assert.ok(link, 'precisa devolver URL');
  assert.match(link, new RegExp(`/social/${SOCIAL}`), 'usa a vitrine configurada');
  assert.match(link, new RegExp(`matt_tool=${AFF}`), 'carrega o tracking (CA-5)');
});

/* ============ CA-3: sem vitrine configurada ============ */

test('CA-3: sem MELI_SOCIAL_ID devolve null (nao publica link fake)', () => {
  assert.equal(linkDaVitrinePropria({ affiliateId: AFF, socialId: '' }), null);
  assert.equal(linkDaVitrinePropria({ affiliateId: '', socialId: SOCIAL }), null);
});

/* ============ CA-2: quando o produto do link casa com o texto ============ */

test('CA-2: produto do link casando com o texto dispensa a vitrine', () => {
  const casa = textoCitaProduto(
    'Case Starlink Mini com desconto — R$ 189,90',
    'Case Starlink Mini Super IMS 88mm',
  );
  assert.equal(casa, true, 'com match, o link do produto e usado');
});

test('CA-1: o cupom real do Promobit NAO casa com o produto do link', () => {
  // caso de 28/11: texto de cupom, produto extraido aleatorio da vitrine
  const casa = textoCitaProduto(
    'CUPOM NA MÃO pra garantir aquele alívio no carrinho',
    'Case Starlink Mini Super IMS 88mm Slim Ultra Fixação',
  );
  assert.equal(casa, false, 'sem match -> vitrine propria');
});

/* ============ CA-5: a origem do link e auditavel ============ */

test('CA-5: a funcao e pura e nao depende de rede', () => {
  // Duas chamadas seguidas devolvem o mesmo link (sem I/O, sem efeito)
  const a = linkDaVitrinePropria({ affiliateId: AFF, socialId: SOCIAL });
  const b = linkDaVitrinePropria({ affiliateId: AFF, socialId: SOCIAL });
  assert.equal(a, b);
});
