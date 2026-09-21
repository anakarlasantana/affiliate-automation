/**
 * linkResolver.js
 * Expansão de encurtadores (bypass de redirects) e sanitização
 * de parâmetros de afiliados concorrentes.
 */
import axios from 'axios';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Parâmetros de tracking removidos na sanitização. */
const PARAMS_MOALDITOS = [
  /^utm_/i, /^tag$/i, /^assoc_id$/i, /^ascsubtag$/i, /^linkcode$/i,
  /^camp$/i, /^creative$/i, /^creativeasin$/i, /^ref_?$/i, /^clickid$/i,
  /^subid\d*$/i, /^fbclid$/i, /^gclid$/i, /^aff_/i, /^matt_/i,
  /^affiliate/i, /^share_/i, /^af_siteid$/i, /^af_tran_id$/i, /^af_id$/i,
  /^vj$/i, /^sck$/i, /^_ims$/i, /^scm$/i, /^spm$/i, /^force flush$/i,
  /^gclsrc$/i, /^msclkid$/i, /^_gl$/i, /^mc_eid$/i, /^mc_cid$/i,
  /^vero_id$/i, /^wickedid$/i, /^igshid$/i, /^yclid$/i, /^_openstat$/i,
];

/** Domínios de tracking/ads que nunca são o destino real da oferta. */
const TRACKER_REGEX =
  /facebook\.net|googletagmanager|google-analytics|doubleclick|linksynergy|useinsider|hotjar|tiktok\.com\/i18n/i;

/**
 * Extrai a URL de destino de páginas que redirecionam via JavaScript
 * ou <meta refresh> (ex.: promobit.com.br/Redirect/to/...) — casos em
 * que o axios não segue porque não há redirect HTTP.
 * Só retorna URLs externas ao domínio da página (descarta pixels/trackers).
 * @param {string} html conteúdo HTML da página
 * @param {string} urlBase URL da página analisada
 * @returns {string|null} URL de destino ou null
 */
