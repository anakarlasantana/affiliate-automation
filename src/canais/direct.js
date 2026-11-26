/**
 * direct.js — webhook do Instagram e resposta automática no Direct.
 *
 * POR QUE existe: a API não insere sticker de link no story, mas o **Direct é
 * clicável** e a documentação do Messaging API permite enviar `links` quando a
 * pessoa falou primeiro (janela de 24 h). Então o story convida a responder
 * "LINK" e este módulo entrega o link do produto.
 *
 * Tudo aqui é PURO (sem rede e sem banco): a rota HTTP e o envio ficam em
 * `servidor.js`, o registro de idempotência no `database.js`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Janela de 24 horas do Messaging API. */
export const JANELA_MS = 24 * 60 * 60 * 1000;

/**
 * Valida `X-Hub-Signature-256` contra o corpo CRU.
 * Precisa ser o corpo cru: qualquer JSON.parse/stringify muda os bytes e a
 * assinatura deixa de bater.
 */
export function validarAssinatura(corpoCru, header, segredo) {
  if (!corpoCru || !header || !segredo) return false;

  const esperado = `sha256=${createHmac('sha256', segredo)
    .update(corpoCru, 'utf8')
    .digest('hex')}`;

  const recebido = Buffer.from(String(header));
  const calculado = Buffer.from(esperado);
  if (recebido.length !== calculado.length) return false;

  return timingSafeEqual(recebido, calculado);
}

/** Normaliza texto para comparação (sem acento, minúsculo, sem espaços extra). */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Extrai o primeiro evento de mensagem do payload de webhook.
 * Ignora eco da própria conta (is_echo) — senão o bot responderia a si mesmo.
 *
 * @returns {{igsid:string, texto:string, mid:string|null, quando:number|null, respostaStory:boolean}|null}
 */
export function lerEvento(payload) {
  const evento = payload?.entry?.[0]?.messaging?.[0];
  if (!evento) return null;

  const msg = evento.message;
  if (!msg || msg.is_echo) return null;

  const igsid = evento.sender?.id || null;
  if (!igsid) return null;

  return {
    igsid,
    texto: msg.text || '',
    mid: msg.mid || null,
    quando: Number.isFinite(Number(evento.timestamp)) ? Number(evento.timestamp) : null,
    respostaStory: Boolean(msg.reply_to?.story),
  };
}

/** A pessoa tem de usar a palavra-chave; o bot nunca inicia conversa. */
export function deveResponder(texto, palavra = 'LINK') {
  const alvo = normalizar(palavra);
  if (!alvo) return false;
  const livre = normalizar(texto);
  if (!livre) return false;
  return new RegExp(`(^|\\W)${alvo}(\\W|$)`).test(livre);
}

/** Dentro da janela de 24 h a partir da mensagem da pessoa. */
export function dentroDaJanela(quando, agora = Date.now(), janelaMs = JANELA_MS) {
  const t = Number(quando);
  if (!Number.isFinite(t) || t <= 0) return false;
  return agora >= t && agora - t <= janelaMs;
}

/** Idempotência: a Meta reenvia webhook e ninguém pode receber 2 DMs. */
export function jaRespondido(registro, mid) {
  return Boolean(registro && mid && registro[mid]);
}

export function marcarRespondido(registro, mid, igsid, agora = Date.now()) {
  if (!mid) return { ...(registro || {}) };
  return { ...(registro || {}), [mid]: { igsid, quando: agora } };
}

/**
 * Texto da DM. O aviso de automação é exigência citada na doc da Meta para
 * experiências automatizadas ("must disclose that a person is interacting with
 * an automated service").
 */
export function montarResposta(link, { aviso = '🤖 Atendimento automático' } = {}) {
  if (!link) throw new Error('link obrigatório na resposta');
  return `${aviso}\n\nAqui está a oferta 👇\n${link}`;
}
