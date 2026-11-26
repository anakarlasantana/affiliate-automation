/**
 * direct.test.js — webhook e resposta no Direct (FEAT-005 · CA-1..CA-5).
 *
 * O caso que justifica a feature: o story não aceita link, mas o Direct aceita —
 * e a janela do Messaging API é de 24 h depois que a pessoa fala primeiro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  JANELA_MS,
  dentroDaJanela,
  deveResponder,
  jaRespondido,
  lerEvento,
  marcarRespondido,
  montarResposta,
  validarAssinatura,
} from '../src/canais/direct.js';

const SEGREDO = 'segredo-de-teste';
const CORPO = JSON.stringify({ object: 'instagram', entry: [] });
const assinar = (corpo, segredo = SEGREDO) =>
  `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`;

/* ---------------- CA-1: assinatura ---------------- */

test('assinatura válida é aceita', () => {
  assert.equal(validarAssinatura(CORPO, assinar(CORPO), SEGREDO), true);
});

test('assinatura inválida, ausente ou de outro segredo é recusada', () => {
  assert.equal(validarAssinatura(CORPO, assinar(CORPO, 'outro-segredo'), SEGREDO), false);
  assert.equal(validarAssinatura(CORPO, '', SEGREDO), false);
  assert.equal(validarAssinatura(CORPO, assinar(CORPO), ''), false);
  assert.equal(validarAssinatura('corpo alterado', assinar(CORPO), SEGREDO), false);
});

/* ---------------- leitura do evento ---------------- */

const payload = (texto, extra = {}) => ({
  object: 'instagram',
  entry: [
    {
      id: '1784',
      time: 1,
      messaging: [
        {
          sender: { id: 'IGSID-1' },
          timestamp: Date.now(),
          message: { mid: 'mid-1', text: texto, ...extra },
        },
      ],
    },
  ],
});

test('lê o evento e ignora eco da própria conta', () => {
  const evento = lerEvento(payload('LINK'));
  assert.equal(evento.igsid, 'IGSID-1');
  assert.equal(evento.texto, 'LINK');
  assert.equal(evento.mid, 'mid-1');
  assert.equal(evento.respostaStory, false);

  assert.equal(lerEvento(payload('LINK', { is_echo: true })), null);
  assert.equal(lerEvento({}), null);
  assert.equal(lerEvento(null), null);
});

test('reconhece resposta de story', () => {
  const evento = lerEvento(payload('LINK', { reply_to: { story: { url: 'x' } } }));
  assert.equal(evento.respostaStory, true);
});

/* ---------------- CA-2: palavra-chave ---------------- */

test('só responde quando a pessoa usa a palavra-chave', () => {
  assert.equal(deveResponder('LINK'), true);
  assert.equal(deveResponder('  link  '), true);
  assert.equal(deveResponder('quero o link'), true);
  assert.equal(deveResponder('LINK!'), true);

  assert.equal(deveResponder('oi, tudo bem?'), false);
  assert.equal(deveResponder(''), false);
  assert.equal(deveResponder('linktree'), false, 'não casa dentro de outra palavra');
});

/* ---------------- CA-3: idempotência ---------------- */

test('a mesma mensagem nunca gera duas respostas', () => {
  let registro = {};
  assert.equal(jaRespondido(registro, 'mid-1'), false);

  registro = marcarRespondido(registro, 'mid-1', 'IGSID-1', 1000);
  assert.equal(jaRespondido(registro, 'mid-1'), true);
  assert.equal(jaRespondido(registro, 'mid-2'), false);
});

/* ---------------- CA-4: janela de 24 h ---------------- */

test('respeita a janela de 24 horas', () => {
  const agora = 1_000_000_000_000;
  assert.equal(dentroDaJanela(agora - 1000, agora), true);
  assert.equal(dentroDaJanela(agora - JANELA_MS - 1, agora), false);
  assert.equal(dentroDaJanela(agora + 5000, agora), false, 'data no futuro é inválida');
  assert.equal(dentroDaJanela(null, agora), false);
});

/* ---------------- CA-5: conteúdo da DM ---------------- */

test('a DM traz o nosso link e o aviso de automação', () => {
  const texto = montarResposta('https://go.exemplo.com.br/MLB1');
  assert.match(texto, /https:\/\/go\.exemplo\.com\.br\/MLB1/);
  assert.match(texto, /autom[aá]tico/i);
});

test('resposta sem link é erro de programação', () => {
  assert.throws(() => montarResposta(''));
});