function extrairRedirectJS(html, urlBase) {
  if (!html || typeof html !== 'string') return null;

  let hostBase = '';
  try {
    hostBase = new URL(urlBase).hostname;
  } catch {
    return null;
  }

  const padroes = [
    // Padrão do Promobit: var _ = 3, s = Math.random(), l = 'https://loja.com/...'
    // (a URL fica atribuída à variável "l" dentro de um var com múltiplas declarações)
    /[,;{]\s*l\s*=\s*'(https?:\/\/[^'\s]+)'/,
    /\bvar\s+l\s*=\s*['"](https?:\/\/[^'"\s]+)['"]/,
    /(?:window\.)?location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/,
    /window\.location(?:\.href)?\s*=\s*['"](https?:\/\/[^'"]+)['"]/,
    /location\.replace\(\s*['"](https?:\/\/[^'"]+)['"]\s*\)/,
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=(https?:\/\/[^"'\s>]+)/i,
  ];

  for (const padrao of padroes) {
    const match = html.match(padrao);
    if (!match) continue;
    const candidata = match[1];
    if (TRACKER_REGEX.test(candidata)) continue;
    try {
      const url = new URL(candidata);
      if (url.hostname && url.hostname !== hostBase) return url.toString();
    } catch {
      // URL inválida — tenta o próximo padrão
    }
  }
  return null;
}

/**
 * Segue a cadeia de redirecionamentos até a URL final do marketplace.
 * Além de redirects HTTP (301/302), detecta páginas intermediárias que
 * redirecionam via JavaScript/meta refresh (ex.: links /Redirect do Promobit).
 * @param {string} urlEncurtada
 * @returns {Promise<string>} URL final (ou a original em caso de erro).
 */
export async function expandirLink(urlEncurtada) {
  try {
    const resposta = await axios.get(urlEncurtada, {
      maxRedirects: 8,
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const urlFinal = resposta?.request?.res?.responseUrl || resposta?.config?.url || urlEncurtada;

    // Página 200 com redirect via JS? Extrai o destino real (só dispara quando
    // a resposta é HTML de uma página intermediária — links diretos de loja
    // não contêm location.href/meta refresh apontando para outro domínio).
    const contentType = String(resposta?.headers?.['content-type'] || '');
    if (contentType.includes('text/html') && typeof resposta.data === 'string') {
      const destino = extrairRedirectJS(resposta.data, urlFinal);
      if (destino) {
        console.log(`   ↳ Redirect JS detectado: ${destino.slice(0, 90)}...`);
        return destino;
      }
    }
    return urlFinal;
  } catch (erro) {
    // Fallback: alguns encurtadores respondem melhor a HEAD
    try {
      const resposta = await axios.head(urlEncurtada, {
        maxRedirects: 8,
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      return resposta?.request?.res?.responseUrl || urlEncurtada;
    } catch {
      console.warn(`⚠️  Falha ao expandir ${urlEncurtada}: ${erro.message}`);
      return urlEncurtada;
    }
  }
}

/**
 * Desembrulha URLs de verificacao anti-bot do Mercado Livre
 * (/gz/account-verification?go=<url codificada>).
 * @param {string} url
 * @returns {string} URL real de destino (ou a original).
 */
export function desembrulharVerificacaoMeli(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('mercadolivre.com.br') && u.pathname.includes('/gz/account-verification')) {
      const go = u.searchParams.get('go');
      if (go && /^https?:\/\//.test(go)) return go;
    }
  } catch {}
  return url;
}

/**
 * Remove query strings de tracking/afiliados de terceiros.
 * @param {string} urlFinal
 * @param {RegExp[]} paramsExtras padrões específicos da loja (ver perfil da
 *   loja em affiliates/, ex.: `smtt` da Shopee, `pf_rd_*` da Amazon)
 * @returns {string} URL limpa.
 */
export function sanitizarUrl(urlFinal, paramsExtras = []) {
  try {
    const url = new URL(urlFinal);
    for (const chave of [...url.searchParams.keys()]) {
      const remover =
        PARAMS_MOALDITOS.some((regex) => regex.test(chave)) ||
        paramsExtras.some((regex) => regex.test(chave));
      if (remover) url.searchParams.delete(chave);
    }
    return url.toString();
  } catch {
    return urlFinal;
  }
}

/**
 * Extrai TODOS os links http(s) de um texto (na ordem).
 * @param {string} texto
 * @returns {string[]}
 */
export function extrairLinks(texto) {
  if (!texto) return [];
  return texto.match(/https?:\/\/[^\s<>()"'`]+/gi) || [];
}

/**
 * Desembrulha links de REDES de afiliados/redirectores (Awin, Lomadee, etc.)
 * que escondem a URL real da loja em um parâmetro da query (ued, url, target...).
 * Genérico: funciona com qualquer domínio cujo parâmetro aponte para outra URL http(s).
 * Aplica-se em cadeia (até 3 níveis: um redirector pode embrulhar outro).
 *
 * @param {string} url URL possivelmente embrulhada
 * @returns {string} URL real da loja (ou a original se nada encontrado)
 */
export function desembrulharAfiliadoRedirecionador(url) {
  const PARAMS_DESTINO = ['ued', 'url', 'u', 'target', 'destination', 'dest', 'go', 'to', 'redirect', 'link'];
  let atual = url;
  for (let nivel = 0; nivel < 3; nivel++) {
    let proxima = null;
    try {
      const u = new URL(atual);
      for (const param of PARAMS_DESTINO) {
        const valor = u.searchParams.get(param);
        if (!valor || !/^https?:\/\//i.test(valor)) continue;
        const destino = new URL(valor);
        // nunca desembrulha para o mesmo host (evita loops tipo ?url=<self>)
        if (destino.hostname !== u.hostname) {
          proxima = destino.toString();
          break;
        }
      }
    } catch {
      break;
    }
    if (!proxima) break;
    console.log(`   ↳ Link de afiliado desembrulhado: ...${proxima.slice(0, 90)}`);
    atual = proxima;
  }
  return atual;
}

/**
 * Extrai a FOTO DO PRODUTO da página da loja (nível 2 da cascata de imagem).
 * Usa og:image / twitter:image / og:image:secure_url / JSON-LD / <img>.
 * Retorna { base64, origem } — origem indica qual extrator achou.
 *
 * Estratégia anti-bot (Meli 403 no UA desktop): rotaciona User-Agents de
 * crawlers de link-preview (WhatsApp/Facebook/Telegram/mobile), que recebem
 * as meta tags de preview em ~100% dos casos.
 *
 * @param {string} urlProduto URL canônica do produto
 * @returns {Promise<{ base64: string, origem: string }|null>}
 */
export async function extrairImagemProduto(urlProduto) {
  try {
    if (!urlProduto || !/^https?:\/\//i.test(urlProduto)) return null;
    // Cadeia de UA: 1. WhatsApp (mesmo cliente que vai exibir o preview)
    // 2. facebookexternalhit  3. TelegramBot  4. Android mobile  5. desktop
    const UAS = [
      'WhatsApp/2.24.12.16 A',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      USER_AGENT,
    ];
    let html = '';
    for (const ua of UAS) {
      try {
        const resposta = await axios.get(urlProduto, {
          timeout: 12000,
          maxRedirects: 5,
          headers: { 'User-Agent': ua, Accept: 'text/html,*/*' },
          validateStatus: (s) => s >= 200 && s < 400,
        });
        html = typeof resposta.data === 'string' ? resposta.data : '';
        if (html && /og:image|twitter:image/i.test(html)) {
          if (ua !== UAS[UAS.length - 1]) console.log(`   🌐 HTML obtido com UA "${ua.slice(0, 24)}..."`);
          break;
        }
      } catch { /* tenta o próximo UA */ }
    }
    if (!html) return null;

    // meta tags de preview: og:image / og:image:secure_url / twitter:image
    // (com property antes ou depois do content, aspas simples ou duplas).
    // O decodeURIComponent cobre Meli/Shopee que escapam a URL (%2F, \u002F).
    const decode = (s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    };
    const padroes = [
      /<meta[^>]+(?:property|name)=["'](?:og:image:secure_url|og:image:url)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image:secure_url|og:image:url)["']/i,
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["']/i,
      // <link rel="image_src" href="..."> (fallback antigo, ainda usado)
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
      // JSON-LD: "image":"https://..." | "image":["https://..."] | objeto {url:...}
      /"image"\s*:\s*"(https?:\/\/[^"]+?\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
      /"image"\s*:\s*\[\s*"(https?:\/\/[^"]+?)"/i,
      /"image"\s*:\s*\{[^}]*?"url"\s*:\s*"(https?:\/\/[^"]+?)"/i,
    ];
    let urlImagem = null;
    let origem = 'site:og-image';
    for (const padrao of padroes) {
      const m = html.match(padrao);
      if (m && m[1]) {
        urlImagem = decode(m[1]).replace(/\\u002F/gi, '/');
        if (padrao.source.includes('image_src')) origem = 'site:link-image_src';
        else if (padrao.source.includes('"image"')) origem = 'site:json-ld';
        else origem = padrao.source.includes('secure_url') || padrao.source.includes('og:image:url') ? 'site:og-image-secure' : 'site:og-image';
        break;
      }
    }
    // Último recurso no HTML: primeira <img> com URL absoluta de produto
    if (!urlImagem) {
      const mImgs = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi) || [];
      for (const tagImg of mImgs) {
        const m = tagImg.match(/src=["']([^"']+)["']/i);
        if (m && m[1] && !/pixel|tracker|blank|spacer|logo|icon|sprite|avatar|bandeira|flag|pagamento/i.test(m[1]) && m[1].length > 30) {
          urlImagem = m[1];
          origem = 'site:img-tag';
          break;
        }
      }
    }
    if (!urlImagem) return null;

    // URLs relativas/protocol-relative
    if (urlImagem.startsWith('//')) urlImagem = 'https:' + urlImagem;
    else if (urlImagem.startsWith('/')) urlImagem = new URL(urlProduto).origin + urlImagem;
    if (!/^https?:\/\//i.test(urlImagem)) return null;

    const img = await axios.get(urlImagem, {
      timeout: 12000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const contentType = String(img.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    if (!/^image\/(jpeg|jpg|png|webp|gif)/i.test(contentType)) return null;
    // Rejeita imagem quebrada / pixel de tracking
    const buf = Buffer.from(img.data);
    if (buf.length < 5 * 1024) return null;

    return { base64: `data:${contentType};base64,${buf.toString('base64')}`, origem };
  } catch (erro) {
    console.warn(`   ⚠️  Falha ao buscar foto do produto: ${erro.message}`);
    return null;
  }
}

/**
 * As páginas "sociais" do Mercado Livre (mercadolivre.com.br/social/<perfil>,
 * para onde apontam os meli.la compartilhados pelo app) não são links de
 * produto, mas o HTML delas contém os deep links dos produtos exibidos
 * (no formato percent-encoded ou \u002F-escaped). Esta função baixa a página
 * e extrai o primeiro produto (MLB-...) encontrado.
 *
 * @param {string} urlSocial URL da página social (ou do encurtador original)
 * @returns {Promise<string|null>} URL canônica do produto ou null
 */
export async function extrairProdutoDePaginaSocialMeli(urlSocial) {
  try {
    const resposta = await axios.get(urlSocial, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        Accept: 'text/html,*/*',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const html = typeof resposta.data === 'string' ? resposta.data : '';
    if (!html.includes('MLB')) return null;

    // 1) URL completa de produto embutida na página (slug sempre termina em _JM)
    const mSlug = html.match(/(MLB-\d+[\w-]*?_JM)/i);
    if (mSlug) {
      const janela = html.slice(mSlug.index, mSlug.index + 300);
      const mVariacao = janela.match(/searchVariation(?:%3D|=)(\d+)/i);
      let url = 'https://www.mercadolivre.com.br/' + mSlug[1];
      if (mVariacao) url += '?searchVariation=' + mVariacao[1];
      return url;
    }

    // 2) Apenas o ID do item (paginas que embutem somente JSON: item_id / items)
    const mItem =
      html.match(/item_id[^"<]{0,25}?MLB(\d{6,})/i) ||
      html.match(/\\?"id\\?":\s*\\?"(MLB\d{6,})\\?"/) ||
      html.match(/MLB(\d{6,})/);
    if (mItem) {
      const id = mItem[1].replace(/\D/g, '');
      console.log('   ↳ ID extraído do JSON da página social: MLB' + id);
      return 'https://produto.mercadolivre.com.br/MLB-' + id + '-_JM';
    }
    return null;
  } catch (erro) {
    console.warn(`⚠️  Falha ao extrair produto da página social: ${erro.message}`);
    return null;
  }
}
