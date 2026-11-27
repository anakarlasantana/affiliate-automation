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
import {
  chavePublicadaRecente,
  marcarPublicado,
  registrarNoAcervo,
} from '../src/midia/acervo.js';

const SEGREDO = 'segredo-de-teste';
const DESTINO = 'https://produto.mercadolivre.com.br/MLB-4161352905-_JM?matt_tool=20619494';
const GRUPO = 'https://chat.whatsapp.com/convite';

function configDeTeste(midiaDir) {
  return {
    publicacao: { goDestino: 'grupo', midiaDir, palavraDireto: 'LINK', diretoAtivo: true },
    whatsapp: { meuGrupoLink: GRUPO },
    instagram: {
      appSecret: SEGREDO,
      verifyToken: 'verifica-123',
      userId: '1784',
      token: 'token',
      graphVersion: 'v21.0',
    },
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

async function comServidor(executar, opcoes = {}) {
  const midiaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-teste-'));
  const enviados = [];
  const respondidos = {};
  const cliques = {};
  const cfg = configDeTeste(midiaDir);

  if (opcoes.diretoAtivo !== undefined) cfg.publicacao.diretoAtivo = opcoes.diretoAtivo;
  if (opcoes.goDestino !== undefined) cfg.publicacao.goDestino = opcoes.goDestino;

  const servidor = criarServidor({
    config: cfg,
    destinos: { MLB4161352905: DESTINO },
    cliques,
    respondidos,
    enviarDirect: async (msg) => enviados.push(msg),
    obterChaveAtual:
      opcoes.obterChaveAtual !== undefined
        ? opcoes.obterChaveAtual
        : () => 'MLB4161352905',
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

test('handshake do webhook recusa verify_token errado (CA-1)', async () => {
  await comServidor(async ({ porta }) => {
    const r = await pedir(porta, {
      caminho: '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=desafio-42',
    });

    assert.equal(r.status, 403);
    assert.ok(!r.corpo.includes('desafio-42'), 'não devolve o challenge');
  });
});

test('handshake do webhook devolve o challenge com o token certo (CA-2)', async () => {
  await comServidor(async ({ porta }) => {
    const r = await pedir(porta, {
      caminho:
        '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verifica-123&hub.challenge=desafio-42',
    });

    assert.equal(r.status, 200);
    assert.equal(r.corpo, 'desafio-42');
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

test('DIRETO_ATIVO desligado não responde, mesmo com assinatura válida (CA-3)', async () => {
  await comServidor(
    async ({ porta, enviados }) => {
      const corpo = payloadLINK('mid-desligado');
      const r = await pedir(porta, {
        method: 'POST',
        caminho: '/webhooks/instagram',
        corpo,
        headers: { 'x-hub-signature-256': assinar(corpo), 'content-type': 'application/json' },
      });

      assert.equal(r.status, 200, 'responde 200 para a Meta não reenviar em loop');
      await new Promise((resolver) => setTimeout(resolver, 40));
      assert.equal(enviados.length, 0, 'nenhuma DM com a flag desligada');
    },
    { diretoAtivo: false },
  );
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


test('FEAT-011 CA-6: modo "oferta" — /go vai para a oferta publicada', async () => {
  await comServidor(
    async ({ porta }) => {
      const r = await pedir(porta, { caminho: '/go' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.location, DESTINO);
    },
    { goDestino: 'oferta', obterChaveAtual: () => 'MLB4161352905' },
  );
});

test('FEAT-011 CA-6: sem oferta publicada — /go responde 404 (nunca o grupo)', async () => {
  await comServidor(
    async ({ porta }) => {
      const r = await pedir(porta, { caminho: '/go' });
      assert.equal(r.status, 404);
      assert.equal(r.headers.location, undefined);
    },
    { goDestino: 'oferta', obterChaveAtual: () => null },
  );
});

test('FEAT-011 CA-6: chavePublicadaRecente ignora composto não publicado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-feat011-'));
  try {
    registrarNoAcervo(dir, 'a', { arquivo: 'a.jpg', preco: 10 });
    registrarNoAcervo(dir, 'b', { arquivo: 'b.jpg', preco: 20 });
    assert.equal(chavePublicadaRecente(dir), null);

    marcarPublicado(dir, 'a', { mediaId: '1', quando: '2026-11-27T19:00:00.000Z' });
    assert.equal(chavePublicadaRecente(dir), 'a');

    marcarPublicado(dir, 'b', { mediaId: '2', quando: '2026-11-27T20:00:00.000Z' });
    assert.equal(chavePublicadaRecente(dir), 'b');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('FEAT-012 CA-7: porta ocupada NÃO sobe servidor duplicado', async () => {
  const { decidirServidorInterno, garantirServidorDeMidia, portaOcupada } =
    await import('../src/publicacao/servidor-interno.js');

  assert.deepEqual(decidirServidorInterno({ portaEmUso: true }), {
    subir: false,
    motivo: 'porta-ocupada',
  });
  assert.deepEqual(decidirServidorInterno({}), { subir: true, motivo: null });
  assert.equal(await portaOcupada(3000, { conectar: async () => true }), true);

  let spawnChamado = false;
  const r = await garantirServidorDeMidia({
    porta: 3999,
    conectar: async () => true,
    spawn: () => {
      spawnChamado = true;
      return {};
    },
    cfg: { publicacao: { porta: 3999 }, caminhos: { root: process.cwd() } },
    avisar: () => {},
  });

  assert.equal(r.proprio, false);
  assert.equal(spawnChamado, false, 'não pode duplicar servidor');
});

test('FEAT-012 CA-7: porta livre sobe o servidor interno', async () => {
  const { garantirServidorDeMidia } = await import(
    '../src/publicacao/servidor-interno.js'
  );

  let chamadas = 0;
  const r = await garantirServidorDeMidia({
    porta: 3998,
    // 1ª checagem: livre. Depois de subir: ocupada (servidor no ar).
    conectar: async () => {
      chamadas += 1;
      return chamadas > 1;
    },
    spawn: () => ({ pid: 123, exitCode: null }),
    cfg: { publicacao: { porta: 3998 }, caminhos: { root: process.cwd() } },
    avisar: () => {},
  });

  assert.equal(r.proprio, true);
  assert.equal(r.filho.pid, 123);
});
