/**
 * quadro.js — enquadramento 9:16 e decisão de formato da mídia.
 *
 * POR QUE existe: o Story é 1080x1920; publicar a foto 1:1 do produto gera
 * tarja (e tarja queima a primeira impressão). Também é aqui que se decide
 * converter PNG/WebP → JPEG: imagem PNG já teve relato de deixar o link do
 * sticker inoperante, e a galeria das lojas costuma servir WebP.
 */
import { createHash } from 'node:crypto';

export const LARGURA_STORY = 1080;
export const ALTURA_STORY = 1920;

/**
 * Enquadramento "cover": escala até cobrir o alvo e centraliza.
 * Devolve x/y negativos quando a imagem precisa ser cortada nas laterais.
 */
export function enquadrar(
  largura,
  altura,
  alvoLargura = LARGURA_STORY,
  alvoAltura = ALTURA_STORY,
) {
  if (![largura, altura, alvoLargura, alvoAltura].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('dimensões inválidas para enquadramento');
  }

  const escala = Math.max(alvoLargura / largura, alvoAltura / altura);
  const w = Math.round(largura * escala);
  const h = Math.round(altura * escala);

  return {
    escala,
    w,
    h,
    x: Math.round((alvoLargura - w) / 2),
    y: Math.round((alvoAltura - h) / 2),
    proporcao: Number((alvoLargura / alvoAltura).toFixed(4)),
  };
}

/** PNG e WebP precisam virar JPEG antes de ir para a Meta. */
export function precisaJpeg(mime) {
  return /^image\/(png|webp)$/i.test(String(mime || '').trim());
}

/** <sha1>.jpg — o hash do conteúdo torna a URL idempotente e cacheável. */
export function nomeDaMidia(conteudo) {
  if (conteudo === null || conteudo === undefined) throw new Error('conteúdo vazio');
  return `${createHash('sha1').update(conteudo).digest('hex')}.jpg`;
}
