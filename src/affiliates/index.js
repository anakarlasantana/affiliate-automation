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

/**
 * Converte uma URL limpa em link de afiliado.
 * Retorna a URL limpa inalterada se nenhum provider atender o domínio.
 * @param {string} urlLimpa URL sanitizada
 * @param {string} urlOriginal URL expandida original (com tokens que algumas
 *   lojas precisam para identificar o produto, ex.: ref do Mercado Livre)
 * @returns {Promise<{ meuLink: string, loja: string }>}
 */
export async function converterParaAfiliado(urlLimpa, urlOriginal = urlLimpa) {
  let hostname;
  try {
    hostname = new URL(urlLimpa).hostname;
  } catch {
    return { meuLink: urlLimpa, loja: 'desconhecida' };
  }

  // 1) Providers dedicados
  for (const Provider of PROVIDERS) {
    if (Provider.match(hostname)) {
      const meuLink = await new Provider().converter(urlLimpa, urlOriginal);
      return { meuLink, loja: Provider.nome };
    }
  }

  // 2) Providers genéricos configurados via .env
  const host = hostname.replace(/^www\./, '');
  for (const gen of config.afiliados.genericos) {
    if (host === gen.dominio || host.endsWith('.' + gen.dominio)) {
      const meuLink = await new GenericProvider(gen).converter(urlLimpa);
      return { meuLink, loja: `Generic(${gen.dominio})` };
    }
  }

  return { meuLink: urlLimpa, loja: 'sem-provider' };
}
