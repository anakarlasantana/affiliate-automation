/**
 * base.js
 * Contrato base para provedores de afiliados.
 * Novos provedores devem estender AffiliateProvider.
 */
export class AffiliateProvider {
  /** @type {string[]} domínios (sem www) que este provider atende */
  static dominios = [];
  /** @type {string} nome amigável */
  static nome = 'provider';

  /**
   * Verifica se este provider atende o hostname.
   * @param {string} hostname
   */
  static match(hostname) {
    const host = hostname.replace(/^www\./, '');
    return this.dominios.some((d) => host === d || host.endsWith('.' + d));
  }

  /**
   * Converte a URL limpa em link de afiliado.
   * @param {string} _urlLimpa
   * @returns {Promise<string>}
   */
  // eslint-disable-next-line no-unused-vars
  async converter(_urlLimpa) {
    throw new Error('converter() não implementado');
  }
}
