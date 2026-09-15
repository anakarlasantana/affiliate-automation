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
