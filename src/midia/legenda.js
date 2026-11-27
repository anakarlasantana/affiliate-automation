/**
 * legenda.js — copy do post do feed (FEAT-014).
 *
 * POR QUÊ: a legenda do WhatsApp é curta e tem o link dentro do próprio post. No
 * feed não existe link clicável e o Instagram corta em ~125 caracteres: a
 * primeira linha precisa vender sozinha (produto + preço), e o resto sustenta a
 * decisão (desconto, cupom, loja, CTA para a bio).
 *
 * Tudo aqui é regra determinística — sem IA — para poder ser testado e para o
 * custo por post ser zero.
 */

/** Limite de legenda da Content Publishing API. */
export const LIMITE_LEGENDA = 2200;
/** O que o feed mostra antes do "mais". */
export const LIMITE_GANCHO = 125;
/** Teto de hashtags: acima disso o alcance piora em vez de melhorar. */
export const MAX_HASHTAGS = 10;

const HASHTAG_DA_LOJA = {
  MercadoLivre: 'mercadolivre',
  Shopee: 'shopee',
  Magalu: 'magalu',
};

const HASHTAGS_BASE = [
  'achadinhos',
  'ofertadodia',
  'promocao',
  'descontos',
  'cupom',
  'achadinhosdobrasil',
];

/** "R$ 1.234,50" */
function moeda(valor) {
  if (!Number.isFinite(valor)) return null;
  const centavos = Math.round(valor * 100) % 100 !== 0;
  return `R$ ${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: centavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Limpa o texto que veio do grupo: sem links, sem marcação de negrito e sem
 * excesso de quebras. Link cru no post não é clicável e só polui.
 * @param {string} texto
 */
export function limparTextoDoGrupo(texto) {
  return String(texto || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Primeira linha: produto + preço + gancho, em até 125 caracteres (CA-3).
 * @param {{titulo?:string, preco?:{atual:number}|null}} [dados]
 */
export function gancho({ titulo, preco } = {}) {
  const nome = String(titulo || 'Oferta')
    .replace(/\s+/g, ' ')
    .trim();
  const valor = Number.isFinite(preco?.atual) ? ` por ${moeda(preco.atual)}` : '';
  const base = `${nome}${valor}`;

  const completo = `${base} — achadinho do dia`;
  if (completo.length <= LIMITE_GANCHO) return completo;
  if (base.length <= LIMITE_GANCHO) return base;

  const corte = base.slice(0, LIMITE_GANCHO - 1);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > 20 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/**
 * Linha do preço com "de/por" e desconto calculados (CA-2). Nunca inventa valor:
 * sem preço válido, devolve null.
 * @param {{atual:number, antigo?:number|null, desconto?:number|null}|null} preco
 */
export function linhaDoPreco(preco) {
  if (!Number.isFinite(preco?.atual)) return null;
  let linha = `💰 ${moeda(preco.atual)}`;
  if (Number.isFinite(preco.antigo) && preco.antigo > preco.atual) {
    linha += `  de ${moeda(preco.antigo)}`;
    if (Number.isFinite(preco.desconto)) linha += ` (-${preco.desconto}%)`;
  }
  return linha;
}

/**
 * Hashtags: a da loja primeiro, depois as extras e as base, sem repetir (CA-4).
 * @param {{loja?:string, extras?:string[]}} [dados]
 * @returns {string[]} com "#"
 */
export function montarHashtags({ loja = '', extras = [] } = {}) {
  const lista = [];
  const adicionar = (bruta) => {
    const limpa = String(bruta || '')
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/[^a-z0-9]/g, '');
    if (limpa && !lista.includes(limpa) && lista.length < MAX_HASHTAGS) {
      lista.push(limpa);
    }
  };

  adicionar(HASHTAG_DA_LOJA[loja] || '');
  [...extras, ...HASHTAGS_BASE].forEach(adicionar);
  return lista.map((tag) => `#${tag}`);
}
/**
 * Descrição curta: 2 linhas úteis do texto do grupo, sem repetir preço/cupom e
 * sem caixa-alta gritada.
 * @param {{titulo?:string, texto?:string}} [dados]
 */
export function descricaoCurta({ titulo = '', texto = '' } = {}) {
  const nome = String(titulo || '').toLowerCase().trim();
  const linhas = limparTextoDoGrupo(texto)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.toLowerCase() !== nome)
    .filter((l) => !/R\$\s*[\d.,]+/.test(l))
    .filter((l) => !/cupom|c[oó]digo/i.test(l))
    // Manchete gritada ("MENOR PREÇO JÁ POSTADO...") não entra: o gancho já
    // vende o produto na primeira linha, repetir soa spam.
    .filter((l) => !(l === l.toUpperCase() && l.length > 20))
    .map((l) =>
      l.length > 40 && l === l.toUpperCase()
        ? l.charAt(0) + l.slice(1).toLowerCase()
        : l,
    );

  return linhas.slice(0, 2).join(' ').slice(0, 200).trim();
}

