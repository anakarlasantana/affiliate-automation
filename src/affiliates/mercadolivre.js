/**
 * mercadolivre.js
 * Mercado Livre Afiliados: nao ha API publica de conversao de links.
 *
 * Estrategia:
 *  1. Identifica o produto REAL por tras do link. Links meli.la normalmente
 *     apontam para vitrines /social/<slug>; com o token `ref` da URL o Meli
 *     renderiza o produto no HTML ("item_id":"MLB..."), entao usamos a URL
 *     expandida (antes da sanitizacao) para extrair o produto.
 *  2. Monta o link CANONICO do produto (/p/MLB... ou produto.mercadolivre...
 *     /MLB-<id>-_JM), que nunca cai na pagina de "perfil social" — o problema
 *     original em que o visitante via "produto inexistente".
 *  3. Aplica o tracking de afiliado (matt_tool/matt_word) no link final.
 *  4. Se nao houver produto identificavel e for vitrine de terceiro, faz
 *     fallback para a sua vitrine (MELI_SOCIAL_ID).
 */
import axios from 'axios';
import { AffiliateProvider } from './base.js';
import config from '../config.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Extrai um MLB-id de produto/catalogo a partir de HTML ou URL. */
function extrairMlbId(fonte) {
  if (!fonte) return null;
  try { fonte = decodeURIComponent(fonte); } catch {}
  // 1) "item_id":"MLBxxx" presente no HTML SSR (vitrine com ref, pags de produto)
  const mItem = fonte.match(/"item_id"\s*:\s*"(MLB\d+)"/);
  if (mItem) return mItem[1];
  // 2) pagina de catalogo: /p/MLBxxxx
  const mCatalogo = fonte.match(/\/p\/(MLB\d+)/);
  if (mCatalogo) return mCatalogo[1];
  // 3) anuncio classico: MLB-1234567890 ou MLB1234567890
  const mAnuncio = fonte.match(/\bMLB-(\d{9,})\b/) || fonte.match(/\bMLB(\d{10,})\b/);
  if (mAnuncio) return `MLB${mAnuncio[1]}`;
  return null;
}

/**
 * Monta a URL canonica do produto.
 * - Catalogo (id curto): https://www.mercadolivre.com.br/p/MLB<id>
 * - Anuncio (id longo): https://produto.mercadolivre.com.br/MLB-<digitos>-_JM
 *   (o slug e opcional; o Meli resolve apenas com o id)
 */
function urlCanonica(mlbId) {
  const digitos = mlbId.replace(/^MLB/, '');
  if (digitos.length >= 9) {
    return `https://produto.mercadolivre.com.br/MLB-${digitos}-_JM`;
  }
  return `https://www.mercadolivre.com.br/p/MLB${digitos}`;
}

/** Baixa o HTML de uma pagina do Meli (vitrine/produto). */
async function baixarHtml(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 8,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return typeof data === 'string' ? data : '';
  } catch (erro) {
    console.warn(`[MercadoLivre] Falha ao baixar pagina: ${erro.message}`);
    return '';
  }
}

/** Monta o link final com os parametros de tracking de afiliado. */
function aplicarTracking(urlDestino, affiliateId) {
  const url = new URL(urlDestino);
  for (const chave of [...url.searchParams.keys()]) {
    if (/^matt_/i.test(chave)) url.searchParams.delete(chave);
  }
  url.searchParams.set('matt_tool', affiliateId);
  url.searchParams.set('matt_word', 'affiliate');
  return url.toString();
}

export class MercadoLivreProvider extends AffiliateProvider {
  static dominios = ['mercadolivre.com.br', 'mercadolivre.com', 'meli.la', 'mercadolibre.com'];
  static nome = 'MercadoLivre';

  /**
   * @param {string} urlLimpa URL ja sanitizada (sem trackers)
   * @param {string} urlOriginal URL expandida original (com o token ref que
   *   faz o Meli renderizar o produto nas paginas de vitrine)
   */
  async converter(urlLimpa, urlOriginal = urlLimpa) {
    const affiliateId = config.afiliados.mercadolivre.affiliateId;
    const minhaVitrine = config.afiliados.mercadolivre.vitrine;
    if (!affiliateId) {
      console.warn('[MercadoLivre] MELI_AFFILIATE_ID nao configurada; ignorando oferta.');
      return null;
    }

    try {
      const caminho = new URL(urlLimpa).pathname;
      const ehVitrine = /\/social\/[\w-]+/.test(caminho);

      // 1) Tenta o MLB-id direto nas URLs recebidas (original tem o ref)
      let mlbId = extrairMlbId(urlOriginal) || extrairMlbId(urlLimpa);

      // 2) Vitrine ou URL sem id: baixa o HTML. Importante: usar a URL
      //    original — sem o token `ref` o Meli renderiza a vitrine generica
      //    (sem produto) e redireciona para /lists.
      if (!mlbId || ehVitrine) {
        console.log('   ↳ [MercadoLivre] Resolvendo produto a partir do HTML da pagina...');
        const html = await baixarHtml(urlOriginal);
        mlbId = extrairMlbId(html) || mlbId;
      }

      if (mlbId) {
        const canonica = urlCanonica(mlbId);
        console.log(`   ↳ [MercadoLivre] Produto identificado: ${mlbId} -> ${canonica}`);
        return aplicarTracking(canonica, affiliateId);
      }

      // 3) Fallback: vitrine de terceiro apontando para a sua vitrine
      const matchVitrine = caminho.match(/^\/social\/([\w-]+)/);
      if (matchVitrine && minhaVitrine) {
        const url = new URL(urlLimpa);
        url.pathname = `/social/${minhaVitrine}`;
        console.warn(
          `   ↷ [MercadoLivre] Produto nao identificado; vitrine /social/${matchVitrine[1]} -> sua vitrine /social/${minhaVitrine}`
        );
        return aplicarTracking(url.toString(), affiliateId);
      }

      console.warn('[MercadoLivre] Nao foi possivel identificar o produto; oferta descartada.');
      return null;
    } catch (erro) {
      console.warn(`[MercadoLivre] Falha ao converter: ${erro.message}`);
      return null;
    }
  }
}
