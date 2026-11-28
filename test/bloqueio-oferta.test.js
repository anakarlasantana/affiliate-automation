/**
 * bloqueio-oferta.test.js — esta oferta merece story? (FEAT-021 · CA-3, CA-4)
 *
 * O caso real: cupom do Promobit virou story com card da marca e preço de cupom.
 * O link era de afiliado correto — o problema foi levar ao feed algo não confirmado.
 * O bloqueio NUNCA atinge o envio no grupo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  avaliarOfertaParaStory,
  pareceCupomSemProduto,
  textoCitaProduto,
} from '../src/midia/bloqueio-oferta.js';

/* ============ CA-3: vitrine sem o produto no texto ============ */

test('CA-3: vitrine + texto sem o produto → não gera story', () => {
  const r = avaliarOfertaParaStory({
    texto: 'CUPOM NA MÃO pra garantir aquele alívio no carrinho',
    tituloProduto: 'Case Starlink Mini Super IMS 88mm Slim Ultra Fixação',
    veioDeVitrine: true,
    preco: 500,
  });
  assert.equal(r.story, false);
  assert.equal(r.motivo, 'vitrine-sem-produto');
});

test('CA-3: vitrine + texto CITANDO o produto → gera story', () => {
  const r = avaliarOfertaParaStory({
    texto: 'Case Starlink Mini com desconto — R$ 189,90',
    tituloProduto: 'Case Starlink Mini Super IMS 88mm',
    veioDeVitrine: true,
    preco: 189.9,
  });
  assert.equal(r.story, true);
  assert.equal(r.motivo, null);
});

test('CA-3: link direto (não vitrine) não é bloqueado por falta de match', () => {
  const r = avaliarOfertaParaStory({
    texto: 'Fone bluetooth ótimo',
    tituloProduto: 'Fone JBL Tune 510BT',
    veioDeVitrine: false,
    preco: 149.9,
  });
  assert.equal(r.story, true);
});

/* ============ CA-4: cupom sem produto ============ */

test('CA-4: mensagem só de cupom → não gera story', () => {
  const r = avaliarOfertaParaStory({
    texto: 'CUPOM 🎟️ R$ 50 OFF use o cupom BLACK10',
    tituloProduto: '',
    veioDeVitrine: false,
    preco: 50,
  });
  assert.equal(r.story, false);
  assert.equal(r.motivo, 'cupom-sem-produto');
});

test('CA-4: cupom JUNTO de produto → gera story', () => {
  const r = avaliarOfertaParaStory({
    texto: 'Fone JBL Tune 510BT por R$ 149,90 — use o cupom SOM10',
    tituloProduto: 'Fone JBL Tune 510BT',
    veioDeVitrine: false,
    preco: 149.9,
  });
  assert.equal(r.story, true);
});

/* ============ preço como guarda ============ */

test('sem preço válido não há story', () => {
  assert.equal(avaliarOfertaParaStory({ preco: null }).motivo, 'sem-preco');
  assert.equal(avaliarOfertaParaStory({ preco: 0 }).motivo, 'sem-preco');
  assert.equal(avaliarOfertaParaStory({ preco: -5 }).motivo, 'sem-preco');
});

/* ============ helpers ============ */

test('textoCitaProduto ignora acento, caixa e palavras vazias', () => {
  assert.equal(
    textoCitaProduto('tenis fila kr7', 'Tênis Fila KR7 Pro Vermelho'),
    true,
  );
  assert.equal(textoCitaProduto('cupom na mão', 'Case Starlink Mini'), false);
  assert.equal(textoCitaProduto('qualquer coisa', ''), true, 'sem título não bloqueia');
});

test('pareceCupomSemProduto distingue cupom puro de oferta com produto', () => {
  assert.equal(pareceCupomSemProduto('CUPOM 🎟️ R$ 50 OFF'), true);
  assert.equal(pareceCupomSemProduto('Air fryer Mondial com cupom'), false);
  assert.equal(pareceCupomSemProduto('oferta do dia'), false);
});
