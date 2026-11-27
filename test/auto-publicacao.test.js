/**
 * auto-publicacao.test.js — o Instagram operando sozinho (FEAT-012 · CA-1..CA-6, CA-8).
 *
 * Tudo injetado (acervo, preflight, publicação, relógio): nenhuma chamada real à
 * Meta. O que se prova é o RITMO e as defesas — inclusive a que faltou em 27/11:
 * conferir a mídia antes de gastar chamada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PREFIXO,
  criarPublicadorAutomatico,
  preflight,
  proximoPendente,
} from '../src/publicacao/automatica.js';

const DIR = '/tmp/acervo-que-nao-existe-feat012';

function cfgDeTeste({
  publicarStories = true,
  maxStoriesDia = 12,
  maxPostsDia = 6,
  maxReelsDia = 1,
  storiesPorPost = 2,
  intervaloStorySeg = 600,
  feedAtivo = false,
} = {}) {
  return {
    publicacao: {
      midiaDir: DIR,
      baseUrl: 'https://midia.exemplo',
      maxStoriesDia,
      maxPostsDia,
      maxReelsDia,
      storiesPorPost,
      intervaloStorySeg,
      feedAtivo,
    },
    instagram: { publicarStories },
  };
}

/** Acervo de mentira: `a` é mais antigo que `b`. */
function acervoDois() {
  return {
    a: { arquivo: 'a.jpg', preco: 10, titulo: 'A', criado: '2026-11-27T10:00:00Z' },
    b: { arquivo: 'b.jpg', preco: 20, titulo: 'B', criado: '2026-11-27T11:00:00Z' },
  };
}

const preflightOk = async () => ({
  ok: true,
  motivo: null,
  tipo: 'image/jpeg',
  bytes: 307200,
});

/* ============ CA-1: publica sozinho, do mais antigo ao mais novo ============ */

test('CA-1: primeiro ciclo publica o pendente mais antigo', async () => {
  const avisos = [];
  const publicadas = [];
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste(),
    avisar: (m) => avisos.push(m),
    deps: {
      carregar: acervoDois,
      preflight: preflightOk,
      publicar: async ({ chave }) => {
        publicadas.push(chave);
        return { mediaId: '123' };
      },
    },
  });

  const r = await p.ciclo();

  assert.equal(r.publicado, 'a', 'ordem de criação, não de chave');
  assert.deepEqual(publicadas, ['a']);
  assert.ok(avisos.some((m) => m.includes(`✅ ${PREFIXO} Publicado`)));
});

test('CA-1: proximoPendente ignora já publicados e sem arquivo', () => {
  const alvo = proximoPendente({
    x: { arquivo: 'x.jpg', publicadoEm: '2026-11-01T00:00:00Z' },
    y: { preco: 5 },
    z: { arquivo: 'z.jpg', criado: '2026-11-27T12:00:00Z' },
  });
  assert.equal(alvo.chave, 'z');
  assert.equal(proximoPendente({}), null);
});

/* ================= CA-2: respeita o intervalo ================= */

test('CA-2: dentro do intervalo não publica', async () => {
  let chamou = false;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ intervaloStorySeg: 600 }),
    deps: {
      carregar: acervoDois,
      preflight: preflightOk,
      publicar: async () => {
        chamou = true;
        return { mediaId: '1' };
      },
      ultimaPublicacao: 1_000_000,
      agora: () => 1_000_000 + 60_000, // 1 min depois
    },
  });

  const r = await p.ciclo();

  assert.equal(r.motivo, 'intervalo');
  assert.equal(chamou, false, 'não pode furar o intervalo');
});

/* ================= CA-3: kill switch ================= */

test('CA-3: PUBLICAR_STORIES=0 não publica e avisa uma vez', async () => {
  const avisos = [];
  let chamou = false;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ publicarStories: false }),
    avisar: (m) => avisos.push(m),
    deps: {
      carregar: acervoDois,
      preflight: preflightOk,
      publicar: async () => {
        chamou = true;
        return { mediaId: '1' };
      },
    },
  });

  assert.equal((await p.ciclo()).motivo, 'desligado');
  assert.equal((await p.ciclo()).motivo, 'desligado');
  assert.equal(chamou, false);
  assert.equal(
    avisos.filter((m) => m.includes('PUBLICAR_STORIES=0')).length,
    1,
    'o aviso não pode repetir a cada ciclo',
  );
});
/* ================= CA-4: preflight de mídia ================= */

