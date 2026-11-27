/**
 * redirecionador.test.js — link curto no nosso domínio (FEAT-003 · CA-6..CA-8).
 *
 * É o ponto que conseguimos trocar sem tocar no Instagram (a API não edita bio)
 * e o único lugar em que o clique é medido.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  carregarDestinos,
  chaveDoCaminho,
  destinoPadrao,
  montarDestino,
  registrarClique,
  registrarDestino,
  salvarDestinos,
} from '../src/redirecionador.js';

test('extrai a chave de /go/<chave>', () => {
  assert.equal(chaveDoCaminho('/go/MLB4161352905'), 'MLB4161352905');
  assert.equal(chaveDoCaminho('/go/abc-123_X/'), 'abc-123_X');
});

test('rota fora do padrão não tem chave', () => {
  assert.equal(chaveDoCaminho('/outra/MLB1'), null);
  assert.equal(chaveDoCaminho('/go/'), null);
  assert.equal(chaveDoCaminho(`/go/${'a'.repeat(65)}`), null, 'chave longa é recusada');
  assert.equal(chaveDoCaminho(''), null);
  assert.equal(chaveDoCaminho(null), null);
});

test('destino só aceita https (evita open redirect)', () => {
  const destinos = {
    ok: 'https://produto.mercadolivre.com.br/MLB-4161352905-_JM?matt_tool=20619494',
    inseguro: 'http://exemplo.com/produto',
    perigoso: 'javascript:alert(1)',
  };

  assert.match(montarDestino('ok', destinos), /mercadolivre/);
  assert.equal(montarDestino('inseguro', destinos), null);
  assert.equal(montarDestino('perigoso', destinos), null);
  assert.equal(montarDestino('inexistente', destinos), null);
});

test('conta o clique sem mutar o objeto original', () => {
  const antes = {};
  const um = registrarClique(antes, 'MLB1');
  const dois = registrarClique(um.cliques, 'MLB1');

  assert.equal(um.total, 1);
  assert.equal(dois.total, 2);
  assert.deepEqual(antes, {}, 'cliques originais intactos');
});

test('destino padrão respeita o modo configurado (grupo x oferta)', () => {
  const alvos = {
    grupo: 'https://chat.whatsapp.com/convite',
    oferta: 'https://s.shopee.com.br/abc',
  };

  assert.equal(destinoPadrao('grupo', alvos), alvos.grupo);
  assert.equal(destinoPadrao('oferta', alvos), alvos.oferta);
  assert.equal(destinoPadrao('nada', alvos), null);
  assert.equal(destinoPadrao('grupo', {}), null);
});

test('mapa de destinos persiste em disco e só aceita https', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'destinos-'));
  const arquivo = path.join(pasta, 'go-destinos.json');

  try {
    assert.deepEqual(carregarDestinos(arquivo), {}, 'arquivo ausente = mapa vazio');

    registrarDestino(arquivo, 'MLB1', 'https://produto.mercadolivre.com.br/MLB-1-_JM');
    registrarDestino(arquivo, 'PERIGO', 'javascript:alert(1)');
    registrarDestino(arquivo, 'INSEGURO', 'http://exemplo.com/x');

    const mapa = carregarDestinos(arquivo);
    assert.equal(mapa.MLB1, 'https://produto.mercadolivre.com.br/MLB-1-_JM');
    assert.equal(mapa.PERIGO, undefined, 'javascript: nunca entra');
    assert.equal(mapa.INSEGURO, undefined, 'http: nunca entra');

    assert.equal(salvarDestinos(arquivo, { A: 'https://a.com' }), true);
    assert.deepEqual(carregarDestinos(arquivo), { A: 'https://a.com' });
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('FEAT-013 CA-10: chave por formato (:post) cai na chave do produto', () => {
  const destinos = { 'meli-MLB1': 'https://produto.mercadolivre.com.br/MLB-1-_JM' };
  assert.equal(
    montarDestino('meli-MLB1:post', destinos),
    'https://produto.mercadolivre.com.br/MLB-1-_JM',
  );
  assert.equal(montarDestino('meli-MLB9:post', destinos), null);
});
