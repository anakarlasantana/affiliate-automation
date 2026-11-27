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
const RE_MOEDA = /R\$\s*([\d.,]+)/g;
const RE_PARCELA = /\d{1,2}\s*x\s*(?:de\s*)?R\$\s*[\d.,]+/gi;

/**
 * O valor achado é desconto/cupom em vez de preço do produto?
 *
 * POR QUÊ: oferta de grupo vive de cupom — `R$ 300 OFF acima de R$ 1.999` — e o
 * parser antigo pegava o PRIMEIRO "R$ N" (300). Story com preço de cupom anuncia
 * um valor que não existe: derruba a confiança e a conversão.
 */
function valorDeDesconto(texto, indice, tamanho) {
  const antes = texto.slice(Math.max(0, indice - 48), indice).toLowerCase();
  const depois = texto
    .slice(indice + tamanho, indice + tamanho + 24)
    .toLowerCase();
  // O "R$ " cola no número: sem tirá-lo, "acima de R$ 1.999" não era
  // reconhecido como desconto. O "de" de "cupom de" fica no próprio padrão
  // (senão "acima de" perderia o "de" que o identifica).
  const antesLimpo = antes.replace(/r\$\s*$/, '').trimEnd();
  const marcaAntes =
    /(?:off|cupom|desconto|desc\.?|economize|economia|no m[ií]nimo|acima\s+de)(?:\s+de)?\s*$/.test(
      antesLimpo,
    );
  const marcaDepois = /^\s*(?:off|de\s+desconto|reais\s+off)\b/.test(depois);
  return marcaAntes || marcaDepois;
}

/** Monta o resultado, guardando o "de" só quando for maior que o "por". */
function comDesconto(atual, antigo) {
  const temDesconto = Number.isFinite(antigo) && antigo > atual;
  return {
    atual,
    antigo: temDesconto ? antigo : null,
    desconto: temDesconto ? Math.round((1 - atual / antigo) * 100) : null,
  };
}

/**
 * @param {string} texto mensagem ouvida
 * @returns {{atual:number, antigo:number|null, desconto:number|null}|null}
 */
export function extrairPreco(texto) {
  const bruto = String(texto || '');
  if (!bruto.trim()) return null;

  // Parcelamento não é preço do produto: remove antes de procurar.
  const limpo = bruto.replace(RE_PARCELA, ' ');

  const dePor = RE_DE_POR.exec(limpo);
  if (dePor) {
    const antigo = numero(dePor[1]);
    const atual = numero(dePor[2]);
    if (Number.isFinite(atual) && atual > 0) return comDesconto(atual, antigo);
  }

  // "por R$ X" é o sinal mais forte de preço de venda — se X não for cupom.
  const por = RE_POR.exec(limpo);
  if (por) {
    const indice = por.index + por[0].lastIndexOf(por[1]);
    if (!valorDeDesconto(limpo, indice, por[1].length)) {
      const atual = numero(por[1]);
      if (Number.isFinite(atual) && atual > 0) return comDesconto(atual, null);
    }
  }

  // Último recurso: o primeiro "R$ N" que NÃO seja valor de desconto/cupom.
  RE_MOEDA.lastIndex = 0;
  let achado;
  while ((achado = RE_MOEDA.exec(limpo)) !== null) {
    const indice = achado.index + achado[0].lastIndexOf(achado[1]);
    if (valorDeDesconto(limpo, indice, achado[1].length)) continue;
    const atual = numero(achado[1]);
    if (Number.isFinite(atual) && atual > 0) return comDesconto(atual, null);
  }

  return null;
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

/**
 * Número vindo de HTML/API (formato internacional): `199.90`, `1699.90`, `1.999`.
 *
 * Não usa `numero()` porque ele assume pt-BR ('.' = milhar). Em `og:price` o
 * ponto é decimal; em `1.999` é milhar. O padrão de 3 dígitos após o ponto é o
 * que separa os dois casos.
 */
function numeroFlex(bruto) {
  const s = String(bruto || '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) return numero(s);
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return numero(s);
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const RE_META_PRECO =
  /<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([\d.,]+)/i;
const RE_JSONLD_PRECO = /"(?:price|lowPrice)"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/i;

/**
 * Preço lido do HTML JÁ baixado (nenhum request extra): `og:price:amount` ou
 * JSON-LD `"price"`.
 *
 * Devolve null quando a página não expõe preço — é o caso do Mercado Livre, que
 * serve captcha para requisição sem navegador (medido em 27/11/2026: três URLs
 * diferentes, 42.822 bytes idênticos, sem nenhuma meta og:price).
 */
export function precoDoHtml(html) {
  const bruto = String(html || '');
  if (!bruto) return null;

  const meta = RE_META_PRECO.exec(bruto);
  const json = meta ? null : RE_JSONLD_PRECO.exec(bruto);
  const valor = numeroFlex(meta?.[1] ?? json?.[1]);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return { atual: valor, antigo: null, desconto: null };
}

/**
 * Preço final do story: a ORIGEM (API/HTML) vence e o texto só entra quando ela
 * não respondeu. Valor de cupom no texto nunca vira preço.
 *
 * Um único ponto de decisão — é o que o pipeline chama, para que o `escolherPreco`
 * deixe de ser código morto e a regra não se espalhe por `app.js`.
 *
 * @param {{texto?:string, daApi?:{atual:number}|null, html?:string}} [fontes]
 */
export function resolverPreco({ texto, daApi = null, html = '' } = {}) {
  const daOrigem = Number.isFinite(daApi?.atual) ? daApi : precoDoHtml(html);
  return escolherPreco(daOrigem, extrairPreco(texto));
}
