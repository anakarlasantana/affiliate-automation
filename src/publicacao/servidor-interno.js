/**
 * servidor-interno.js — o app sobe o servidor de mídia sozinho (FEAT-012 · CA-7).
 *
 * POR QUÊ: em 27/11 o app estava no ar, o servidor de mídia não, e a publicação
 * morreu com 9004/2207052 (a Meta recebeu HTML/502 no lugar do JPEG). "Subir e
 * operar" só é verdade se quem serve `/midia` subir junto.
 *
 * Se a porta já estiver ocupada (servidor externo, pm2, outra instância),
 * NÃO duplica: usa o que existe — mesmo princípio da trava única da FEAT-010.
 */
import net from 'node:net';
import { spawn as spawnPadrao } from 'node:child_process';

import config from '../config.js';

/** Prefixo de log do Instagram (mesmo do motor automático). */
const PREFIXO = '[ig]';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Decide se vale subir o servidor interno.
 * @param {{portaEmUso?:boolean}} [estado]
 * @returns {{subir:boolean, motivo:string|null}}
 */
export function decidirServidorInterno({ portaEmUso } = {}) {
  if (portaEmUso) return { subir: false, motivo: 'porta-ocupada' };
  return { subir: true, motivo: null };
}

/** Conexão TCP crua: `connect` = alguém escutando. */
function tcpConecta(porta) {
  return new Promise((resolver) => {
    const socket = net.connect({ host: '127.0.0.1', port: porta });
    const fim = (valor) => {
      socket.destroy();
      resolver(valor);
    };
    socket.once('connect', () => fim(true));
    socket.once('error', () => fim(false));
    socket.setTimeout(800, () => fim(false));
  });
}

/**
 * Tem alguém escutando na porta?
 * @param {number} porta
 * @param {{conectar?: (porta:number)=>Promise<boolean>}} [deps]
 * @returns {Promise<boolean>}
 */
export function portaOcupada(porta, { conectar = tcpConecta } = {}) {
  return conectar(porta);
}

/**
 * Sobe o servidor de mídia se a porta estiver livre.
 *
 * @param {{cfg?:object, porta?:number, avisar?:(m:string)=>void, spawn?:Function, conectar?:Function}} [opcoes]
 * @returns {Promise<{proprio:boolean, porta:number, filho?:object}>}
 */
export async function garantirServidorDeMidia({
  cfg = config,
  porta,
  avisar = () => {},
  spawn = spawnPadrao,
  conectar,
} = {}) {
  const alvo = porta || cfg.publicacao.porta;
  const ocupada = await portaOcupada(alvo, { conectar });
  const decisao = decidirServidorInterno({ portaEmUso: ocupada });

  if (!decisao.subir) {
    avisar(`🔌 ${PREFIXO} porta ${alvo} já em uso — usando o servidor existente`);
    return { proprio: false, porta: alvo };
  }

  const filho = spawn(process.execPath, ['src/servidor.js'], {
    cwd: cfg.caminhos.root,
    stdio: 'inherit',
    env: process.env,
  });
  avisar(`🌐 ${PREFIXO} servidor de mídia interno subindo (pid ${filho.pid}, porta ${alvo})`);

  // Espera a porta responder: sem isso a primeira publicação pode cair no 502.
  for (let i = 0; i < 24; i += 1) {
    await espera(250);
    if (filho?.exitCode !== null && filho?.exitCode !== undefined) break;
    if (await portaOcupada(alvo, { conectar })) {
      avisar(`✅ ${PREFIXO} mídia servida em http://127.0.0.1:${alvo}`);
      return { proprio: true, porta: alvo, filho };
    }
  }

  avisar(`⚠️  ${PREFIXO} servidor interno não respondeu na porta ${alvo} — publicação vai adiar`);
  return { proprio: true, porta: alvo, filho };
}
