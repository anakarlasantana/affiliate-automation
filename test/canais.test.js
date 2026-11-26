/**
 * canais.test.js — regra de publicação (FEAT-004 · CA-1..CA-5).
 *
 * Tudo aqui é puro: nenhuma chamada ao Instagram, nenhum token. É o que permite
 * provar kill switch, preço obrigatório, quota, dedup e isolamento de falha sem
 * rede — e sem publicar nada de verdade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CanalPublisher,
  MOTIVOS,
  decidirPublicacao,
  tentarPublicar,
} from '../src/canais/base.js';

const PRECO_OK = { atual: 199, antigo: 299, desconto: 33 };

test('kill switch desligado não publica (CA-1)', () => {
  assert.deepEqual(decidirPublicacao({ killSwitch: false, preco: PRECO_OK }), {
    publicar: false,
    motivo: MOTIVOS.DESLIGADO,
  });
});

test('sem preço não publica o story (CA-2)', () => {
  assert.equal(decidirPublicacao({ killSwitch: true, preco: null }).motivo, MOTIVOS.SEM_PRECO);
  assert.equal(decidirPublicacao({ killSwitch: true, preco: { atual: 0 } }).motivo, MOTIVOS.SEM_PRECO);
  assert.equal(decidirPublicacao({ killSwitch: true }).motivo, MOTIVOS.SEM_PRECO);
});

test('quota esgotada não publica (CA-3)', () => {
  const r = decidirPublicacao({
    killSwitch: true,
    preco: PRECO_OK,
    quotaUsada: 50,
    quotaTotal: 50,
  });
  assert.equal(r.publicar, false);
  assert.equal(r.motivo, MOTIVOS.QUOTA);
});

test('dedup por canal impede repetir a mesma oferta (CA-4)', () => {
  const r = decidirPublicacao({ killSwitch: true, preco: PRECO_OK, jaPublicado: true });
  assert.equal(r.motivo, MOTIVOS.DUPLICADO);
});

test('limite diário é respeitado (conta pequena não vira spam)', () => {
  const r = decidirPublicacao({
    killSwitch: true,
    preco: PRECO_OK,
    publicadosHoje: 5,
    limiteDia: 5,
  });
  assert.equal(r.motivo, MOTIVOS.LIMITE);
});

test('com tudo em ordem, publica', () => {
  assert.deepEqual(
    decidirPublicacao({
      killSwitch: true,
      preco: PRECO_OK,
      quotaUsada: 3,
      quotaTotal: 50,
      jaPublicado: false,
      publicadosHoje: 1,
      limiteDia: 5,
    }),
    { publicar: true, motivo: null },
  );
});

test('falha do Instagram não vaza para o WhatsApp (CA-5)', async () => {
  const canalQuebrado = {
    async publicar() {
      throw new Error('IG fora do ar');
    },
  };

  const r = await tentarPublicar(canalQuebrado, {});

  assert.equal(r.ok, false);
  assert.match(r.erro, /IG fora do ar/);
});

test('sucesso do canal é repassado', async () => {
  const r = await tentarPublicar({ async publicar() { return { mediaId: 'x' }; } }, {});
  assert.equal(r.ok, true);
  assert.equal(r.resultado.mediaId, 'x');
});

test('contrato do canal exige credencial e não se declara configurado sem ela', () => {
  class CanalDeTeste extends CanalPublisher {
    static credenciaisRequeridas = ['CREDENCIAL_CANAL_XYZ'];
  }

  assert.deepEqual(CanalDeTeste.credenciaisFaltantes(), ['CREDENCIAL_CANAL_XYZ']);
  assert.equal(CanalDeTeste.estaConfigurado(), false);
});
