/**
 * feed.js — composição do post do feed (FEAT-013 · CA-1).
 *
 * POR QUÊ um template separado: a Meta aceita no feed de 4:5 a 1.91:1 e RECUSA o
 * 9:16 do story. O compositor (`layout.js`) não redimensiona a base — ele só
 * sobrepõe a foto — então basta uma base já normalizada em 1080×1350 e um JSON
 * de zonas para reaproveitar exatamente o mesmo código.
 *
 * As zonas foram MEDIDAS no `post-base.jpeg` original (928×1152): a moldura tem
 * adesivos (lupa, sacola) dentro da janela, por isso a foto entra em `contain` —
 * `cover` cobriria a arte.
 */
import fs from 'node:fs';
import path from 'node:path';

import config from '../config.js';
import { carregarLayout, comporComTemplate } from './layout.js';

export const BASE_POST = 'post-base.png';
export const LAYOUT_POST = 'post.json';

/** A Meta aceita do 4:5 (0,8) até 1.91:1 no feed. */
export const PROPORCAO_MIN = 0.8;
export const PROPORCAO_MAX = 1.91;

/**
 * A proporção é aceita no feed?
 * @param {number} largura
 * @param {number} altura
 * @returns {{ok:boolean, proporcao:number}}
 */
export function proporcaoAceita(largura, altura) {
  const proporcao = Number(largura) / Number(altura);
  if (!Number.isFinite(proporcao) || proporcao <= 0) {
    return { ok: false, proporcao };
  }
  return {
    ok: proporcao >= PROPORCAO_MIN - 1e-6 && proporcao <= PROPORCAO_MAX,
    proporcao,
  };
}

/** Pasta dos templates (assets/template). */
export function pastaDoTemplate(raiz = config.caminhos.root) {
  return path.join(raiz, 'assets', 'template');
}

/**
 * Carrega o template do post e valida antes de gastar ffmpeg.
 * @param {string} [raiz]
 * @returns {{layout:object, base:string, proporcao:number}}
 */
export function carregarTemplateDoPost(raiz = config.caminhos.root) {
  const dir = pastaDoTemplate(raiz);
  const layout = carregarLayout(path.join(dir, LAYOUT_POST));
  if (!layout) throw new Error('post.json ausente ou inválido');

  const base = path.join(dir, layout.base || BASE_POST);
  if (!fs.existsSync(base)) {
    throw new Error(
      `base do post ausente (${base}) — normalize o layout para ${layout.largura}x${layout.altura}`,
    );
  }

  const { ok, proporcao } = proporcaoAceita(layout.largura, layout.altura);
  if (!ok) {
    throw new Error(
      `proporção ${proporcao.toFixed(3)} não é aceita no feed (4:5 a 1.91:1)`,
    );
  }

  const zonas = ['foto', 'titulo', 'preco', 'cta'];
  for (const zona of zonas) {
    if (!layout[zona]) throw new Error(`post.json sem a zona "${zona}"`);
  }
  if (layout.foto.y + layout.foto.h > layout.altura) {
    throw new Error('zona da foto passa da altura do canvas');
  }

  return { layout, base, proporcao };
}

/**
 * Remove emojis e caracteres que a fonte do ffmpeg (DejaVu) não tem.
 *
 * POR QUÊ: emoji no título sai como quadradinho vazio ("tofu") no JPEG — o
 * `🎟️` de "OPORTUNIDADE RARA! 🎟️" virou um ▯ no primeiro teste real.
 * @param {string} texto
 */
export function semEmoji(texto) {
  return String(texto || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Compõe o post do feed (JPEG 1080×1350).
 *
 * @param {{foto:string, textos:object, saida:string, raiz?:string,
 *   dimensoesFoto?:object, deps?:{compor?:Function}}} opcoes
 * @returns {Promise<string>} caminho do JPEG
 */
export async function comporFeed({
  foto,
  textos,
  saida,
  raiz = config.caminhos.root,
  dimensoesFoto,
  deps = {},
} = {}) {
  if (!foto) throw new Error('foto obrigatória');
  if (!saida) throw new Error('saída obrigatória');

  const { layout, base } = carregarTemplateDoPost(raiz);
  const compor = deps.compor || comporComTemplate;

  fs.mkdirSync(path.dirname(saida), { recursive: true });
  await compor({
    base,
    foto,
    dimensoesFoto,
    layout,
    textos: {
      ...textos,
      titulo: semEmoji(textos.titulo),
      principal: semEmoji(textos.principal),
    },
    saida,
  });
  return saida;
}
