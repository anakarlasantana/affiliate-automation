/**
 * tiktokshop.js
 * TikTok Shop Afiliados: a geração de links ocorre manualmente no painel
 * (TikTok Shop Affiliate Center) — não há API pública de conversão.
 * Estratégia: URL limpa + parâmetro de afiliado configurável via .env.
 */
import { AffiliateProvider } from './base.js';
import config from '../config.js';

export class TikTokShopProvider extends AffiliateProvider {
  static dominios = ['tiktok.com', 'shop.tiktok.com', 'vt.tiktok.com'];
  static nome = 'TikTokShop';

  async converter(urlLimpa) {
    const affiliateId = config.afiliados.tiktokshop.affiliateId;
    if (!affiliateId) {
      console.warn('[TikTokShop] TIKTOKSHOP_AFFILIATE_ID não configurada; retornando URL limpa.');
      return urlLimpa;
    }
    try {
      const url = new URL(urlLimpa);
      url.searchParams.set('affiliate_id', affiliateId);
      return url.toString();
    } catch (erro) {
      console.warn(`[TikTokShop] Falha ao converter: ${erro.message}`);
      return urlLimpa;
    }
  }
}
