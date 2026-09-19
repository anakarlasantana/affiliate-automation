/**
 * magalu.js
 * Parceiro Magalu: reescreve o domínio para magazinevoce.com.br/magazine{SUA_LOJA}.
 * Ex.: https://www.magazineluiza.com.br/produto/p/1234/
 *   -> https://www.magazinevoce.com.br/magazineminhaloja/produto/p/1234/
 */
import { AffiliateProvider } from './base.js';
import config from '../config.js';

export class MagaluProvider extends AffiliateProvider {
  static dominios = ['magazineluiza.com.br', 'magalu.com', 'magazinevoce.com.br'];
  static nome = 'Magalu';
  static credenciaisRequeridas = ['MAGALU_STORE_ID'];

  /** Magalu: o produto é identificado pelo id depois de /p/<id>. */
  static perfil = {
    urlNaoProduto: [/\/busca(\/|\?|$)/i, /\/categoria\//i, /\/ofertas-do-dia/i],
    mergulhador: null,
    idProduto: (url) => {
      const m = url.pathname.match(/\/p\/([^/]+)/);
      return m ? `magalu:${m[1]}` : null;
    },
    /** itag = tag de campanha; offer_id/pid variam por vitrine de terceiro */
    paramsRemover: [/^itag$/i, /^pid$/i, /^offer_id$/i, /^partner_id$/i],
  };

  async converter(urlLimpa) {
    const loja = config.afiliados.magalu.loja;
    if (!loja) {
      console.warn('[Magalu] MAGALU_STORE_ID não configurada; ignorando oferta.');
      return null;
    }
    try {
      const url = new URL(urlLimpa);
      url.host = 'www.magazinevoce.com.br';
      // Remove prefixo /magazineXXX de outro afiliado antes de colocar o meu
      const pathSemLoja = url.pathname.replace(/^\/+/, '').replace(/^magazine[^/]+\//, '');
      url.pathname = `/magazine${loja}/${pathSemLoja}`;
      return url.toString();
    } catch (erro) {
      console.warn(`[Magalu] Falha ao converter: ${erro.message}`);
      return null;
    }
  }
}