test('CA-4: mídia inacessível adia sem chamar a Meta', async () => {
  let chamou = false;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste(),
    deps: {
      carregar: acervoDois,
      preflight: async () => ({
        ok: false,
        motivo: 'midia-inacessivel',
        detalhe: 'tipo text/html',
      }),
      publicar: async () => {
        chamou = true;
        return { mediaId: '1' };
      },
    },
  });

  const r = await p.ciclo();

  assert.equal(r.motivo, 'midia-inacessivel');
  assert.match(r.detalhe, /text\/html/);
  assert.equal(chamou, false, 'não pode gastar chamada com a mídia fora do ar');
});

test('CA-4: preflight reprova HTML onde deveria haver JPEG', async () => {
  const buscar = async (url) =>
    url.endsWith('/health')
      ? { status: 200, tipo: 'application/json' }
      : { status: 200, tipo: 'text/html; charset=utf-8' };

  const r = await preflight({ baseUrl: 'https://x', arquivo: 'a.jpg', buscar });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'midia-inacessivel');
});

test('CA-4: preflight aprova JPEG e sem baseUrl reprova', async () => {
  const buscar = async (url) =>
    url.endsWith('/health')
      ? { status: 200, tipo: 'application/json' }
      : { status: 200, tipo: 'image/jpeg', bytes: 2048 };

  const ok = await preflight({ baseUrl: 'https://x', arquivo: 'a.jpg', buscar });
  assert.equal(ok.ok, true);
  assert.equal(ok.bytes, 2048);

  assert.equal(
    (await preflight({ baseUrl: '', arquivo: 'a.jpg', buscar })).motivo,
    'sem-base-url',
  );
});

/* ================= CA-5: recusa da Meta pausa o ciclo ================= */

test('CA-5: 9004/2207052 mantém pendente e manda pausar', async () => {
  const avisos = [];
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste(),
    avisar: (m) => avisos.push(m),
    deps: {
      carregar: acervoDois,
      preflight: preflightOk,
      publicar: async () => ({
        motivo: 'erro',
        erro: 'code 9004 subcode 2207052 midia',
      }),
    },
  });

  const r = await p.ciclo();

  assert.equal(r.pausar, true);
  assert.equal(r.publicado, undefined, 'nada pode ser marcado como publicado');
  assert.ok(avisos.some((m) => m.includes('Ciclo pausado')));
});

/* ================= CA-6/CA-8: acervo vazio e logs ================= */

test('CA-6: acervo sem pendente não publica', async () => {
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste(),
    deps: {
      carregar: () => ({
        a: { arquivo: 'a.jpg', publicadoEm: '2026-11-27T10:00:00Z' },
      }),
      preflight: preflightOk,
      publicar: async () => ({ mediaId: '1' }),
    },
  });
  assert.equal((await p.ciclo()).motivo, 'vazio');
});

test('CA-8: o ciclo loga acervo, preflight e publicação com o prefixo [ig]', async () => {
  const avisos = [];
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste(),
    avisar: (m) => avisos.push(m),
    deps: {
      carregar: acervoDois,
      preflight: preflightOk,
      publicar: async () => ({ mediaId: '999' }),
    },
  });

  await p.ciclo();

  for (const esperado of [
    `📸 ${PREFIXO} Acervo:`,
    `🔎 ${PREFIXO} Preflight ok`,
    `🆔 ${PREFIXO} Publicando`,
    `✅ ${PREFIXO} Publicado`,
  ]) {
    assert.ok(
      avisos.some((m) => m.includes(esperado)),
      `faltou log: ${esperado}`,
    );
  }
});

test('CA-7: o ciclo de story ignora entradas de outro formato', () => {
  const acervo = {
    'a:post': {
      arquivo: 'a-post.jpg',
      formato: 'post',
      criado: '2026-11-27T09:00:00Z',
    },
    b: { arquivo: 'b.jpg', criado: '2026-11-27T10:00:00Z' },
  };

  assert.equal(proximoPendente(acervo).chave, 'b', 'post não fura a fila do story');
  assert.equal(proximoPendente(acervo, 'post').chave, 'a:post');
});

/* ============ FEAT-013: o post sai sozinho, com teto próprio ============ */

const acervoSóPost = () => ({
  'meli-MLB1:post': {
    arquivo: 'p.jpg',
    formato: 'post',
    preco: 99,
    criado: '2026-11-27T10:00:00Z',
  },
});

