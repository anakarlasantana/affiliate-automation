/**
 * generic.js
 * Provider genérico: permite adicionar NOVAS lojas de afiliados
 * apenas via .env, sem escrever código.
 *
 * Formato no .env:
 *   AFFILIATE_GENERIC_1=dominio.com:parametro:valor
 */
import { AffiliateProvider } from './base.js';
import config from '../config.js';

export class GenericProvider extends AffiliateProvider {
  /**
   * @param {{dominio: string, parametro: string, valor: string}} cfg
   */
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.dominio = cfg.dominio;
  }

  static nome = 'Generic';

  async converter(urlLimpa) {
    try {
      const url = new URL(urlLimpa);
      url.searchParams.set(this.cfg.parametro, this.cfg.valor);
      return url.toString();
    } catch (erro) {
      console.warn(`[Generic:${this.dominio}] Falha ao converter: ${erro.message}`);
      return urlLimpa;
    }
  }
}
