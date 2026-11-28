/**
 * frame-vivo.js — o WhatsApp Web ainda responde? (FEAT-018)
 *
 * POR QUÊ existe: em 28/11 a VPS ficou 91 chamadas seguidas com
 * `Runtime.callFunctionOn timed out` e 14 com `Attempted to use detached Frame
 * 'A9DF9E9E…'` — sempre o MESMO frame. A página do WhatsApp Web recarregou
 * (10 restarts no dia) e o Puppeteer continuou falando com um frame morto.
 *
 * O efeito prático: `downloadMedia` falha para sempre, toda oferta cai em
 * placeholder, e o app **segue dizendo "Sistema ativo"** — inútil e silencioso.
 *
 * Aqui ficam as duas decisões testáveis:
 *  1. este erro significa que a sessão CDP morreu? (não adianta repetir)
 *  2. o cliente ainda responde? (health-check antes de seguir processando)
 */

/** Erros que indicam frame/página mortos — repetir no mesmo frame nunca resolve. */
const SINAIS_DE_FRAME_MORTO = [
  /detached Frame/i,
  /Target closed/i,
  /Session closed/i,
  /Page crashed/i,
  /Inspected target navigated or closed/i,
  /Execution context was destroyed/i,
  /Cannot find context with specified id/i,
];

/**
 * O erro indica que a página/frame do WhatsApp morreu?
 *
 * POR QUÊ separar de "timeout comum": repetir 4 vezes no mesmo frame morto gasta
 * ~50 s por oferta e termina em placeholder de qualquer jeito. Quando é frame
 * morto, o certo é re-hidratar/recriar a página — não insistir.
 *
 * @param {unknown} erro texto, Error ou objeto de erro do Puppeteer
 * @returns {boolean}
 */
export function ehFrameMorto(erro) {
  const texto = String(
    (erro && (erro.message || erro.stack)) || erro || '',
  );
  if (!texto) return false;
  return SINAIS_DE_FRAME_MORTO.some((padrao) => padrao.test(texto));
}

/**
 * O ID do frame citado no erro — útil para o log (é o que prova "mesmo frame").
 * @param {unknown} erro
 * @returns {string|null}
 */
export function frameDoErro(erro) {
  const texto = String((erro && (erro.message || erro.stack)) || erro || '');
  const m = texto.match(/detached Frame '([A-F0-9]+)'/i);
  return m ? m[1] : null;
}

/**
 * O cliente responde? Executa algo trivial dentro da página com prazo curto.
 *
 * POR QUÊ: depois de perder o frame, o wppconnect não avisa — o `onMessage`
 * continua chegando (os eventos vêm por outro canal) e o app parece saudável.
 * Uma chamada de leitura é o teste mais barato de "a sessão CDP está viva".
 *
 * @param {{evaluate?:Function, getConnectionState?:Function}} client
 * @param {{timeoutMs?:number, dormir?:(ms:number)=>Promise<void>}} [opcoes]
 * @returns {Promise<{vivo:boolean, motivo:string|null}>}
 */
export async function clienteResponde(
  client,
  { timeoutMs = 8_000 } = {},
) {
  if (!client) return { vivo: false, motivo: 'sem-cliente' };

  const chamada = (async () => {
    if (typeof client.getConnectionState === 'function') {
      const estado = await client.getConnectionState();
      if (estado && /CONNECTED|SYNCING|MAIN/i.test(String(estado))) {
        return { vivo: true, motivo: null };
      }
    }
    if (typeof client.evaluate === 'function') {
      await client.evaluate(() => 1);
      return { vivo: true, motivo: null };
    }
    // Sem primitiva de leitura: não dá para provar — assume vivo.
    return { vivo: true, motivo: 'sem-primitiva-de-leitura' };
  })();

  let prazo;
  const limite = new Promise((resolver) => {
    prazo = setTimeout(
      () => resolver({ vivo: false, motivo: 'timeout-health-check' }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([chamada, limite]);
  } catch (erro) {
    return {
      vivo: false,
      motivo: ehFrameMorto(erro)
        ? `frame-morto${frameDoErro(erro) ? `:${frameDoErro(erro)}` : ''}`
        : String(erro?.message || erro),
    };
  } finally {
    clearTimeout(prazo);
  }
}
