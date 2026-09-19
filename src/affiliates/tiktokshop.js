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
  static credenciaisRequeridas = ['TIKTOKSHOP_AFFILIATE_ID'];

  /** TikTok: só links de PRODUTO interessam (vídeo/perfil não é oferta). */
  static perfil = {
    urlNaoProduto: [/\/@[^/]+\/video\//, /\/@[^/]+\/?$/, /\/discover/],
    mergulhador: null,
    idProduto: (url) => {
      const porRota = url.pathname.match(/\/product\/(\d+)/);
      if (porRota) return `tiktok:${porRota[1]}`;
      const porQuery = url.searchParams.get('product_id');
      return porQuery ? `tiktok:${porQuery}` : null;
    },
    /** parâmetros do botão "compartilhar" do app */
    paramsRemover: [/^_d$/i, /^share_link_id$/i, /^tt_from$/i, /^is_from_webapp$/i, /^sender_device$/i, /^checksum$/i],
  };

  async converter(urlLimpa) {
    const affiliateId = config.afiliados.tiktokshop.affiliateId;
    if (!affiliateId) {
      console.warn('[TikTokShop] TIKTOKSHOP_AFFILIATE_ID não configurada; oferta ignorada (não publicamos link sem afiliação).');
      return null;
    }
    try {
      const url = new URL(urlLimpa);
      url.searchParams.set('affiliate_id', affiliateId);
      return url.toString();
    } catch (erro) {
      console.warn(`[TikTokShop] Falha ao converter: ${erro.message}`);
      return null;
    }
  }
}
