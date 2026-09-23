/**
 * shopee.js
 * Shopee Open Platform (Afiliados): GraphQL + assinatura SHA256.
 *
 * Autenticação oficial:
 *   Authorization: SHA256_HEX( appId + timestamp + payload + secret )
 *   Header: "SHA256 Credential=<appId>, Timestamp=<ts>, Signature=<ass>"
 * Endpoint: https://open-api.affiliate.shopee.com.br/graphql
 * Mutation: generateShortLink(originUrl)
 */
import crypto from 'node:crypto';
import axios from 'axios';
import { AffiliateProvider } from './base.js';
import config from '../config.js';

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

export class ShopeeProvider extends AffiliateProvider {
  static dominios = ['shopee.com.br', 'shope.ee', 's.shopee.com.br'];
  static nome = 'Shopee';
  static credenciaisRequeridas = ['SHOPEE_APP_ID', 'SHOPEE_SECRET'];

  /** Shopee: o produto é identificado por shopId.itemId (-i.123.456). */
  static perfil = {
    urlNaoProduto: [/\/m\//, /\/universal-link\//, /\/cart(\/|$)/],
    /**
     * Wrapper de afiliado da Shopee no formato /opaanlp/<shopId>/<itemId>
     * (compartilhamento do app; aponta para outro afiliado via mmp_pid).
     * Não é a página canônica do produto, mas os IDs estão no path —
     * canonicaliza SEM rede, para /product/<shop>/<item>.
     */
    mergulhador: {
      nome: 'Shopee opaanlp (wrapper do app)',
      matches: (url) => /\/opaanlp\/\d+\/\d+/.test(String(url)),
      extrair: (url) => {
        const m = String(url).match(/\/opaanlp\/(\d+)\/(\d+)/);
        return m ? `https://shopee.com.br/product/${m[1]}/${m[2]}` : null;
      },
    },
    idProduto: (url) => {
      const porSlug = url.pathname.match(/-i\.(\d+)\.(\d+)/);
      if (porSlug) return `shopee:${porSlug[1]}.${porSlug[2]}`;
      const porProduto = url.pathname.match(/\/product\/(\d+)\/(\d+)/);
      if (porProduto) return `shopee:${porProduto[1]}.${porProduto[2]}`;
      // Wrapper ainda não canonicalizado (ex.: expansão do shortlink gerado)
      const porWrapper = url.pathname.match(/\/opaanlp\/(\d+)\/(\d+)/);
      return porWrapper ? `shopee:${porWrapper[1]}.${porWrapper[2]}` : null;
    },
    /** parâmetros de compartilhamento da Shopee + rastros de afiliado de terceiros */
    paramsRemover: [
      /^smtt$/i, /^smid$/i, /^share_channel$/i, /^is_from_login$/i,
      /^uls_trackid$/i, /^sp_atk$/i, /^af_siteid$/i,
      /^mmp_/i, /^gads_/i, /^__mobile__$/i, /^exp_group$/i, /^credential_token$/i,
    ],
  };

  /**
   * Gera short link oficial de afiliado via GraphQL.
   * @param {string} urlLimpa
   * @returns {Promise<string>}
   */
  async converter(urlLimpa) {
    const { appId, secret } = config.afiliados.shopee;

    if (!appId || !secret) {
      console.warn('[Shopee] Credenciais ausentes (SHOPEE_APP_ID/SHOPEE_SECRET); ignorando oferta.');
      return null;
    }

    const subId = config.afiliados.shopee.subId;
    // subIds:[""] está fora do contrato da API: omite o campo quando não há
    // marca d'água configurada, em vez de enviar string vazia.
    const campoSubIds = subId ? `,subIds:["${subId.replace(/"/g, '\\"')}"]` : '';
    const query = `mutation{generateShortLink(input:{originUrl:"${urlLimpa.replace(/"/g, '\\"')}"${campoSubIds}}){shortLink}}`;
    const payload = JSON.stringify({ query });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const assinatura = crypto
      .createHash('sha256')
      .update(appId + timestamp + payload + secret)
      .digest('hex');

    try {
      const { data } = await axios.post(ENDPOINT, payload, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${assinatura}`,
        },
      });

      const shortLink = data?.data?.generateShortLink?.shortLink;
      if (shortLink) return shortLink;

      console.warn(`[Shopee] API respondeu sem shortLink: ${JSON.stringify(data?.errors || data)}`);
      return this.fallback(urlLimpa);
    } catch (erro) {
      console.warn(`[Shopee] Erro na API (${erro.message}); usando fallback.`);
      return this.fallback(urlLimpa);
    }
  }

  /**
   * Fallback estrutural: URL limpa parametrizada com o appId
   * (mantém tracking básico caso a API esteja indisponível).
   */
  fallback(urlLimpa) {
    try {
      const url = new URL(urlLimpa);
      if (config.afiliados.shopee.appId) {
        url.searchParams.set('af_siteid', config.afiliados.shopee.appId);
      }
      return url.toString();
    } catch {
      return urlLimpa;
    }
  }
}
