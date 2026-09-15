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

  async converter(urlLimpa) {
    const affiliateId = config.afiliados.shein.affiliateId;
    if (!affiliateId) {
      console.warn('[Shein] SHEIN_AFFILIATE_ID não configurada; retornando URL limpa.');
      return urlLimpa;
    }
    try {
      const url = new URL(urlLimpa);
      url.searchParams.set('aff_id', affiliateId);
      return url.toString();
    } catch (erro) {
      console.warn(`[Shein] Falha ao converter: ${erro.message}`);
      return urlLimpa;
    }
  }
}
