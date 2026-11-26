/**
 * preco.js — extrai o preço do texto ouvido e formata para o criativo.
 *
 * POR QUE existe: o story exige preço (decisão de produto: sem preço não publica)
 * e a PÁGINA do produto não entrega preço ao scraping — medido em 26/11/2026:
 * o preview de 12,7 KB do Mercado Livre e o de 21,7 KB da Shopee vêm sem
 * `price`. Restam duas fontes: a API oficial da loja e o texto da mensagem.
 *
 * O parser ignora parcelamento ("12x de R$ 18,25") e frete, porque nenhum dos
 * dois é o preço do produto.
 */

/** "1.700,50" → 1700.5 · "42,07" → 42.07 · "250" → 250 */
function numero(bruto) {
  const limpo = String(bruto || '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

/** 1700.5 → "R$ 1.700,50" */
export function formatarBRL(valor) {
  if (!Number.isFinite(valor)) return null;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const RE_DE_POR = /de\s*R\$\s*([\d.,]+)\s*por\s*R\$\s*([\d.,]+)/i;
const RE_POR = /por\s*R\$\s*([\d.,]+)/i;
const RE_QUALQUER = /R\$\s*([\d.,]+)/i;
const RE_PARCELA = /\d{1,2}\s*x\s*(?:de\s*)?R\$\s*[\d.,]+/gi;

/**
 * @param {string} texto mensagem ouvida
 * @returns {{atual:number, antigo:number|null, desconto:number|null}|null}
 */
export function extrairPreco(texto) {
  const bruto = String(texto || '');
  if (!bruto.trim()) return null;

  // Parcelamento não é preço do produto: remove antes de procurar.
  const limpo = bruto.replace(RE_PARCELA, ' ');

  let antigo = null;
  let atual = null;

  const dePor = RE_DE_POR.exec(limpo);
  if (dePor) {
    antigo = numero(dePor[1]);
    atual = numero(dePor[2]);
  } else {
    const por = RE_POR.exec(limpo);
    const qualquer = por || RE_QUALQUER.exec(limpo);
    if (qualquer) atual = numero(qualquer[1]);
  }

  if (!Number.isFinite(atual) || atual <= 0) return null;

  const temDesconto = Number.isFinite(antigo) && antigo > atual;
  return {
    atual,
    antigo: temDesconto ? antigo : null,
    desconto: temDesconto ? Math.round((1 - atual / antigo) * 100) : null,
  };
}

/**
 * A API da loja vence o texto (preço vivo), mas o "de" do texto é preservado
 * quando for maior — é o que dá a percepção de desconto.
 *
 * @param {{atual:number, antigo?:number|null}|null} daApi
 * @param {{atual:number, antigo?:number|null}|null} doTexto
 */
export function escolherPreco(daApi, doTexto) {
  if (!daApi || !Number.isFinite(daApi.atual)) return doTexto || null;

  const candidato = doTexto?.antigo ?? daApi.antigo ?? null;
  const antigo = Number.isFinite(candidato) && candidato > daApi.atual ? candidato : null;

  return {
    atual: daApi.atual,
    antigo,
    desconto: antigo ? Math.round((1 - daApi.atual / antigo) * 100) : null,
  };
}