test('CA-6: com feed ativo, o ciclo publica o post quando não há story', async () => {
  const avisos = [];
  let publicouPost = null;

  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ feedAtivo: true }),
    avisar: (m) => avisos.push(m),
    deps: {
      carregar: acervoSóPost,
      preflight: preflightOk,
      publicar: async () => {
        throw new Error('não deveria publicar story');
      },
      publicarPost: async ({ chavePost }) => {
        publicouPost = chavePost;
        return { publicado: true, mediaId: 'media-post' };
      },
    },
  });

  const r = await p.ciclo();

  assert.equal(publicouPost, 'meli-MLB1:post');
  assert.equal(r.formato, 'post');
  assert.equal(r.mediaId, 'media-post');
  assert.ok(avisos.some((m) => m.includes('[post]')), 'log precisa dizer o formato');
});

test('CA-6: post no teto do dia não é publicado', async () => {
  let chamou = false;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ feedAtivo: true, maxPostsDia: 0 }),
    deps: {
      carregar: acervoSóPost,
      preflight: preflightOk,
      publicar: async () => ({ mediaId: '1' }),
      publicarPost: async () => {
        chamou = true;
        return { mediaId: '2' };
      },
    },
  });

  const r = await p.ciclo();

  assert.equal(r.motivo, 'vazio');
  assert.equal(chamou, false, 'MAX_POSTS_DIA=0 bloqueia o post');
});

test('CA-1: story pendente tem prioridade sobre o post', async () => {
  let formato = null;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ feedAtivo: true }),
    deps: {
      carregar: () => ({ ...acervoDois(), ...acervoSóPost() }),
      preflight: preflightOk,
      publicar: async () => {
        formato = 'story';
        return { mediaId: 's1' };
      },
      publicarPost: async () => {
        formato = 'post';
        return { mediaId: 'p1' };
      },
    },
  });

  await p.ciclo();
  assert.equal(formato, 'story');
});

/* ============ interleave e reels (FEAT-013) ============ */

test('CA-6: interleave — 1 post a cada N stories', async () => {
  let formato = null;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ feedAtivo: true, maxPostsDia: 6 }),
    deps: {
      carregar: () => ({ ...acervoDois(), ...acervoSóPost() }),
      preflight: preflightOk,
      // 4 stories publicados hoje, 0 posts -> já é hora de um post (razao 2)
      contar: (_dir, _desde, f) => ({ story: 4, post: 0, reel: 0 })[f] || 0,
      publicar: async () => {
        formato = 'story';
        return { mediaId: 's' };
      },
      publicarPost: async () => {
        formato = 'post';
        return { mediaId: 'p' };
      },
    },
  });

  await p.ciclo();
  assert.equal(formato, 'post', 'com 4 stories e 0 posts, o post fura a fila');
});

test('CA-6: interleave desligado (STORIES_POR_POST=0) prioriza o story', async () => {
  let formato = null;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ feedAtivo: true, storiesPorPost: 0 }),
    deps: {
      carregar: () => ({ ...acervoDois(), ...acervoSóPost() }),
      preflight: preflightOk,
      contar: (_dir, _desde, f) => ({ story: 0, post: 0, reel: 0 })[f] || 0,
      publicar: async () => {
        formato = 'story';
        return { mediaId: 's' };
      },
      publicarPost: async () => {
        formato = 'post';
        return { mediaId: 'p' };
      },
    },
  });

  await p.ciclo();
  assert.equal(formato, 'story');
});

test('CA-4: reel pendente é publicado quando story e post não cabem', async () => {
  let publicouReel = null;
  const p = criarPublicadorAutomatico({
    cfg: cfgDeTeste({ feedAtivo: true, maxStoriesDia: 1, maxPostsDia: 1 }),
    deps: {
      carregar: () => ({
        'a:reel': {
          arquivo: 'v.mp4',
          formato: 'reel',
          preco: 50,
          criado: '2026-11-27T09:00:00Z',
        },
        b: { arquivo: 'b.jpg', criado: '2026-11-27T10:00:00Z' },
      }),
      preflight: async () => ({
        ok: true,
        motivo: null,
        tipo: 'video/mp4',
        bytes: 1024,
      }),
      // story e post já no teto
      contar: (_dir, _desde, f) => ({ story: 1, post: 1, reel: 0 })[f] || 0,
      publicar: async () => ({ mediaId: 's' }),
      publicarPost: async () => ({ mediaId: 'p' }),
      publicarReel: async ({ chaveReel }) => {
        publicouReel = chaveReel;
        return { mediaId: 'r1' };
      },
    },
  });

  const r = await p.ciclo();
  assert.equal(publicouReel, 'a:reel');
  assert.equal(r.formato, 'reel');
});
