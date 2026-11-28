/**
 * fluxo-log.js — rastro do caminho da mídia, oferta por oferta (FEAT-017).
 *
 * POR QUÊ: em 28/11 a produção enviou placeholder com a foto 1218×1218 na mão e
 * **nenhuma linha dizia por quê**. A troca acontecia no envio
 * (`if (!validarImagemBase64(...))`) sem registrar o motivo, e a foto preterida
 * pela regra `FONTES_FOTO_SOMENTE_SITE` era descartada em silêncio.
 *
 * Aqui cada etapa do fluxo emite uma linha curta e padronizada, com um `id` de
 * oferta curto para correlacionar. O filtro no servidor fica trivial:
 *
 *   journalctl -u affiliate-automation | grep '\[foto\]'
 */

/** Prefixo único para grep — não mistura com o resto do log. */
export const TAG = '[foto]';

/** Identificador curto e estável para correlacionar as linhas de uma oferta. */
export function idDaOferta(chave = '', origem = '') {
  const base = String(chave || origem || 'sem-chave');
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) % 0xffff;
  }
  return hash.toString(16).padStart(4, '0');
}

/** Uma linha por etapa: `[foto] #a1b2 etapa=... detalhe`. */
export function linhaDeFluxo({
  id = '----',
  etapa = '',
  status = 'ok',
  detalhe = '',
} = {}) {
  const partes = [`${TAG} #${id}`, `etapa=${etapa}`, `status=${status}`];
  if (detalhe) partes.push(detalhe);
  return `   ${partes.join(' · ')}`;
}

/**
 * Classifica o resultado de `validarImagemBase64` para o log do envio.
 * Nunca lança: validador quebrado não pode derrubar o pipeline.
 * @param {(b64:string)=>{valido:boolean, motivo?:string, kb?:number}} validar
 * @param {string} base64
 */
export function motivoInvalida(validar, base64) {
  if (!base64) return 'sem-imagem';
  try {
    const v = validar(String(base64));
    if (v?.valido) return null;
    return v?.motivo || 'invalida-sem-motivo';
  } catch (erro) {
    return `validador-falhou: ${erro.message}`;
  }
}

/**
 * Resumo do fluxo de uma oferta, em uma linha — para o fim do processamento.
 * @param {{id?:string, etapas?:object}} [dados]
 */
export function resumoDoFluxo({ id = '----', etapas = {} } = {}) {
  const pares = Object.entries(etapas)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  return linhaDeFluxo({ id, etapa: 'resumo', status: 'fim', detalhe: pares.join(' ') });
}
