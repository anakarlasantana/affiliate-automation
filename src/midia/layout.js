/**
 * layout.js — composição do story a partir de TEMPLATE + zonas declaradas.
 *
 * POR QUE: o visual é decisão de design, não de código. O PNG carrega a arte
 * (logo, moldura, faixa do preço, pílula do CTA) e um JSON diz onde cada peça
 * entra. Trocar a arte passa a ser substituir um arquivo — sem tocar em JS.
 *
 * DEGRADAÇÃO SEGURA: JSON ausente ou inválido cai no layout embutido. Publicar
 * nunca pode falhar por causa de um arquivo de design.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { escaparDrawtext } from './compor.js';

const executar = promisify(execFile);

export const LARGURA = 1080;
export const ALTURA = 1920;

/**
 * Layout embutido — mesmas proporções do template da Garimpa Aí, sem arte.
 * Coordenadas medidas no `layout_instagram.jpeg` (768×1376) e convertidas para
 * 1080×1920 (escala 1,40625 e corte central de 7 px).
 */
export const LAYOUT_EMBUTIDO = {
  base: null,
  largura: LARGURA,
  altura: ALTURA,
  foto: { x: 140, y: 570, w: 818, h: 698, fit: 'contain', escalaMax: 1 },
  titulo: { x: 150, y: 1330, maxLargura: 780, tamanho: 40, linhas: 2, cor: '#FFFFFF' },
  preco: { x: 150, y: 1430, tamanho: 108, cor: '#FFFFFF', contorno: 3 },
  precoDe: { x: 150, y: 1555, tamanho: 42, cor: 'white@0.85' },
  cta: { x: 540, y: 1685, tamanho: 58, cor: '#101828', ancora: 'centro' },
};

const numeroPositivo = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

/** Valida o JSON: dimensões e as quatro zonas que a composição usa. */
export function validarLayout(obj) {
  const erros = [];
  if (!obj || typeof obj !== 'object') return { ok: false, erros: ['layout não é objeto'] };

  for (const campo of ['largura', 'altura']) {
    if (!numeroPositivo(obj[campo])) erros.push(`${campo} inválido`);
  }

  const zona = (nome, campos) => {
    const z = obj[nome];
    if (!z || typeof z !== 'object') return erros.push(`zona ${nome} ausente`);
    for (const c of campos) {
      if (!Number.isFinite(Number(z[c]))) erros.push(`${nome}.${c} ausente`);
    }
    if (campos.includes('w') && !numeroPositivo(z.w)) erros.push(`${nome}.w deve ser > 0`);
    if (campos.includes('h') && !numeroPositivo(z.h)) erros.push(`${nome}.h deve ser > 0`);
  };

  zona('foto', ['x', 'y', 'w', 'h']);
  zona('titulo', ['x', 'y', 'maxLargura', 'tamanho']);
  zona('preco', ['x', 'y', 'tamanho']);
  zona('cta', ['y', 'tamanho']);

  return { ok: erros.length === 0, erros };
}

/**
 * Mescla um layout parcial com o embutido — zona ausente herda o padrão.
 * Usado tanto ao ler o JSON quanto ao compor, então aceitar layout parcial é
 * regra (um JSON com só `foto` e `preco` continua funcionando).
 */
export function mesclarLayout(bruto = {}) {
  return {
    ...LAYOUT_EMBUTIDO,
    ...bruto,
    foto: { ...LAYOUT_EMBUTIDO.foto, ...(bruto.foto || {}) },
    titulo: { ...LAYOUT_EMBUTIDO.titulo, ...(bruto.titulo || {}) },
    preco: { ...LAYOUT_EMBUTIDO.preco, ...(bruto.preco || {}) },
    precoDe: { ...LAYOUT_EMBUTIDO.precoDe, ...(bruto.precoDe || {}) },
    cta: { ...LAYOUT_EMBUTIDO.cta, ...(bruto.cta || {}) },
  };
}

/**
 * Lê o JSON e mescla com o embutido.
 * Devolve `null` quando o arquivo não existe ou é inválido.
 */
export function carregarLayout(arquivo) {
  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return null;
  }

  if (!validarLayout(bruto).ok) return null;
  return mesclarLayout(bruto);
}
/**
 * Como levar um template de qualquer tamanho para 1080×1920.
 * Escala pela LARGURA e corta o excedente no centro (topo/base é decoração).
 * Se faltar altura, devolve `padY` para completar em vez de esticar.
 */
export function normalizarTemplate({ largura, altura } = {}, alvo = {}) {
  const alvoLargura = alvo.largura || LARGURA;
  const alvoAltura = alvo.altura || ALTURA;

  if (!numeroPositivo(largura) || !numeroPositivo(altura)) {
    throw new Error('dimensões do template inválidas');
  }

  const escala = alvoLargura / largura;
  const alturaEscalada = Math.round(altura * escala);
  const excedente = alturaEscalada - alvoAltura;

  return {
    precisa: largura !== alvoLargura || altura !== alvoAltura,
    escala,
    alturaEscalada,
    cropY: excedente > 0 ? Math.floor(excedente / 2) : 0,
    padY: excedente < 0 ? -excedente : 0,
  };
}

/**
 * Enquadramento "contain" dentro da zona, com TETO de escala.
 * `escalaMax = 1` impede ampliar além do original — era o que borrava a foto de
 * 500×500 quando esticada até 1920.
 */
