/**
 * reels.js — formato, argumentos do ffmpeg e payloads de Reels/carrossel.
 *
 * POR QUE existe: nenhuma loja entrega vídeo utilizável (ML expõe `video_id` do
 * YouTube, a Shopee não tem o campo e a Magalu não entrega nem imagem — medido).
 * Então o vídeo é GERADO a partir das fotos que já extraímos. Vídeo publicado
 * por API sai sempre como Reels: vídeo de feed foi depreciado.
 *
 * O argv do ffmpeg é montado por função pura — assim dá para provar o formato
 * (9:16, H.264, ≤30 s) sem precisar do binário instalado.
 */

export const MAX_FOTOS_CARROSSEL = 10;
export const MIN_FOTOS_CARROSSEL = 2;
export const DURACAO_MAX_SEG = 30;
export const LARGURA = 1080;
export const ALTURA = 1920;

/**
 * Decide o formato a partir da quantidade de fotos.
 * 0 → não publica · 1 ou 2 → zoom (slide parado é pior) · ≥3 → carrossel.
 */
export function escolherFormato(fotos = []) {
  const total = Array.isArray(fotos) ? fotos.length : 0;
  if (total === 0) return { formato: 'nenhum', motivo: 'sem-foto' };
  if (total < 3) return { formato: 'zoom', motivo: total === 1 ? 'uma-foto' : 'duas-fotos' };
  return { formato: 'carrossel', itens: Math.min(total, MAX_FOTOS_CARROSSEL) };
}

export function dentroDoLimite(duracaoSeg, maxSeg = DURACAO_MAX_SEG) {
  const n = Number(duracaoSeg);
  return Number.isFinite(n) && n > 0 && n <= maxSeg;
}

/**
 * argv do ffmpeg para um slideshow 9:16.
 * Cada foto entra com `-loop 1 -t porFoto`; o filtro escala/corta em modo cover
 * (mesma matemática do enquadramento do story) e concatena.
 */
export function montarArgsFfmpeg({
  fotos = [],
  duracaoSeg = 15,
  saida = 'reel.mp4',
  fps = 30,
  largura = LARGURA,
  altura = ALTURA,
} = {}) {
  if (!Array.isArray(fotos) || fotos.length === 0) {
    throw new Error('sem foto para montar o vídeo');
  }
  if (!dentroDoLimite(duracaoSeg)) {
    throw new Error(`duração inválida: ${duracaoSeg}s (máximo ${DURACAO_MAX_SEG}s)`);
  }

  const porFoto = duracaoSeg / fotos.length;
  const args = ['-y'];

  for (const foto of fotos) {
    args.push('-loop', '1', '-t', porFoto.toFixed(3), '-i', String(foto));
  }

  const normalizar = fotos
    .map(
      (_, i) =>
        `[${i}:v]scale=${largura}:${altura}:force_original_aspect_ratio=increase,` +
        `crop=${largura}:${altura},setsar=1[v${i}]`,
    )
    .join(';');

  const concatenar = `${fotos.map((_, i) => `[v${i}]`).join('')}concat=n=${fotos.length}:v=1:a=0[out]`;

  args.push(
    '-filter_complex',
    `${normalizar};${concatenar}`,
    '-map',
    '[out]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-t',
    String(duracaoSeg),
    String(saida),
  );

  return args;
}

/** Vídeo sempre vira Reels. */
export function payloadReels({ videoUrl, legenda = '' } = {}) {
  if (!videoUrl) throw new Error('videoUrl obrigatório');
  return { media_type: 'REELS', video_url: videoUrl, caption: legenda };
}

/** Carrossel exige de 2 a 10 filhos já criados como container. */
export function payloadCarrossel(children = []) {
  if (!Array.isArray(children) || children.length < MIN_FOTOS_CARROSSEL) {
    throw new Error(`carrossel exige ao menos ${MIN_FOTOS_CARROSSEL} itens`);
  }
  if (children.length > MAX_FOTOS_CARROSSEL) {
    throw new Error(`carrossel aceita no máximo ${MAX_FOTOS_CARROSSEL} itens`);
  }
  return { media_type: 'CAROUSEL', children };
}

export function limiteAtingido(usadosHoje, max) {
  return Number.isFinite(Number(max)) && Number(max) > 0 && Number(usadosHoje) >= Number(max);
}

/* ======================= pacote de publicação ======================= */

/** Limites conservadores de copy para os apps das lojas. */
export const LIMITE_TITULO = 90;
export const LIMITE_DESCRICAO = 1000;

/**
 * Onde existe feed de vídeo com produto ANEXADO (validado em 26/11/2026):
 * Shopee Vídeo e Magalu Vídeos têm sacolinha/card do produto; o Clips do
 * Mercado Livre é do vendedor, então produto de ML só rende Instagram.
 *
 * Nenhum desses feeds tem API de publicação para afiliado — o upload é humano.
 * Por isso o pacote existe: automatizamos a produção, o toque final é seu.
 */
export function canaisComFeed(loja) {
  if (loja === 'Shopee') return ['shopee'];
  if (loja === 'Magalu') return ['magalu'];
  return ['instagram'];
}

/**
 * Pacote pronto para publicar: arquivo + copy + identidade do produto + canais.
 * Sem isso, o vídeo gerado seria um MP4 solto sem saber onde vai nem qual item
 * anexar.
 *
 * @returns {{arquivo:string, titulo:string, descricao:string, produtoId:string|null, canais:string[]}}
 */
export function montarPacotePublicacao({
  arquivo,
  titulo = '',
  descricao = '',
  chave = null,
  loja = null,
  duracaoSeg = 15,
} = {}) {
  if (!arquivo) throw new Error('arquivo do vídeo obrigatório');
  if (!dentroDoLimite(duracaoSeg)) {
    throw new Error(`duração inválida: ${duracaoSeg}s (máximo ${DURACAO_MAX_SEG}s)`);
  }

  return {
    arquivo: String(arquivo),
    titulo: String(titulo).slice(0, LIMITE_TITULO),
    descricao: String(descricao).slice(0, LIMITE_DESCRICAO),
    produtoId: chave || null,
    canais: canaisComFeed(loja),
  };
}

