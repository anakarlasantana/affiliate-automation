/**
 * affiliates/index.js (Registry)
 * Detecta o domínio da URL limpa e delega a conversão ao provider correto.
 */
import { AmazonProvider } from './amazon.js';
import { ShopeeProvider } from './shopee.js';
import { MagaluProvider } from './magalu.js';
import { MercadoLivreProvider } from './mercadolivre.js';
import { SheinProvider } from './shein.js';
import { TikTokShopProvider } from './tiktokshop.js';
import { GenericProvider } from './generic.js';
import config from '../config.js';

const PROVIDERS = [
  AmazonProvider,
  ShopeeProvider,
  MagaluProvider,
  MercadoLivreProvider,
  SheinProvider,
  TikTokShopProvider,
];

/** Perfil "vazio" — usado por URLs sem provider dedicado. */
const PERFIL_VAZIO = {
  urlNaoProduto: [],
  mergulhador: null,
  idProduto: null,
  paramsRemover: [],
};

/** Páginas que NUNCA são produto, de qualquer loja (convites/agregadores). */
const NAO_PRODUTO_GLOBAL = [
  /linktr\.ee/i,
  /beacons\.ai/i,
  /linkin\.bio/i,
  /taplink\.cc/i,
  /^https?:\/\/t\.me\//i,
  /chat\.whatsapp\.com/i,
  /^https?:\/\/wa\.me\//i,
  /instagram\.com/i,
  /youtube\.com/i,
  /youtu\.be/i,
  /facebook\.com/i,
];

/**
 * Resolve a loja (provider) que atende uma URL, junto com as PECULIARIDADES
 * de link daquela loja. É a única porta de entrada do pipeline: o genérico
 * (fluxo de captura/limpeza/envio) é comum, o peculiar fica no perfil da loja.
 *
 * @param {string} url
 * @returns {{ loja: string, perfil: object, ativa: boolean, faltantes: string[], criar: Function }|null}
 *   null quando nenhuma loja conhecida atende a URL.
 */
export function perfilDeUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  // 1) Providers dedicados (cada loja com o seu perfil)
  for (const Provider of PROVIDERS) {
    if (Provider.match(hostname)) {
      return {
        loja: Provider.nome,
        perfil: { ...PERFIL_VAZIO, ...(Provider.perfil || {}) },
        ativa: Provider.estaConfigurado(),
        faltantes: Provider.credenciaisFaltantes(),
        criar: () => new Provider(),
      };
    }
  }

  // 2) Providers genéricos configurados via .env
  const host = hostname.replace(/^www\./, '');
  for (const gen of config.afiliados.genericos) {
    if (host === gen.dominio || host.endsWith('.' + gen.dominio)) {
      return {
        loja: `Generic(${gen.dominio})`,
        perfil: PERFIL_VAZIO,
        ativa: true,
        faltantes: [],
        criar: () => new GenericProvider(gen),
      };
    }
  }

  return null;
}

/**
 * A URL é uma página que NUNCA deve ser tratada como produto?
 * (perfil de grupo, vitrine, landing de cupom, convite de outro canal...)
 * @param {string} url
 * @returns {boolean}
 */
export function ehPaginaNaoProduto(url) {
  if (!url) return true;
  if (NAO_PRODUTO_GLOBAL.some((regex) => regex.test(url))) return true;
  const alvo = perfilDeUrl(url);
  if (!alvo) return false;
  return alvo.perfil.urlNaoProduto.some((regex) => regex.test(url));
}

/**
 * Página intermediária da loja que esconde o produto real no HTML
 * (ex.: mercadolivre.com.br/social/<perfil>) → devolve o mergulhador.
 * @param {string} url
 * @returns {{ nome: string, matches: Function, extrair: Function }|null}
 */
export function resolverMergulhador(url) {
  const alvo = perfilDeUrl(url);
  const mergulhador = alvo?.perfil?.mergulhador;
  if (!mergulhador) return null;
  return mergulhador.matches(url) ? mergulhador : null;
}

/** Parâmetros de tracking extras da loja que atende a URL. */
export function paramsRemoverPara(url) {
  return perfilDeUrl(url)?.perfil?.paramsRemover || [];
}

/**
 * Identidade do produto (MLB-…, ASIN, shopId.itemId…), independente de
 * encurtador/slug/vitrine — usada para deduplicar o MESMO item.
 * @param {string} url
 * @returns {string|null} ex.: "meli:MLB3914883071", "amazon:B0XXXXXXXX"
 */
export function chaveProduto(url) {
  const alvo = perfilDeUrl(url);
  if (!alvo?.perfil?.idProduto) return null;
  try {
    return alvo.perfil.idProduto(new URL(url)) || null;
  } catch {
    return null;
  }
}

/**
 * Panorama das lojas para o painel de boot e para o `npm run status`:
 * lembra quais credenciais ainda faltam no .env.
 * @returns {{ loja: string, ativa: boolean, faltantes: string[] }[]}
 */
export function resumoLojas() {
  return PROVIDERS.map((Provider) => ({
    loja: Provider.nome,
    ativa: Provider.estaConfigurado(),
    faltantes: Provider.credenciaisFaltantes(),
  }));
}

/**
 * Converte uma URL limpa em link de afiliado.
 * NUNCA devolve link sem afiliação: loja sem credencial é descartada.
 * @param {string} urlLimpa URL sanitizada
 * @param {string} urlOriginal URL expandida original (com tokens que algumas
 *   lojas precisam para identificar o produto, ex.: ref do Mercado Livre)
 * @returns {Promise<{ meuLink: string, loja: string, motivo?: string, faltantes?: string[] }>}
 *   `meuLink` vazio = oferta não deve ser publicada.
 */
export async function converterParaAfiliado(urlLimpa, urlOriginal = urlLimpa) {
  const alvo = perfilDeUrl(urlLimpa) || perfilDeUrl(urlOriginal);

  if (!alvo) {
    return { meuLink: '', loja: 'desconhecida', motivo: 'sem-provider' };
  }
  if (!alvo.ativa) {
    return { meuLink: '', loja: alvo.loja, motivo: 'sem-credencial', faltantes: alvo.faltantes };
  }

  try {
    const meuLink = await alvo.criar().converter(urlLimpa, urlOriginal);
    if (!meuLink) return { meuLink: '', loja: alvo.loja, motivo: 'sem-link' };
    return { meuLink, loja: alvo.loja };
  } catch (erro) {
    console.warn(`[${alvo.loja}] Falha ao converter: ${erro.message}`);
    return { meuLink: '', loja: alvo.loja, motivo: 'erro' };
  }
}
