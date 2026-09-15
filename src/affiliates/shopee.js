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

    const query = `mutation{generateShortLink(input:{originUrl:"${urlLimpa.replace(/"/g, '\\"')}",subIds:["hi-cleo"]}){shortLink}}`;
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
