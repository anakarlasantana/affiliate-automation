/**
 * shein.js
 * Shein Afiliados: sem API pública estável.
 * Estratégia: URL limpa + parâmetro de afiliado configurável via .env.
 */
import { AffiliateProvider } from './base.js';
import config from '../config.js';

export class SheinProvider extends AffiliateProvider {
  static dominios = ['shein.com', 'br.shein.com', 'shein.com.br', 'shein.top'];
  static nome = 'Shein';
  static credenciaisRequeridas = ['SHEIN_AFFILIATE_ID'];

  /** Shein: o produto é identificado pelo id em -p-<id>.html. */
  static perfil = {
    urlNaoProduto: [/\/cart(\/|$)/, /\/category\//, /\/store\//],
    mergulhador: null,
    idProduto: (url) => {
      const m = url.pathname.match(/-p-(\d+)\.html/) || url.pathname.match(/\/(?:product|goods)\/(\d+)/);
      return m ? `shein:${m[1]}` : null;
    },
    /** url_from/share_from vêm do botão "compartilhar" do app */
    paramsRemover: [/^url_from$/i, /^second_share$/i, /^share_from$/i, /^goods_id$/i, /^mallcode$/i],
  };

  async converter(urlLimpa) {
    const affiliateId = config.afiliados.shein.affiliateId;
    if (!affiliateId) {
      console.warn('[Shein] SHEIN_AFFILIATE_ID não configurada; oferta ignorada (não publicamos link sem afiliação).');
      return null;
    }
    try {
      const url = new URL(urlLimpa);
      url.searchParams.set('aff_id', affiliateId);
      return url.toString();
    } catch (erro) {
      console.warn(`[Shein] Falha ao converter: ${erro.message}`);
      return null;
    }
  }
}
