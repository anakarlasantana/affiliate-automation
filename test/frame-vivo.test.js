/**
 * frame-vivo.test.js — página do WhatsApp morreu (FEAT-018).
 *
 * O caso real de 28/11 na VPS: 14 erros `detached Frame 'A9DF9E9E…'` (sempre o
 * mesmo frame) e 91 `callFunctionOn timed out`. A página recarregou e o Puppeteer
 * seguiu falando com o frame morto — toda oferta caiu em placeholder e o app
 * continuou dizendo "Sistema ativo".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clienteResponde,
  ehFrameMorto,
  frameDoErro,
} from '../src/whatsapp/frame-vivo.js';

/* ============ quais erros significam "frame morto" ============ */

test('CA-1: erro de detached Frame é reconhecido', () => {
  const erro = new Error(
    "Attempted to use detached Frame 'A9DF9E9E19A2772D3213EF729991317D'.",
  );
  assert.equal(ehFrameMorto(erro), true);
  assert.equal(frameDoErro(erro), 'A9DF9E9E19A2772D3213EF729991317D');
});

test('CA-1: outros erros de sessão morta também contam', () => {
  for (const msg of [
    'Target closed',
    'Session closed. Most likely the page has been closed.',
    'Page crashed!',
    'Execution context was destroyed, most likely because of a navigation.',
    'Cannot find context with specified id',
  ]) {
    assert.equal(ehFrameMorto(new Error(msg)), true, msg);
  }
});

test('CA-1: timeout comum NÃO é frame morto (aí a retentativa vale)', () => {
  assert.equal(
    ehFrameMorto(new Error('Runtime.callFunctionOn timed out')),
    false,
  );
  assert.equal(ehFrameMorto(new Error('no media found for message id')), false);
  assert.equal(ehFrameMorto(null), false);
});

test('CA-1: aceita string crua (o textoErro do app)', () => {
  assert.equal(
    ehFrameMorto("Attempted to use detached Frame 'ABC123'"),
    true,
  );
  assert.equal(frameDoErro('sem frame no texto'), null);
});

/* ============ health-check do cliente ============ */

test('CA-2: cliente que responde é considerado vivo', async () => {
  const client = { evaluate: async () => 1 };
  assert.deepEqual(await clienteResponde(client), { vivo: true, motivo: null });
});

test('CA-2: cliente com getConnectionState CONNECTED é vivo', async () => {
  const client = { getConnectionState: async () => 'CONNECTED' };
  assert.equal((await clienteResponde(client)).vivo, true);
});

test('CA-2: frame morto no health-check é detectado', async () => {
  const client = {
    evaluate: async () => {
      throw new Error("Attempted to use detached Frame 'DEAD00'");
    },
  };
  const r = await clienteResponde(client);
  assert.equal(r.vivo, false);
  assert.match(r.motivo, /frame-morto/);
  assert.match(r.motivo, /DEAD00/);
});

test('CA-2: health-check tem prazo e não trava o pipeline', async () => {
  const client = { evaluate: () => new Promise(() => {}) }; // nunca resolve
  const r = await clienteResponde(client, { timeoutMs: 50 });
  assert.equal(r.vivo, false);
  assert.equal(r.motivo, 'timeout-health-check');
});

test('CA-2: sem cliente não inventa saúde', async () => {
  assert.deepEqual(await clienteResponde(null), {
    vivo: false,
    motivo: 'sem-cliente',
  });
});
