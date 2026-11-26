/**
 * servidor.test.js — as três rotas públicas (FEAT-003 CA-6/CA-7/CA-8 e
 * FEAT-005 CA-1/CA-3). Sobe um servidor real em porta efêmera: o que interessa
 * é o comportamento do roteador, não um mock de HTTP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { criarServidor, linkCurto, nomeSeguro } from '../src/servidor.js';

const SEGREDO = 'segredo-de-teste';
const DESTINO = 'https://produto.mercadolivre.com.br/MLB-4161352905-_JM?matt_tool=20619494';
const GRUPO = 'https://chat.whatsapp.com/convite';

function configDeTeste(midiaDir) {
  return {
    publicacao: { goDestino: 'grupo', midiaDir, palavraDireto: 'LINK' },
    whatsapp: { meuGrupoLink: GRUPO },
    instagram: { appSecret: SEGREDO, userId: '1784', token: 'token', graphVersion: 'v21.0' },
  };
}

function pedir(porta, { method = 'GET', caminho = '/', corpo = '', headers = {} } = {}) {
  return new Promise((resolve, rejeitar) => {
    const req = http.request(
      { host: '127.0.0.1', port: porta, method, path: caminho, headers },
      (res) => {
        const partes = [];
        res.on('data', (p) => partes.push(p));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            corpo: Buffer.concat(partes).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', rejeitar);
    if (corpo) req.write(corpo);
    req.end();
  });
}

async function comServidor(executar) {
  const midiaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-teste-'));
  const enviados = [];
  const respondidos = {};
  const cliques = {};

  const servidor = criarServidor({
    config: configDeTeste(midiaDir),
    destinos: { MLB4161352905: DESTINO },
    cliques,
    respondidos,
    enviarDirect: async (msg) => enviados.push(msg),
    obterChaveAtual: () => 'MLB4161352905',
  });

  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = servidor.address().port;

  try {
    await executar({ porta, midiaDir, enviados, respondidos, cliques });
  } finally {
    await new Promise((r) => servidor.close(r));
    fs.rmSync(midiaDir, { recursive: true, force: true });
  }
}

const payloadLINK = (mid = 'mid-1') =>
  JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: '1784',
        time: 1,
        messaging: [
          {
            sender: { id: 'IGSID-1' },
            timestamp: Date.now(),
            message: { mid, text: 'LINK' },
          },
        ],
      },
    ],
  });

const assinar = (corpo) =>
  `sha256=${createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('hex')}`;

test('health responde 200', async () => {
  await comServidor(async ({ porta }) => {
    const r = await pedir(porta, { caminho: '/health' });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.corpo).ok, true);
  });
});

test('/go/<chave> redireciona 302 e conta o clique (CA-6, CA-7)', async () => {
  await comServidor(async ({ porta, cliques }) => {
    const primeira = await pedir(porta, { caminho: '/go/MLB4161352905' });
    assert.equal(primeira.status, 302);
    assert.equal(primeira.headers.location, DESTINO);
    assert.equal(cliques.MLB4161352905, 1);

    await pedir(porta, { caminho: '/go/MLB4161352905' });
    assert.equal(cliques.MLB4161352905, 2, 'segundo clique contado');
  });
});

test('chave desconhecida devolve 404, não cai no grupo (CA-8)', async () => {
  await comServidor(async ({ porta }) => {
    const r = await pedir(porta, { caminho: '/go/INE-XISTENTE' });
    assert.equal(r.status, 404);
    assert.equal(r.headers.location, undefined);
  });
});

test('/go sem chave usa o destino padrão configurado (bio)', async () => {
  await comServidor(async ({ porta }) => {
    const r = await pedir(porta, { caminho: '/go' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, GRUPO);
  });
});

test('/midia serve o arquivo com content-type (CA-5)', async () => {
  await comServidor(async ({ porta, midiaDir }) => {
    fs.writeFileSync(path.join(midiaDir, 'abc123.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const r = await pedir(porta, { caminho: '/midia/abc123.jpg' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/jpeg');

    const ausente = await pedir(porta, { caminho: '/midia/nao-existe.jpg' });
    assert.equal(ausente.status, 404);
  });
});

test('/midia recusa nome fora do padrão', async () => {
  await comServidor(async ({ porta }) => {
    const r = await pedir(porta, { caminho: '/midia/arquivo%3Cx%3E.jpg' });
    assert.equal(r.status, 400);
  });
});

test('webhook sem assinatura válida devolve 401 (CA-1 do Direct)', async () => {
  await comServidor(async ({ porta }) => {
    const corpo = payloadLINK();
    const semAssinatura = await pedir(porta, {
      method: 'POST',
      caminho: '/webhooks/instagram',
      corpo,
    });
    assert.equal(semAssinatura.status, 401);

    const errada = await pedir(porta, {
      method: 'POST',
      caminho: '/webhooks/instagram',
      corpo,
      headers: { 'x-hub-signature-256': 'sha256=deadbeef', 'content-type': 'application/json' },
    });
    assert.equal(errada.status, 401);
  });
});

test('webhook assinado responde 200 e envia uma DM; reenvio não duplica (CA-3)', async () => {
  await comServidor(async ({ porta, enviados }) => {
    const corpo = payloadLINK('mid-abc');
    const cabecalhos = {
      'x-hub-signature-256': assinar(corpo),
      'content-type': 'application/json',
    };

    const r = await pedir(porta, {
      method: 'POST',
      caminho: '/webhooks/instagram',
      corpo,
      headers: cabecalhos,
    });
    assert.equal(r.status, 200);

    // O processamento é assíncrono (setImmediate): a Meta recebe 200 na hora.
    await new Promise((resolver) => setTimeout(resolver, 40));

    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].igsid, 'IGSID-1');
    assert.match(enviados[0].texto, /\/go\/|chat\.whatsapp/);

    // Reenvio da Meta com o mesmo mid: nada novo.
    await pedir(porta, {
      method: 'POST',
      caminho: '/webhooks/instagram',
      corpo,
      headers: cabecalhos,
    });
    await new Promise((resolver) => setTimeout(resolver, 40));
    assert.equal(enviados.length, 1, 'idempotente por mid');
  });
});

test('linkCurto e nomeSeguro protegem o básico', () => {
  assert.equal(
    linkCurto({ publicacao: { goBaseUrl: 'https://go.exemplo.com.br/' } }, 'MLB1'),
    'https://go.exemplo.com.br/go/MLB1',
    'barra final não duplica',
  );
  assert.equal(linkCurto({ publicacao: {} }, 'MLB1'), null);

  assert.equal(nomeSeguro('../../etc/passwd'), 'passwd', 'colapsa para o basename');
  assert.equal(nomeSeguro('.env'), null, 'arquivo oculto é recusado');
  assert.equal(nomeSeguro('a b.jpg'), null, 'espaço é recusado');
});

