/**
 * lojaApi.js — Nível 2.5: foto do produto pela API OFICIAL da loja.
 *
 * POR QUE este arquivo existe (validado ao vivo em 26/09/2026):
 *
 *  | Loja         | API oficial de imagem?          | O que foi medido          |
 *  |--------------|---------------------------------|---------------------------|
 *  | Shopee       | SIM (GraphQL, credenciais já    | `productOfferV2` devolve   |
 *  |              | existem no .env)                | `imageUrl` — 149 KB, ok   |
 *  | Mercado Livre| NAO (api.mercadolibre.com/items | 403 sem token -> a galeria |
 *  |              | responde 403)                   | da página é a alternativa |
 *  | Magalu       | NAO                             | galeria + upgrade de size |
 *
 * Regras deste módulo:
 *  - NUNCA lança: falha de API devolve null e a cascata segue (o nível 3,
 *    o placeholder, garante foto). A oferta não pode ser perdida por rede.
 *  - Só consulta loja com credencial configurada e com identidade de produto
 *    reconhecível (shopId.itemId) — sem isso não há como consultar a API.
 *  - Nada de loja por URL aqui: quem decide é o REGISTRO de afiliados. Este
 *    arquivo só conhece a API de cada loja, não a política de negócio.
 */
import crypto from 'node:crypto';
import axios from 'axios';
import config from './config.js';

/** Endpoint oficial de afiliados da Shopee. */
const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

/**
 * Consulta autenticada a GraphQL da Shopee.
 * Mesma assinatura do `converter()` do provider (SHA256 de
 * appId+timestamp+payload+secret), reaproveitando a mesma credencial.
 * @param {string} query
 * @returns {Promise<any>} `data` da resposta ou null em qualquer falha
 */
async function shopeeGraphql(query) {
  const { appId, secret } = config.afiliados.shopee;
  if (!appId || !secret) return null;
  try {
    const payload = JSON.stringify({ query });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const assinatura = crypto
      .createHash('sha256')
      .update(appId + timestamp + payload + secret)
      .digest('hex');
    const { data } = await axios.post(SHOPEE_ENDPOINT, payload, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${assinatura}`,
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    if (data?.errors?.length) {
      console.warn(`   ⚠️  [Shopee API] ${JSON.stringify(data.errors).slice(0, 120)}`);
      return null;
    }
    return data?.data ?? null;
  } catch (erro) {
    // Silencioso de propósito: é um nível opcional da cascata.
    console.warn(`   ⚠️  [Shopee API] ${erro.message}`);
    return null;
  }
}

/**
 * Foto do produto na Shopee pela API oficial.
 *
 * O argumento é `itemId` (Int64) SOLTO, não "shopId_itemId": foi validado
 * contra o schema por introspection (`__type(name:"ProductOfferV2")`) e contra
 * respostas reais. `shopId` sozinho devolve QUALQUER produto da loja (não o
 * nosso), então nunca é usado sozinho.
 *
 * @param {string} chave `shopee:<shopId>.<itemId>` (saída de chaveProduto)
 * @returns {Promise<string|null>} URL da imagem do produto
 */
export async function imagemShopee(chave) {
  const m = String(chave || '').match(/^shopee:(\d+)\.(\d+)$/);
  if (!m) return null;
  const [, shopId, itemId] = m;
  const data = await shopeeGraphql(
    `{productOfferV2(itemId:${itemId},limit:1){nodes{itemId shopId productName imageUrl}}}`,
  );
  const no = data?.productOfferV2?.nodes?.[0];
  if (!no?.imageUrl) return null;
  // Confere que o produto é o MESMO: shopId diferente devolve itemId errado.
  if (String(no.shopId) !== shopId) return null;
  return no.imageUrl;
}

/**
 * Fontes de imagem por loja, indexadas pelo nome que o registro de afiliados
 * usa. Adicionar uma loja = acrescentar uma entrada aqui.
 * @type {Record<string, (chave: string) => Promise<string|null>>}
 */
const FONTES = {
  Shopee: imagemShopee,
};

/**
 * Foto do produto pela API oficial da loja, quando existir.
 *
 * @param {string} loja nome da loja (ex.: "Shopee", "MercadoLivre")
 * @param {string} chave identidade do produto (saída de chaveProduto)
 * @returns {Promise<string|null>} URL da imagem, ou null se a loja não tem
 *   API / não foi possível consultar
 */
export async function imagemPelaApiDaLoja(loja, chave) {
  const fonte = FONTES[loja];
  if (!fonte) return null;
  try {
    return await fonte(chave);
  } catch (erro) {
    console.warn(`   ⚠️  Falha na API de imagem [${loja}]: ${erro.message}`);
    return null;
  }
}

/**
 * Preço do produto pela API oficial da Shopee (GraphQL de afiliados).
 *
 * Mesma consulta da imagem, com os campos de preço: `priceMin` é o valor à vista
 * e `priceMax` o "de" (quando há variação/riscado). Sem `shopId` batendo, o
 * itemId apontou para outro produto e o preço não vale para esta oferta.
 *
 * @param {string} chave `shopee:<shopId>.<itemId>`
 * @returns {Promise<{atual:number, antigo:number|null, desconto:number|null}|null>}
 */
export async function precoShopee(chave) {
  const m = String(chave || '').match(/^shopee:(\d+)\.(\d+)$/);
  if (!m) return null;
  const [, shopId, itemId] = m;
  const data = await shopeeGraphql(
    `{productOfferV2(itemId:${itemId},limit:1){nodes{itemId shopId priceMin priceMax}}}`,
  );
  const no = data?.productOfferV2?.nodes?.[0];
  if (!no || String(no.shopId) !== shopId) return null;

  const atual = Number(no.priceMin ?? no.price);
  if (!Number.isFinite(atual) || atual <= 0) return null;

  const antigo = Number(no.priceMax);
  const temDesconto = Number.isFinite(antigo) && antigo > atual;
  return {
    atual,
    antigo: temDesconto ? antigo : null,
    desconto: temDesconto ? Math.round((1 - atual / antigo) * 100) : null,
  };
}

/** Fontes de preço por loja (hoje só a Shopee expõe preço na API). */
const FONTES_PRECO = {
  Shopee: precoShopee,
};

/**
 * Preço do produto pela API oficial da loja, quando existir.
 * Nunca lança: falha de API devolve null e o texto/HTML decide.
 *
 * @param {string} loja nome da loja (ex.: "Shopee", "MercadoLivre")
 * @param {string} chave identidade do produto (saída de chaveProduto)
 * @returns {Promise<{atual:number, antigo:number|null, desconto:number|null}|null>}
 */
export async function precoPelaApiDaLoja(loja, chave) {
  const fonte = FONTES_PRECO[loja];
  if (!fonte) return null;
  try {
    return await fonte(chave);
  } catch (erro) {
    console.warn(`   ⚠️  Falha na API de preço [${loja}]: ${erro.message}`);
    return null;
  }
}

/** Lojas que têm fonte de imagem por API (para o painel/doctor). */
export function lojasComApiDeImagem() {
  return Object.keys(FONTES);
}