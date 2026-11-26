/**
 * publicacao.test.js — guardas e orquestração da publicação (FEAT-007).
 *
 * Nada de rede e nada de token: o canal e a quota são injetados, então o teste
 * prova a REGRA (flag, credencial, URL pública, preço, acervo) sem publicar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MOTIVOS, decidirPublicacao } from '../src/canais/base.js';
import {
  MOTIVOS_PUBLICACAO,
  conferirPublicacao,
  legendaDoStory,
  publicarDoAcervo,
} from '../src/canais/publicacao.js';
import { buscarNoAcervo, registrarNoAcervo } from '../src/midia/acervo.js';

const REGISTRO = {
  arquivo: 'abc123.jpg',
  link: 'https://produto.mercadolivre.com.br/MLB-1-_JM?matt_tool=20619494',
  preco: 149.9,
};

async function comAcervo(executar) {
  const midiaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acervo-'));
  try {
    return await executar(midiaDir);
  } finally {
    fs.rmSync(midiaDir, { recursive: true, force: true });
  }
}

/* ---------------- CA-3: acervo ---------------- */

test('o acervo persiste chave → arquivo, link e preço', async () => {
  await comAcervo(async (midiaDir) => {
    assert.equal(buscarNoAcervo(midiaDir, 'meli-MLB1'), null, 'acervo começa vazio');

    registrarNoAcervo(midiaDir, 'meli-MLB1', REGISTRO);
    const item = buscarNoAcervo(midiaDir, 'meli-MLB1');

    assert.equal(item.arquivo, 'abc123.jpg');
    assert.equal(item.link, REGISTRO.link);
    assert.equal(item.preco, 149.9);
    assert.ok(item.criado, 'guarda a data de criação');
  });
});

/* ---------------- CA-4 e CA-5: flag x credencial ---------------- */

test('kill switch desligado recusa com motivo desligado (CA-4)', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'k', REGISTRO);

    const r = await publicarDoAcervo({
      chave: 'k',
      deps: { midiaDir, killSwitch: false, credencialOk: true, baseUrl: 'https://go.exemplo.com' },
    });

    assert.equal(r.pronto, false);
    assert.equal(r.motivo, MOTIVOS_PUBLICACAO.DESLIGADO);
  });
});

test('sem credencial o motivo é sem-credencial, distinto do desligado (CA-5)', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'k', REGISTRO);

    const r = await publicarDoAcervo({
      chave: 'k',
      deps: { midiaDir, killSwitch: true, credencialOk: false, baseUrl: 'https://go.exemplo.com' },
    });

    assert.equal(r.motivo, MOTIVOS_PUBLICACAO.SEM_CREDENCIAL);
    assert.notEqual(r.motivo, MOTIVOS_PUBLICACAO.DESLIGADO, 'não confunde os dois cenários');

    const decisao = decidirPublicacao({
      killSwitch: true,
      temCredencial: false,
      preco: { atual: 10 },
    });
    assert.equal(decisao.motivo, MOTIVOS.SEM_CREDENCIAL);
  });
});

/* ---------------- CA-6, CA-7 e sem-preço ---------------- */

test('sem PUBLIC_BASE_URL recusa: a Meta não baixaria a mídia (CA-6)', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'k', REGISTRO);

    const r = await publicarDoAcervo({
      chave: 'k',
      deps: { midiaDir, killSwitch: true, credencialOk: true, baseUrl: '' },
    });

    assert.equal(r.motivo, MOTIVOS_PUBLICACAO.SEM_BASE_URL);
  });
});

test('chave fora do acervo recusa e lista as disponíveis (CA-7)', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'existe', REGISTRO);

    const r = await publicarDoAcervo({
      chave: 'nao-existe',
      deps: { midiaDir, killSwitch: true, credencialOk: true, baseUrl: 'https://go.exemplo.com' },
    });

    assert.equal(r.motivo, MOTIVOS_PUBLICACAO.SEM_ACERVO);
    assert.deepEqual(r.disponiveis, ['existe']);
  });
});

