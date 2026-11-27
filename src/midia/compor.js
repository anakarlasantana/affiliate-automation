/**
 * compor.js — monta o criativo 9:16 do story (foto + preço + CTA).
 *
 * POR QUE ffmpeg e não uma lib de imagem: o ffmpeg já é pré-requisito da
 * FEAT-006 (vídeo), está no apt da VPS e não adiciona dependência npm nativa.
 * Assim a composição do story e o Reels usam a MESMA ferramenta.
 *
 * O layout é calculado em função proporcional da altura (nada de número mágico
 * preso a 1920) e a faixa de preço respeita as áreas seguras do story: o topo e
 * a base são cobertos pela UI do Instagram.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executar = promisify(execFile);

export const LARGURA = 1080;
export const ALTURA = 1920;
export const FONTE_PADRAO = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/** CTA por destino da bio (a API do Instagram não deixa sticker de link). */
export const CTAS = {
  grupo: { principal: 'ENTRE NO GRUPO', apoio: 'link na bio' },
  oferta: { principal: 'LINK NA BIO', apoio: 'oferta do dia' },
};

/** "R$ 199" (sem centavos quando inteiro) — preço de story é curto. */
export function precoCurto(valor) {
  if (!Number.isFinite(valor)) return null;
  const temCentavos = Math.round(valor * 100) % 100 !== 0;
  return `R$ ${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: temCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Textos do criativo. Preço é obrigatório: sem ele a oferta não vira story
 * (decisão de produto — story sem valor não converte).
 */
export function textosDoStory(preco, destino = 'grupo') {
  if (!preco || !Number.isFinite(preco.atual)) return null;

  const cta = CTAS[destino] || CTAS.grupo;
  const de =
    Number.isFinite(preco.antigo) && preco.antigo > preco.atual
      ? `de ${precoCurto(preco.antigo)}${preco.desconto ? ` (-${preco.desconto}%)` : ''}`
      : null;

  return { preco: precoCurto(preco.atual), de, principal: cta.principal, apoio: cta.apoio };
}

/** Escapa texto para `drawtext` do ffmpeg (vírgula, dois-pontos, %, aspa). */
export function escaparDrawtext(texto) {
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%');
}

/**
 * argv do ffmpeg para gerar o JPEG do story.
 * Função pura: os testes conferem o formato sem depender do binário.
 */
export function montarArgsStory({
  entrada,
  saida,
  textos,
  fonte = FONTE_PADRAO,
  largura = LARGURA,
  altura = ALTURA,
  qualidade = 3,
} = {}) {
  if (!entrada) throw new Error('imagem de entrada obrigatória');
  if (!saida) throw new Error('arquivo de saída obrigatório');
  if (!textos || !textos.preco) throw new Error('story exige preço');

  const faixaY = Math.round(altura * 0.615);
  const faixaH = Math.round(altura * 0.2);
  const precoY = faixaY + Math.round(altura * 0.016);
  const deY = precoY + Math.round(altura * 0.062);
  const ctaY = Math.round(altura * 0.765);
  const apoioY = ctaY + Math.round(altura * 0.039);

  const desenhar = (txt, tamanho, cor, y) =>
    `drawtext=fontfile=${escaparDrawtext(fonte)}:text='${escaparDrawtext(txt)}'` +
    `:fontcolor=${cor}:fontsize=${tamanho}:x=(w-text_w)/2:y=${y}:expansion=none`;

  const filtros = [
    `scale=${largura}:${altura}:force_original_aspect_ratio=increase`,
    `crop=${largura}:${altura}`,
    `drawbox=x=0:y=${faixaY}:w=${largura}:h=${faixaH}:color=black@0.68:t=fill`,
    desenhar(textos.preco, Math.round(altura * 0.05), 'white', precoY),
  ];

  if (textos.de) {
    filtros.push(desenhar(textos.de, Math.round(altura * 0.021), 'white@0.85', deY));
  }

  filtros.push(desenhar(textos.principal, Math.round(altura * 0.03), '#FFE600', ctaY));
  if (textos.apoio) {
    filtros.push(desenhar(textos.apoio, Math.round(altura * 0.021), 'white@0.9', apoioY));
  }

  return [
    '-y',
    '-loop',
    '1',
    '-i',
    String(entrada),
    '-vf',
    filtros.join(','),
    '-frames:v',
    '1',
    '-q:v',
    String(qualidade),
    String(saida),
  ];
}

/** Gera o JPEG do story de verdade (usa o ffmpeg do sistema). */
export async function comporStory({ ffmpeg = 'ffmpeg', timeoutMs = 15_000, ...opcoes } = {}) {
  const args = montarArgsStory(opcoes);
  await executar(ffmpeg, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return opcoes.saida;
}
