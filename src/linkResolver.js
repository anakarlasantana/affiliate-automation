/**
 * linkResolver.js
 * Expansão de encurtadores (bypass de redirects) e sanitização
 * de parâmetros de afiliados concorrentes.
 */
import axios from 'axios';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Máximo de saltos (HTTP + JS) numa mesma expansão de link. */
const MAX_SALTOS_EXPANSAO = 4;

/** Parâmetros de tracking removidos na sanitização. */
const PARAMS_MOALDITOS = [
  /^utm_/i, /^tag$/i, /^assoc_id$/i, /^ascsubtag$/i, /^linkcode$/i,
  /^camp$/i, /^creative$/i, /^creativeasin$/i, /^ref_?$/i, /^clickid$/i,
  /^subid\d*$/i, /^fbclid$/i, /^gclid$/i, /^aff_/i, /^matt_/i,
  /^affiliate/i, /^share_/i, /^af_siteid$/i, /^af_tran_id$/i, /^af_id$/i,
  /^vj$/i, /^sck$/i, /^_ims$/i, /^scm$/i, /^spm$/i, /^force flush$/i,
  /^gclsrc$/i, /^msclkid$/i, /^_gl$/i, /^mc_eid$/i, /^mc_cid$/i,
  /^vero_id$/i, /^wickedid$/i, /^igshid$/i, /^yclid$/i, /^_openstat$/i,
  // Wrappers de afiliado/app mobile de terceiros — GENÉRICOS (valem para
  // qualquer loja). Caso real: link Shopee opaanlp carregando mmp_pid/
  // gads_t_sig/__mobile__/exp_group/credential_token de OUTRO afiliado,
  // que sujava a URL enviada à API e gerava shortlink frágil.
  /^mmp_/i, /^gads_/i, /^__mobile__$/i, /^exp_group$/i, /^credential_token$/i,
  /^forceInApp$/i, /^ttclid$/i, /^twclid$/i, /^dclid$/i, /^srsltid$/i,
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
    // Fallback: a página de redirect do Promobit anuncia o destino também no
    // âncora "clique aqui" — cobre casos em que o JS mude de formato.
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>[^<]*clique\s+aqui/i,
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
 * Um salto de expansão: segue os redirects HTTP (301/302) de `urlAtual` e,
 * se a página final for HTML com redirect via JavaScript/meta refresh, devolve
 * o destino apontado (ex.: promoby.me -> api.promobit.com.br/v4/redirect/...).
 * @param {string} urlAtual
 * @returns {Promise<{ urlFinal: string, destino: string|null }>}
 */
async function expandirUmSalto(urlAtual) {
  try {
    const resposta = await axios.get(urlAtual, {
      maxRedirects: 8,
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const urlFinal =
      resposta?.request?.res?.responseUrl || resposta?.config?.url || urlAtual;

    // Página 200 com redirect via JS? Extrai o destino real (só dispara quando
    // a resposta é HTML de uma página intermediária — links diretos de loja
    // não contêm location.href/meta refresh apontando para outro domínio).
    const contentType = String(resposta?.headers?.['content-type'] || '');
    if (contentType.includes('text/html') && typeof resposta.data === 'string') {
      const destino = extrairRedirectJS(resposta.data, urlFinal);
      return { urlFinal, destino };
    }
    return { urlFinal, destino: null };
  } catch (erro) {
    // Fallback: alguns encurtadores respondem melhor a HEAD
    try {
      const resposta = await axios.head(urlAtual, {
        maxRedirects: 8,
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      return {
        urlFinal: resposta?.request?.res?.responseUrl || urlAtual,
        destino: null,
      };
    } catch {
      console.warn(`⚠️  Falha ao expandir ${urlAtual}: ${erro.message}`);
      return { urlFinal: urlAtual, destino: null };
    }
  }
}

/**
 * Segue a cadeia de redirecionamentos até a URL final do marketplace.
 * Além de redirects HTTP (301/302), detecta páginas intermediárias que
 * redirecionam via JavaScript/meta refresh (ex.: promoby.me e /Redirect do
 * Promobit) e RE-EXPANDE o destino — o Promobit encadeia
 * promoby.me -> api.promobit.com.br/v4/redirect/<código> -> encurtador da
 * loja (meli.la, s.shopee...), então um único salto parava no encurtador e
 * a URL "limpa" ficava suja. Máximo de MAX_SALTOS_EXPANSAO saltos, com
 * guarda de loop (URL já visitada não é reprocessada).
 * @param {string} urlEncurtada
 * @returns {Promise<string>} URL final (ou a original em caso de erro).
 */
export async function expandirLink(urlEncurtada) {
  let atual = urlEncurtada;
  const visitadas = new Set();
  for (let salto = 0; salto < MAX_SALTOS_EXPANSAO; salto++) {
    if (visitadas.has(atual)) break;
    visitadas.add(atual);
    const { urlFinal, destino } = await expandirUmSalto(atual);
    if (!destino) return urlFinal;
    console.log(`   ↳ Redirect JS detectado: ${destino.slice(0, 90)}...`);
    // Próximo salto parte do DESTINO (não da página intermediária).
    atual = destino;
  }
  return atual;
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
 * RESOLUÇÃO ALTA (Nível 2.5) — upgrade da foto sem trocar de fonte.
 *
 * A Magalu serve a MESMA foto em vários tamanhos e o tamanho vem no CAMINHO
 * da URL (a-static.mlcdn.com.br/470x352/.../arquivo.jpg). O og:image aponta
 * para a miniatura (470x352, ~16 KB) — por isso a foto do Magalu saía em
 * resolução baixa no grupo. Reescrevendo o segmento do tamanho, o mesmo
 * arquivo vem em resolução cheia (validado ao vivo: 1280x1280 -> 116 KB,
 * 1280x965).
 *
 * Só reescreve CDN que tem o tamanho no caminho e que SEMPRE devolve 200
 * nesse formato; qualquer outro host fica intacto (fallback silencioso).
 */
const CDN_COM_TAMANHO = /^(https:\/\/a-static\.mlcdn\.com\.br\/)(\d+x\d+|\{w\}x\{h\})(\/.*)$/i;

/** Maior resolução pedida no upgrade (acima disso o ganho não paga o download). */
const TAMANHO_ALVO = '1280x1280';

/**
 * Reescreve a URL de uma CDN com tamanho no caminho para a resolução alta.
 * @param {string} url
 * @returns {string|null} nova URL ou null quando não é uma CDN aplicável
 */
export function subirResolucao(url) {
  if (!url) return null;
  const m = String(url).match(CDN_COM_TAMANHO);
  if (!m) return null;
  const [, base, , resto] = m;
  // O próprio `{w}x{h}` é placeholder de template: trocar pelo tamanho alvo
  // também funciona e evita baixar uma URL que nunca existiu.
  return `${base}${TAMANHO_ALVO}${resto}`;
}

/**
 * Descarta as URLs de galeria que não são foto do produto: sprite, logo,
 * badge, placeholder e ícones. Genérico o bastante para qualquer loja
 * (mlstatic, mlcdn, shopee, magalu) — não é hack por CDN.
 */
const RUIDO_GALERIA =
  /frontend-assets|sprite|logo|badge|icon|placeholder|blank|spacer|pixel|tracker|banner|selo|\.svg|\/D_NQ_\/|\/D_Q_NP_\//i;

/**
 * Coleta as URLs de imagem da galeria a partir do HTML do produto.
 * Ordena pela maior resolução aparente (o `og:image` costuma vir primeiro e
 * em tamanho cheio, então ele é a primeira opção).
 *
 * @param {string} html
 * @returns {string[]} URLs absolutas candidatas
 */
export function extrairGaleria(html) {
  if (!html || typeof html !== 'string') return [];
  const achadas = [
    ...html.matchAll(
      /https:\/\/[a-z0-9.-]*(?:mlstatic|mlcdn|shopee|shopeeimg|magazineluiza|magazinevoce)[a-z0-9.-]*\.[a-z]{2,6}\/[^"'\s\\<>]+?\.(?:jpg|jpeg|png|webp)/gi,
    ),
  ].map((m) => m[0]);
  const unicas = [...new Set(achadas)].filter((u) => !RUIDO_GALERIA.test(u));
  // Chave de ordenação: o nome do arquivo do Meli traz o MLB/tamanho
  // (D_Q_NP_926032-MLB81783442178_012025-V-nome.jpg) — o maior vence.
  return unicas.sort((a, b) => scoreGaleria(b) - scoreGaleria(a));
}

/** Nota grosseira de qualidade: variantes grandes (V/O/F) antes das miniaturas. */
function scoreGaleria(url) {
  const u = String(url);
  const variante = u.match(/_(?:V|O|F)-|_V\d+-|-I\.|_C\./i);
  let score = variante ? 10 : 0;
  const tam = u.match(/(\d{2,4})x(\d{2,4})/);
  if (tam) score += Math.min(20, Math.max(Number(tam[1]), Number(tam[2])) / 100);
  if (/-{2,}/.test(u)) score -= 1; // URL com placeholder {w}x{h}
  return score;
}

/**
 * Extrai a FOTO DO PRODUTO da página da loja (nível 2 da cascata de imagem).
 * Usa og:image / twitter:image / og:image:secure_url / JSON-LD / <img>.
 * Retorna { base64, origem } — origem indica qual extrator achou.
 *
 * @param {string} urlProduto URL canônica do produto
 * @returns {Promise<{ base64: string, origem: string }|null>}
 */
/** Decodifica as entidades HTML mais comuns de um título (og:title/title). */
function decodificarEntidades(texto) {
  const mapa = {
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
  };
  return String(texto || '').replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => mapa[m] || m);
}

export async function extrairImagemProduto(urlProduto) {
  return extrairImagemDaPagina(urlProduto, { permitirGaleria: false });
}

/**
 * Igual a extrairImagemProduto, mas aceita a GALERIA da página como origem
 * de imagem (Nível 2.5). Usada quando a oferta não tem foto nem og:image:
 * nas lojas que não têm API pública de imagem (Mercado Livre), a galeria é a
 * única fonte que devolve a foto do produto.
 *
 * @param {string} urlProduto
 * @returns {Promise<{ base64: string, origem: string }|null>}
 */
export async function extrairImagemDaLoja(urlProduto) {
  return extrairImagemDaPagina(urlProduto, { permitirGaleria: true });
}

/**
 * Baixa a imagem de uma URL DIRETA (o que a API oficial da loja devolve —
 * ex.: a `imageUrl` do ProductOfferV2 da Shopee). Não é uma página: não há
 * HTML nem meta tag, só o arquivo. Passa pelo mesmo upgrade de resolução
 * quando a CDN permitir, para a foto da API sair na mesma qualidade das
 * demais.
 *
 * @param {string} urlImagem
 * @returns {Promise<{ base64: string, origem: string }|null>}
 */
export async function extrairImagemDeUrl(urlImagem) {
  if (!urlImagem) return null;
  try {
    const baixada = await baixarComUpgrade(urlImagem);
    if (!baixada) return null;
    const origem = baixada.origem || 'loja:api-imagem';
    console.log(
      `   🖼️  Foto [${origem}] (${Math.round(baixada.bytes / 1024)} KB) — ${String(urlImagem).slice(0, 76)}`,
    );
    return { base64: baixada.dataUrl, origem };
  } catch (erro) {
    console.warn(`   ⚠️  Falha ao baixar a imagem informada: ${erro.message}`);
    return null;
  }
}

/** Baixa uma URL de imagem e devolve data-URL (ou null se não for imagem). */
async function baixarImagem(urlImagem) {
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
  return { dataUrl: `data:${contentType};base64,${buf.toString('base64')}`, bytes: buf.length };
}

/**
 * Baixa a imagem preferindo a resolução ALTA quando a CDN permite reescrever
 * o tamanho (Magalu). Se a versão alta falhar, devolve a original — nunca
 * perde a oferta por causa do upgrade.
 */
async function baixarComUpgrade(urlImagem) {
  const alta = subirResolucao(urlImagem);
  if (alta && alta !== urlImagem) {
    try {
      const r = await baixarImagem(alta);
      if (r) return { ...r, origem: 'site:og-image-hd' };
    } catch { /* cai para a original */ }
  }
  const normal = await baixarImagem(urlImagem);
  return normal ? { ...normal, origem: null } : null;
}

/**
 * Deriva a URL CANÔNICA do produto a partir de uma URL que respondeu 404.
 * O Mercado Livre tirou do ar a página www.../MLB-<id>-<slug>-_JM mas mantém
 * a canônica em outro host: produto.mercadolivre.com.br/MLB-<id>-_JM. Sem
 * isso a busca de foto caía no placeholder mesmo com o produto no ar.
 * @param {string} url
 * @returns {string|null}
 */
export function urlCanonicaDeProduto(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const mlb = u.pathname.match(/\/MLB-(\d{9,})/i) || u.pathname.match(/\/p\/(MLB\d+)/i);
  if (mlb) {
    const id = mlb[1].replace(/^MLB-?/, '');
    return `https://produto.mercadolivre.com.br/MLB-${id}-_JM`;
  }
  return null;
}

/**
 * Corpo compartilhado por extrairImagemProduto/extrairImagemDaLoja.
 * @param {string} urlProduto
 * @param {{ permitirGaleria: boolean }} opcoes
 */
async function extrairImagemDaPagina(urlProduto, { permitirGaleria }) {
  try {
    // Algumas lojas (ex.: Mercado Livre) só servem as meta tags de preview
    // para crawlers de link-preview (Facebook/WhatsApp). Tentamos os dois UAs.
    const UAS = [
      'WhatsApp/2',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
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
        if (html && /og:image|twitter:image/i.test(html)) break;
      } catch (e) {
        // 404 é DEFINITIVO: a página canônica existe e a com slug não. Repetir
        // com outro User-Agent só gasta 3x o tempo — tenta a canônica logo.
        if (e.response?.status === 404) {
          const canonica = urlCanonicaDeProduto(urlProduto);
          if (canonica && canonica !== urlProduto) {
            console.log(`   ↪ 404 na página do produto; tentando a URL canônica: ${canonica}`);
            return extrairImagemDaPagina(canonica, { permitirGaleria });
          }
          break;
        }
        /* tenta o próximo UA */
      }
    }
    // Sem log aqui o sintoma fica invisível: a oferta cai no placeholder sem
    // dizer QUAL página foi testada (foi assim que o caso Shopee passou batido).
    if (!html) {
      console.log(`   🔎 Site sem HTML utilizável para foto: ${urlProduto}`);
      return null;
    }

    // meta tags de preview: og:image / twitter:image / og:image:secure_url
    // (com property antes ou depois do content, aspas simples ou duplas)
    const padroes = [
      /<meta[^>]+(?:property|name)=["'](?:og:image:secure_url)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image:secure_url|og:image|twitter:image)["']/i,
      // JSON-LD: "image":"https://..." ou "image":["https://..."]
      /"image"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
      /"image"\s*:\s*\[\s*"(https?:\/\/[^"]+?)"/i,
    ];
    let urlImagem = null;
    let origem = 'site:og-image';
    for (const padrao of padroes) {
      const m = html.match(padrao);
      if (m && m[1]) {
        urlImagem = m[1];
        if (padrao.source.includes('"image"')) origem = 'site:json-ld';
        break;
      }
    }
    // Último recurso no HTML: primeira <img> com URL absoluta de produto
    if (!urlImagem) {
      const mImg = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
      if (mImg && mImg[1] && !/pixel|tracker|blank|spacer|logo/i.test(mImg[1])) {
        urlImagem = mImg[1];
        origem = 'site:img-tag';
      }
    }
    // NÍVEL 2.5 — galeria da própria página. Necessária nas lojas sem API
    // pública de imagem (Mercado Livre: a API oficial responde 403 sem token).
    // Só entra aqui quando o og:image NÃO resolveu; com og:image, a galeria
    // é redundante (e o upgrade de resolução já foi aplicado nele).
    const candidatasGaleria = permitirGaleria ? extrairGaleria(html).slice(0, 4) : [];
    if (!urlImagem && !candidatasGaleria.length) {
      console.log(`   🔎 Página sem og:image/imagem utilizável: ${urlProduto}`);
      return null;
    }

    /**
     * Título da página (og:title, senão <title>) — vai para o criativo do story.
     * Sai do MESMO HTML já baixado para a imagem: nenhum request extra.
     */
    const tituloPagina = decodificarEntidades(
      (
        html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) ||
        []
      )[1] || '',
    ).trim();

    /** Absolutiza a URL, baixa (com upgrade) e registra a origem. */
    const tentar = async (url, rotulo) => {
      let alvo = url;
      if (alvo.startsWith('//')) alvo = 'https:' + alvo;
      else if (alvo.startsWith('/')) alvo = new URL(urlProduto).origin + alvo;
      if (!/^https?:\/\//i.test(alvo)) return null;
      const baixada = await baixarComUpgrade(alvo);
      if (!baixada) return null;
      const final = baixada.origem || rotulo;
      console.log(
        `   🖼️  Foto do produto [${final}] (${Math.round(baixada.bytes / 1024)} KB) — ${alvo.slice(0, 76)}`,
      );
      return { base64: baixada.dataUrl, origem: final, titulo: tituloPagina };
    };

    if (urlImagem) {
      const r = await tentar(urlImagem, origem);
      if (r) return r;
    }
    for (const [i, url] of candidatasGaleria.entries()) {
      const r = await tentar(url, 'site:galeria');
      if (r) return { ...r, origem: `site:galeria#${i + 1}` };
    }
    console.log(`   🔎 Nenhuma imagem da página pôde ser baixada: ${urlProduto}`);
    return null;
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
