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
   * @type {string[]} variáveis de ambiente obrigatórias para gerar o link de
   * afiliado. Sem elas a loja é considerada INATIVA e as ofertas dela são
   * ignoradas (o sistema nunca publica link sem o nosso rastreio).
   */
  static credenciaisRequeridas = [];
  /**
   * Peculiaridades de URL da loja — cada loja tem o seu formato de link.
   * A detecção de produto é por EXCLUSÃO (`urlNaoProduto`) combinada com a
   * extração do produto real (`mergulhador`): assim um formato novo de link
   * da loja continua sendo aceito em vez de descartado por engano.
   * @property {RegExp[]} urlNaoProduto  URLs que NÃO são produto (perfil/vitrine/landing)
   * @property {object|null} mergulhador { nome, matches(url), extrair(url) } para
   *                                     páginas intermediárias que escondem o produto
   * @property {Function|null} idProduto (URL) => identidade do produto (dedup por item)
   * @property {RegExp[]} paramsRemover  parâmetros de tracking extras desta loja
   */
  static perfil = {
    urlNaoProduto: [],
    mergulhador: null,
    idProduto: null,
    paramsRemover: [],
  };

  /**
   * Verifica se este provider atende o hostname.
   * @param {string} hostname
   */
  static match(hostname) {
    const host = hostname.replace(/^www\./, '');
    return this.dominios.some((d) => host === d || host.endsWith('.' + d));
  }

  /**
   * @returns {string[]} variáveis de ambiente que ainda faltam para esta loja.
   */
  static credenciaisFaltantes() {
    return this.credenciaisRequeridas.filter((chave) => !process.env[chave]);
  }

  /**
   * true quando a loja tem tudo que precisa para gerar o link de afiliado.
   */
  static estaConfigurado() {
    return this.credenciaisFaltantes().length === 0;
  }

  /**
   * Converte a URL limpa em link de afiliado.
   * @param {string} _urlLimpa
   * @returns {Promise<string|null>} null = oferta descartada
   */
  // eslint-disable-next-line no-unused-vars
  async converter(_urlLimpa) {
    throw new Error('converter() não implementado');
  }
}
