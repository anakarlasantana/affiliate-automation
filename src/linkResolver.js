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
export function extrairRedirectJS(html, urlBase) {
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
 * @returns {string} URL limpa.
 */
export function sanitizarUrl(urlFinal) {
  try {
    const url = new URL(urlFinal);
    for (const chave of [...url.searchParams.keys()]) {
      if (PARAMS_MOALDITOS.some((regex) => regex.test(chave))) {
        url.searchParams.delete(chave);
      }
    }
    return url.toString();
  } catch {
    return urlFinal;
  }
}

/**
 * Extrai o primeiro link http(s) de um texto.
 * @param {string} texto
 * @returns {string|null}
 */
export function extrairPrimeiroLink(texto) {
  if (!texto) return null;
  const match = texto.match(/https?:\/\/[^\s<>()"'`]+/i);
  return match ? match[0] : null;
}
