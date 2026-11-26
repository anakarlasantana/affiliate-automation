/**
 * affiliates.test.js — o contrato do registry que garante a regra central do
 * app: **nunca publicar link sem o nosso rastreio** (README, "Loja sem
 * credencial = nada de link sem afiliação").
 *
 * Por que os testes mexem em `process.env`: `credenciaisFaltantes()` lê o
 * ambiente AO VIVO (src/affiliates/base.js), não o snapshot de `config.js`.
 * Assim o resultado é o mesmo na máquina com `.env` cheio e na CI sem `.env` —
 * e nenhum segredo real entra no teste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  converterParaAfiliado,
  chaveProduto,
  perfilDeUrl,
} from '../src/affiliates/index.js';
import { AffiliateProvider } from '../src/affiliates/base.js';

const AMAZON_PRODUTO = 'https://www.amazon.com.br/dp/B0F1H2K3L4';
const MELI_ENTRADA =
  'https://www.mercadolivre.com.br/MLB-4161352905-produto-_JM?searchVariation=123';
const MELI_GERADO =
  'https://produto.mercadolivre.com.br/MLB-4161352905-_JM?matt_tool=20619494&matt_word=affiliate';

/** Executa `fn` com chaves do ambiente zeradas e restaura no fim. */
async function semCredenciais(chaves, fn) {
  const guardado = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
  for (const k of chaves) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const k of chaves) {
      if (guardado[k] !== undefined) process.env[k] = guardado[k];
    }
  }
}

/* ============ CA-6: loja sem credencial nunca gera link ============ */

test('loja sem credencial devolve meuLink vazio e motivo sem-credencial', async () => {
  const r = await semCredenciais(['AMAZON_TAG'], () =>
    converterParaAfiliado(AMAZON_PRODUTO, AMAZON_PRODUTO),
  );

  assert.equal(r.meuLink, '', 'nunca devolve link sem afiliação');
  assert.equal(r.motivo, 'sem-credencial');
  assert.equal(r.loja, 'Amazon');
  assert.deepEqual(r.faltantes, ['AMAZON_TAG'], 'diz qual variável falta');
});

test('domínio sem provider devolve motivo sem-provider', async () => {
  // .invalid é TLD reservado (RFC 2606): não colide com AFFILIATE_GENERIC_N.
  const r = await converterParaAfiliado('https://loja-que-nao-existe.invalid/p/1');
  assert.equal(r.meuLink, '');
  assert.equal(r.motivo, 'sem-provider');
  assert.equal(r.loja, 'desconhecida');
});

test('perfil de loja conhecida fica inativo quando a credencial some', async () => {
  const antes = perfilDeUrl(AMAZON_PRODUTO);
  assert.ok(antes, 'Amazon é um provider registrado');
  assert.equal(antes.loja, 'Amazon');

  const depois = await semCredenciais(['AMAZON_TAG'], async () => perfilDeUrl(AMAZON_PRODUTO));
  assert.equal(depois.ativa, false, 'sem credencial a loja não publica');
  assert.deepEqual(depois.faltantes, ['AMAZON_TAG']);
});

test('a classe base reporta a credencial ausente e não se declara configurada', () => {
  class LojaDeTeste extends AffiliateProvider {
    static credenciaisRequeridas = ['CREDENCIAL_QUE_NAO_EXISTE_XYZ'];
  }

  assert.deepEqual(LojaDeTeste.credenciaisFaltantes(), ['CREDENCIAL_QUE_NAO_EXISTE_XYZ']);
  assert.equal(LojaDeTeste.estaConfigurado(), false);
});

/* ====== CA-7: comparação entrada × link gerado (mesma loja, mesmo produto) ====== */

test('identidade do produto casa entre entrada e link gerado', () => {
  assert.equal(chaveProduto(MELI_ENTRADA), 'meli:MLB4161352905');
  assert.equal(chaveProduto(MELI_GERADO), 'meli:MLB4161352905');
  assert.equal(
    perfilDeUrl(MELI_ENTRADA).loja,
    perfilDeUrl(MELI_GERADO).loja,
    'entrada e link gerado são da mesma loja',
  );
});

test('produto diferente no link gerado é detectável', () => {
  const outro = 'https://produto.mercadolivre.com.br/MLB-9999999999-_JM';
  assert.notEqual(chaveProduto(MELI_ENTRADA), chaveProduto(outro));
});

test('loja diferente no link gerado é detectável', () => {
  const shopee = 'https://shopee.com.br/product/762281166/23697998466';
  assert.equal(chaveProduto(shopee), 'shopee:762281166.23697998466');
  assert.equal(perfilDeUrl(shopee).loja, 'Shopee');
  assert.notEqual(perfilDeUrl(shopee).loja, perfilDeUrl(MELI_GERADO).loja);
});

test('identidade reconhece os três formatos da Shopee (slug, product, wrapper)', () => {
  const esperado = 'shopee:1563443877.23094999688';
  assert.equal(
    chaveProduto(
      'https://shopee.com.br/Kit-10-Panos-i.1563443877.23094999688',
    ),
    esperado,
  );
  assert.equal(chaveProduto('https://shopee.com.br/product/1563443877/23094999688'), esperado);
  assert.equal(chaveProduto('https://shopee.com.br/opaanlp/1563443877/23094999688'), esperado);
});

test('URL sem identidade de produto devolve null em vez de inventar chave', () => {
  assert.equal(chaveProduto('https://www.mercadolivre.com.br/social/jeffrecomenda'), null);
  assert.equal(chaveProduto('nao-e-url'), null);
});
