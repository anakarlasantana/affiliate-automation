/**
 * amazon.js
 * Amazon Associates: conversão via parâmetro "tag" (sem necessidade de API).
 */
import { AffiliateProvider } from './base.js';
import config from '../config.js';

export class AmazonProvider extends AffiliateProvider {
  static dominios = ['amazon.com.br', 'amazon.com', 'amzn.to', 'amzn.to.br', 'a.co'];
  static nome = 'Amazon';
  static credenciaisRequeridas = ['AMAZON_TAG'];

  /** Amazon: o produto é identificado pelo ASIN (/dp/<ASIN>, /gp/product/<ASIN>). */
  static perfil = {
    urlNaoProduto: [/\/stores?\//i, /\/gp\/bestsellers/i, /\/s\?k=/i, /\/b\?/i],
    mergulhador: null,
    idProduto: (url) => {
      const m = url.pathname.match(/\/(?:dp|gp\/product|d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      return m ? `amazon:${m[1].toUpperCase()}` : null;
    },
    /** rastros de widgets internos da Amazon */
    paramsRemover: [/^pf_rd_/i, /^pd_rd_/i, /^qid$/i, /^sr$/i, /^th$/i, /^_encoding$/i, /^content-id$/i],
  };

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