export function calcularFotoNaZona({ largura, altura } = {}, zona = {}, escalaMax = 1) {
  if (!numeroPositivo(largura) || !numeroPositivo(altura)) {
    throw new Error('dimensões da foto inválidas');
  }
  if (!zona || !numeroPositivo(zona.w) || !numeroPositivo(zona.h)) {
    throw new Error('zona da foto inválida');
  }

  const porZona = Math.min(zona.w / largura, zona.h / altura);
  const escala = Math.min(porZona, numeroPositivo(escalaMax) ? Number(escalaMax) : 1);
  const w = Math.round(largura * escala);
  const h = Math.round(altura * escala);

  return {
    escala,
    w,
    h,
    x: Math.round(Number(zona.x || 0) + (zona.w - w) / 2),
    y: Math.round(Number(zona.y || 0) + (zona.h - h) / 2),
  };
}

/**
 * Trunca o título em N linhas para caber em `maxLargura`.
 * Largura por caractere é estimada (0,55 × tamanho): não medimos a fonte, mas o
 * resultado é estável e suficiente para o texto não vazar da zona.
 */
export function truncarTitulo(texto, { maxLargura = 780, tamanho = 40, linhas = 2 } = {}) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!limpo) return [];

  const porLinha = Math.max(8, Math.floor(Number(maxLargura) / (Number(tamanho) * 0.55)));
  const palavras = limpo.split(' ');
  const saida = [];
  let atual = '';

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (tentativa.length <= porLinha) {
      atual = tentativa;
      continue;
    }
    if (atual) saida.push(atual);
    atual = palavra;
    if (saida.length === linhas - 1) break;
  }

  if (saida.length < linhas && atual) saida.push(atual);

  if (saida.length === linhas && saida.join(' ').length < limpo.length) {
    saida[saida.length - 1] = `${saida[saida.length - 1].slice(0, porLinha - 1)}…`;
  }

  return saida.slice(0, linhas);
}

/** Monta um `drawtext` posicionado (x null = centralizado). */
function drawtext(txt, tamanho, cor, y, x, contorno = 0, fonte) {
  const alvoX = x === null || x === undefined ? 'x=(w-text_w)/2' : `x=${Math.round(x)}`;
  const borda = contorno ? `:borderw=${contorno}:bordercolor=black@0.65` : '';
  // `expansion=none` é OBRIGATÓRIO: sem ele um `%` no texto (ex.: "-30%") faz o
  // drawtext não desenhar NADA — silenciosamente. Descoberto comparando pixel.
  return (
    `drawtext=fontfile=${escaparDrawtext(fonte)}:text='${escaparDrawtext(txt)}'` +
    `:fontcolor=${cor}:fontsize=${Math.round(tamanho)}:${alvoX}:y=${Math.round(y)}` +
    `${borda}:expansion=none`
  );
}

/**
 * argv do ffmpeg compondo sobre o template.
 * Pure: os testes conferem o formato sem precisar do binário.
 */
export function montarArgsComTemplate({
  base,
  foto,
  dimensoesFoto,
  layout = LAYOUT_EMBUTIDO,
  textos,
  saida,
  fonte = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  qualidade = 2,
} = {}) {
  if (!base) throw new Error('template base obrigatório');
  if (!foto) throw new Error('foto obrigatória');
  if (!saida) throw new Error('saída obrigatória');
  if (!textos || !textos.preco) throw new Error('story exige preço');

  // Layout parcial é aceito: a zona que faltar herda o embutido.
  const L = mesclarLayout(layout);

  const dim = calcularFotoNaZona(dimensoesFoto, L.foto, L.foto.escalaMax);
  const linhas = truncarTitulo(textos.titulo, L.titulo);

  const textosDraw = [
    ...linhas.map((linha, i) =>
      drawtext(
        linha,
        L.titulo.tamanho,
        L.titulo.cor,
        L.titulo.y + i * Math.round(L.titulo.tamanho * 1.25),
        L.titulo.x,
        0,
        fonte,
      ),
    ),
  ];

  textosDraw.push(
    drawtext(textos.preco, L.preco.tamanho, L.preco.cor, L.preco.y, L.preco.x, L.preco.contorno, fonte),
  );

  if (textos.de) {
    textosDraw.push(
      drawtext(textos.de, L.precoDe.tamanho, L.precoDe.cor, L.precoDe.y, L.precoDe.x, 0, fonte),
    );
  }

  textosDraw.push(drawtext(textos.principal, L.cta.tamanho, L.cta.cor, L.cta.y, null, 0, fonte));

  const filtro =
    `[1:v]scale=${dim.w}:${dim.h}:flags=lanczos[foto];` +
    `[0:v][foto]overlay=${dim.x}:${dim.y}[base];` +
    `[base]${textosDraw.join(',')}[out]`;

  return [
    '-y',
    '-i',
    String(base),
    '-i',
    String(foto),
    '-filter_complex',
    filtro,
    '-map',
    '[out]',
    '-frames:v',
    '1',
    '-q:v',
    String(qualidade),
    '-pix_fmt',
    'yuvj420p',
    '-sws_flags',
    'lanczos',
    String(saida),
  ];
}

/** Executa a composição sobre o template (ffmpeg do sistema). */
export async function comporComTemplate({ ffmpeg = 'ffmpeg', timeoutMs = 15_000, ...opcoes } = {}) {
  const args = montarArgsComTemplate(opcoes);
  // Timeout curto de propósito: no pipeline do WhatsApp esta composição roda no
  // mesmo handler que enfileira a oferta — ffmpeg travado não pode segurar 1 min.
  await executar(ffmpeg, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return opcoes.saida;
}

