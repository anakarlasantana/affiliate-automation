/**
 * fluxo-log.test.js — rastro do fluxo de foto (FEAT-017 · CA-3, CA-8).
 *
 * O bug de 28/11 foi *silencioso*: a foto boa virou placeholder no envio e nenhuma
 * linha dizia o motivo. Aqui se prova que cada etapa deixa rastro e que a troca
 * por placeholder sempre carrega a causa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAG,
  idDaOferta,
  linhaDeFluxo,
  motivoInvalida,
  resumoDoFluxo,
} from '../src/midia/fluxo-log.js';

/* ================= CA-8: formato das linhas ================= */

test('CA-8: a linha traz tag, id, etapa e status (grep-ável)', () => {
  const linha = linhaDeFluxo({
    id: 'a1b2',
    etapa: 'envio',
    status: 'placeholder',
    detalhe: 'motivo=pequena-demais',
  });

  assert.ok(linha.includes(`${TAG} #a1b2`), 'precisa da tag e do id');
  assert.ok(linha.includes('etapa=envio'));
  assert.ok(linha.includes('status=placeholder'));
  assert.ok(linha.includes('motivo=pequena-demais'));
});

test('CA-8: o resumo junta as etapas numa linha só', () => {
  const r = resumoDoFluxo({
    id: 'ff01',
    etapas: { foto: 'mensagem:download', preco: 79, pagina: 'sem-preco', story: 'sim' },
  });
  assert.ok(r.includes('etapa=resumo'));
  assert.ok(r.includes('foto=mensagem:download'));
  assert.ok(r.includes('preco=79'));
  assert.ok(!r.includes('undefined'), 'etapa vazia não vira "undefined"');
});

test('CA-8: id da oferta é curto, estável e diferente por origem', () => {
  const a = idDaOferta('https://meli.la/abc', 'whatsapp:1@g.us');
  const b = idDaOferta('https://meli.la/abc', 'whatsapp:1@g.us');
  const c = idDaOferta('https://meli.la/xyz', 'whatsapp:1@g.us');

  assert.equal(a, b, 'mesma oferta, mesmo id (correlação funciona)');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{4}$/, 'id curto para caber no log');
  // Sem dados o id vem do fallback 'sem-chave' — o que importa é nao quebrar
  // e continuar curto/estavel (nao precisa ser '0000').
  assert.match(idDaOferta(''), /^[0-9a-f]{4}$/, 'sem dados ainda gera id valido');
  assert.equal(idDaOferta(''), idDaOferta(), 'estavel mesmo sem argumentos');
});

/* ================= CA-3: motivo da degradação ================= */

test('CA-3: motivoInvalida devolve a causa, nunca lança', () => {
  const validar = (b64) => {
    if (b64 === 'boa') return { valido: true };
    if (b64 === 'miniatura') return { valido: false, motivo: 'pequena demais (72x72)' };
    throw new Error('validador quebrado');
  };

  assert.equal(motivoInvalida(validar, 'boa'), null);
  assert.match(motivoInvalida(validar, 'miniatura'), /pequena demais/);
  assert.match(motivoInvalida(validar, 'explode'), /validador-falhou/);
  assert.equal(motivoInvalida(validar, null), 'sem-imagem');
  assert.equal(motivoInvalida(validar, ''), 'sem-imagem');
});

test('CA-3: imagem vazia após a fila é reportada como sem-imagem', () => {
  // cenário real: restaurarPendentes trouxe base64 truncado/nulo
  assert.equal(motivoInvalida(() => ({ valido: false }), null), 'sem-imagem');
});