/**
 * Trunca por LINHA inteira (CA-6): nunca corta palavra nem emoji no meio.
 * @param {string} texto
 * @param {number} [limite]
 */
export function truncarPorLinha(texto, limite = LIMITE_LEGENDA) {
  const t = String(texto || '');
  if (t.length <= limite) return t;

  const corte = t.slice(0, limite);
  const ultimaLinha = corte.lastIndexOf('\n');
  if (ultimaLinha > 0) return corte.slice(0, ultimaLinha).trimEnd();

  const ultimoEspaco = corte.lastIndexOf(' ');
  return `${corte.slice(0, ultimoEspaco > 0 ? ultimoEspaco : limite).trimEnd()}…`;
}

/**
 * Extrai o cupom do texto do grupo, se houver (CA-7).
 * @param {string} texto
 * @returns {{codigo:string, validade:string|null}|null}
 */
export function extrairCupom(texto) {
  const t = limparTextoDoGrupo(texto);
  const m = t.match(/(?:cupom|c[oó]digo|code)\s*[:\-]?\s*([A-Za-z0-9]{4,24})/i);
  if (!m) return null;

  // ARMADILHA: com /i, `[A-Z0-9]` também aceita minúsculas — e "sem cupom aqui"
  // virava o cupom "AQUI". Código de cupom de verdade tem maiúscula ou número.
  const codigo = m[1];
  if (!/[A-Z]/.test(codigo) && !/\d/.test(codigo)) return null;

  const validade =
    t.match(
      /(?:v[aá]lido|at[eé])\s*(?:at[eé]\s*)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
    )?.[1] || null;

  return { codigo: codigo.toUpperCase(), validade };
}

/**
 * Limpa o convite do grupo: tira o rastro de compartilhamento
 * (`?s=cl&p=a&mlu=4&ilr=4`), que não muda o destino e só gasta caracteres.
 * @param {string} url
 * @returns {string} convite curto, ou '' quando não é um convite válido
 */
export function limparUrlDeConvite(url) {
  const bruto = String(url || '').trim();
  if (!bruto) return '';
  try {
    const u = new URL(bruto);
    if (!/^https?:$/.test(u.protocol)) return '';
    if (!/(^|\.)chat\.whatsapp\.com$/.test(u.hostname)) {
      // Outro convidado (Telegram etc.) ainda vale: só remove a query.
      return `${u.origin}${u.pathname}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/**
 * A legenda do feed (CA-1..CA-8).
 *
 * @param {{titulo?:string, preco?:object|null, loja?:string, cupom?:object|null,
 *   goDestino?:string, texto?:string, extrasHashtags?:string[],
 *   convite?:string, incluirConvite?:boolean}} [dados]
 * @returns {string}
 */
export function legendaDoFeed({
  titulo,
  preco = null,
  loja = '',
  cupom = null,
  goDestino = 'oferta',
  texto = '',
  extrasHashtags = [],
  convite = '',
  incluirConvite = true,
} = {}) {
  const linhas = [gancho({ titulo, preco }), ''];

  const descricao = descricaoCurta({ titulo, texto });
  if (descricao) linhas.push(descricao, '');

  const doPreco = linhaDoPreco(preco);
  if (doPreco) linhas.push(doPreco);

  const doTexto = extrairCupom(texto);
  const codigo = cupom?.codigo || doTexto?.codigo;
  if (codigo) {
    const validade = cupom?.validade || doTexto?.validade;
    linhas.push(`🏷️ Cupom: ${codigo}${validade ? ` (até ${validade})` : ''}`);
  }

  if (loja) linhas.push(`🏬 ${loja}`);

  // CA-5: a promessa tem de casar com o destino real do /go.
  linhas.push(
    goDestino === 'grupo'
      ? '🔗 Link na bio → entra no grupo'
      : '🔗 Link na bio → abre a oferta',
  );

  // O convite só entra quando a bio NÃO leva ao grupo — repetir seria ruído.
  // No Instagram ele NÃO é clicável: serve para copiar/colar e para quem reposta.
  const urlConvite = incluirConvite ? limparUrlDeConvite(convite) : '';
  if (urlConvite && goDestino !== 'grupo') {
    linhas.push(`👥 Grupo com todas as ofertas: ${urlConvite}`);
  }

  linhas.push('⚠️ Preço e disponibilidade podem mudar.');

  const tags = montarHashtags({ loja, extras: extrasHashtags });
  if (tags.length) linhas.push('', tags.join(' '));

  return truncarPorLinha(linhas.join('\n'));
}
