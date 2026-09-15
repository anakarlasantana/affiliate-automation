/**
 * amazon.js
 * Amazon Associates: conversão via parâmetro "tag" (sem necessidade de API).
 */
import { AffiliateProvider } from './base.js';
import config from '../config.js';

export class AmazonProvider extends AffiliateProvider {
  static dominios = ['amazon.com.br', 'amazon.com', 'amzn.to', 'amzn.to.br', 'a.co'];
  static nome = 'Amazon';

  async converter(urlLimpa) {
    const tag = config.afiliados.amazon.tag;
    if (!tag) {
      console.warn('[Amazon] AMAZON_TAG não configurada; ignorando oferta.');
      return null;
    }
    try {
      const url = new URL(urlLimpa);
      // Substitui qualquer tag de concorrente que tenha restado
      url.searchParams.set('tag', tag);
      return url.toString();
    } catch (erro) {
      console.warn(`[Amazon] Falha ao converter: ${erro.message}`);
      return urlLimpa;
    }
  }
}
