/**
 * video.js — gera o MP4 do Reels a partir das fotos (usa o ffmpeg do sistema).
 *
 * A montagem do argv mora em `src/canais/reels.js` porque é lógica pura e
 * testável; aqui só há a execução. Assim o teste do formato roda em qualquer
 * máquina, mesmo sem ffmpeg instalado.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { montarArgsFfmpeg } from '../canais/reels.js';

const executar = promisify(execFile);

export async function gerarVideo({ fotos = [], duracaoSeg = 15, saida, ffmpeg = 'ffmpeg' } = {}) {
  if (!saida) throw new Error('saida obrigatória');

  const args = montarArgsFfmpeg({ fotos, duracaoSeg, saida });

  await executar(ffmpeg, args, {
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  return saida;
}
