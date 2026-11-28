/**
 * bloqueio-oferta.js — esta oferta merece story? (FEAT-021)
 *
 * POR QUÊ existe: em 28/11 uma oferta de CUPOM do grupo Promobit virou story com
 * a foto do CARD DA MARCA e preço lido do texto (valor de cupom). O link de
 * afiliado estava correto — o problema foi levar ao feed algo que não é uma
 * oferta de produto confirmada.
 *
 * O bloqueio é do STORY, nunca do envio: o WhatsApp é o canal principal e a
 * oferta pode ser boa para o grupo (decisão B2 da operação).
 */

/** Palavras ignoradas na comparação de título (conectivos e unidades). */
const VAZIAS = new Set([
  'para', 'com', 'sem', 'por', 'dos', 'das', 'uma', 'uns', 'umas', 'que', 'mais',
  'mini', 'novo', 'nova', 'original', 'unidade', 'unidades', 'cores', 'cor',
]);

/** Normaliza acento e caixa; devolve as palavras significativas (>=4 letras). */
export function palavrasSignificativas(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 4 && !VAZIAS.has(p));
}

/**
 * O texto cita o produto extraído?
 * Basta UMA palavra significativa em comum (título de marketplace é longo e o
 * texto do grupo costuma citar só parte dele).
 */
export function textoCitaProduto(texto, tituloProduto) {
  const doTexto = new Set(palavrasSignificativas(texto));
  const doProduto = palavrasSignificativas(tituloProduto);
  if (!doProduto.length) return true; // sem título para comparar: não bloqueia
  return doProduto.some((p) => doTexto.has(p));
}

/** O texto tem cara de oferta de cupom (sem descrever produto)? */
export function pareceCupomSemProduto(texto) {
  const bruto = String(texto || '');
  const temCupom = /cupom|c[oó]digo\s+promocional|\ud83c\udfab/i.test(bruto);
  if (!temCupom) return false;

  // Palavras que NAO descrevem produto: a propria palavra cupom, o codigo do
  // cupom (BLACK10) e numeros soltos. Sem nenhuma outra >=5 letras = so cupom.
  const doCupom = /cupom/i;
  const codigo = String(bruto).match(/(?:cupom|c[oó]digo)\s*[:\-]?\s*([A-Za-z0-9]{4,24})/i);
  const codigos = codigo ? [codigo[1].toLowerCase()] : [];
  const palavras = palavrasSignificativas(bruto)
    .filter((p) => p.length >= 5)
    .filter((p) => !doCupom.test(p))
    .filter((p) => !codigos.includes(p));
  return palavras.length === 0;
}

/**
 * Decide se a oferta pode virar story.
 *
 * @param {{
 *   texto?: string,
 *   tituloProduto?: string,
 *   veioDeVitrine?: boolean,
 *   preco?: number|null,
 * }} [dados]
 * @returns {{story: boolean, motivo: string|null}}
 */
export function avaliarOfertaParaStory({
  texto = '',
  tituloProduto = '',
  veioDeVitrine = false,
  preco = null,
} = {}) {
  // Sem preço de produto não há story (regra de produto da FEAT-011).
  const valor = Number(preco);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { story: false, motivo: 'sem-preco' };
  }

  // Link de vitrine: o mergulhador escolheu o produto, o anunciante não.
  if (veioDeVitrine && !textoCitaProduto(texto, tituloProduto)) {
    return { story: false, motivo: 'vitrine-sem-produto' };
  }

  // Mensagem só de cupom: não descreve produto nenhum.
  if (pareceCupomSemProduto(texto)) {
    return { story: false, motivo: 'cupom-sem-produto' };
  }

  return { story: true, motivo: null };
}
