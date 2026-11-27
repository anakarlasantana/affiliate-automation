/**
 * status.test.js — seção do Instagram no `npm run status` (FEAT-012 · CA-9).
 *
 * Antes só existia a fila do WhatsApp: não havia como saber quantos stories
 * estavam prontos, qual foi o último publicado nem por que o ciclo parou.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { secaoInstagram } from '../src/status-ig.js';

const ACERVO = {
  antigo: {
    arquivo: 'a.jpg',
    preco: 10,
    criado: '2026-11-27T10:00:00Z',
    publicadoEm: '2026-11-27T12:00:00Z',
    mediaId: '111',
  },
  novo: {
    arquivo: 'b.jpg',
    preco: 20,
    criado: '2026-11-27T11:00:00Z',
    publicadoEm: '2026-11-27T13:00:00Z',
    mediaId: '222',
  },
  pronto: { arquivo: 'c.jpg', preco: 30, criado: '2026-11-27T09:00:00Z' },
};

test('CA-9: mostra publicados de hoje, quota e o último mediaId', () => {
  const linhas = secaoInstagram({
    acervo: ACERVO,
    quota: { usada: 3, total: 100 },
    limiteDia: 12,
    desde: '2026-11-27T00:00:00Z',
  }).join('\n');

  assert.match(linhas, /📸 INSTAGRAM — 2\/12 hoje · quota 3\/100/);
  assert.match(linhas, /Último\s+: novo · mediaId 222/);
  assert.match(linhas, /Pendentes : 1 \(mais antigo: pronto\)/);
});

test('CA-9: sem publicado ainda, diz isso em vez de inventar', () => {
  const linhas = secaoInstagram({
    acervo: { pronto: { arquivo: 'c.jpg', criado: '2026-11-27T09:00:00Z' } },
    limiteDia: 12,
  }).join('\n');

  assert.match(linhas, /nenhum story publicado ainda/);
  assert.match(linhas, /quota indisponível/);
  assert.match(linhas, /Pendentes : 1/);
});

test('CA-9: pendências contam só quem tem arquivo composto', () => {
  const linhas = secaoInstagram({
    acervo: { semMidia: { publicadoEm: null } },
    limiteDia: 5,
  }).join('\n');
  assert.match(linhas, /Pendentes : nenhum/);
});

test('CA-9: mostra o último bloqueio quando o ciclo automático registrou', () => {
  const linhas = secaoInstagram({
    acervo: {},
    limiteDia: 12,
    bloqueio: { motivo: 'midia-inacessivel', quando: '2026-11-27T19:28:00Z' },
  }).join('\n');

  assert.match(linhas, /Bloqueio\s+: midia-inacessivel em 2026-11-27T19:28:00Z/);
});