test('sem preço no acervo recusa (story sem valor não sai)', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'k', { arquivo: 'a.jpg', link: 'https://x.com', preco: null });

    const r = await publicarDoAcervo({
      chave: 'k',
      deps: { midiaDir, killSwitch: true, credencialOk: true, baseUrl: 'https://go.exemplo.com' },
    });

    assert.equal(r.motivo, MOTIVOS_PUBLICACAO.SEM_PRECO);
  });
});

/* ---------------- CA-8: publica ---------------- */

test('com tudo pronto publica um story e devolve o mediaId (CA-8)', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'k', { ...REGISTRO, titulo: 'Fritadeira 5L' });

    let recebido = null;
    const canal = {
      async publicar(dados) {
        recebido = dados;
        return { publicado: true, motivo: null, mediaId: 'media-1' };
      },
    };

    const r = await publicarDoAcervo({
      chave: 'k',
      deps: {
        midiaDir,
        killSwitch: true,
        credencialOk: true,
        baseUrl: 'https://go.exemplo.com/',
        quota: async () => ({ usada: 3, total: 50 }),
        canal,
      },
    });

    assert.equal(r.publicado, true);
    assert.equal(r.mediaId, 'media-1');
    assert.equal(r.imagemUrl, 'https://go.exemplo.com/midia/abc123.jpg', 'barra final não duplica');
    assert.match(r.legenda, /Fritadeira 5L/);
    assert.match(r.legenda, /R\$ 149,90/);
    assert.equal(recebido.quotaUsada, 3);
    assert.equal(r.quota.total, 50);
  });
});

test('quota indisponível aborta antes de publicar', async () => {
  await comAcervo(async (midiaDir) => {
    registrarNoAcervo(midiaDir, 'k', REGISTRO);
    let publicou = false;

    const r = await publicarDoAcervo({
      chave: 'k',
      deps: {
        midiaDir,
        killSwitch: true,
        credencialOk: true,
        baseUrl: 'https://go.exemplo.com',
        quota: async () => {
          throw new Error('401 token inválido');
        },
        canal: {
          async publicar() {
            publicou = true;
            return { publicado: true };
          },
        },
      },
    });

    assert.equal(r.motivo, MOTIVOS_PUBLICACAO.QUOTA_INDISPONIVEL);
    assert.equal(publicou, false, 'não publica quando não sabe a quota');
  });
});

test('guardas puras devolvem o primeiro impeditivo', () => {
  assert.deepEqual(conferirPublicacao({}), { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_ACERVO });

  assert.equal(
    conferirPublicacao({ registro: REGISTRO, killSwitch: false }).motivo,
    MOTIVOS_PUBLICACAO.DESLIGADO,
  );
  assert.equal(
    conferirPublicacao({ registro: REGISTRO, killSwitch: true, credencialOk: true }).motivo,
    MOTIVOS_PUBLICACAO.SEM_BASE_URL,
  );
  assert.equal(
    conferirPublicacao({
      registro: REGISTRO,
      killSwitch: true,
      credencialOk: true,
      baseUrl: 'https://x.com',
      preco: 0,
    }).motivo,
    MOTIVOS_PUBLICACAO.SEM_PRECO,
  );
  assert.equal(
    conferirPublicacao({
      registro: REGISTRO,
      killSwitch: true,
      credencialOk: true,
      baseUrl: 'https://x.com',
      preco: 10,
    }).pronto,
    true,
  );
});

test('legenda do story combina título, preço e CTA', () => {
  const legenda = legendaDoStory({ titulo: 'Tênis', preco: 199 });
  assert.match(legenda, /Tênis — R\$ 199/);
  assert.match(legenda, /link na bio/);

  assert.match(legendaDoStory({ preco: 89.9 }), /R\$ 89,90/);
  assert.match(legendaDoStory({}), /Oferta/, 'sem título, ainda tem cabeça');
});

