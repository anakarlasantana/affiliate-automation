/**
 * oferta.test.js — o ponto único que liga o pipeline ao acervo (FEAT-009).
 *
 * Sem ffmpeg: o compositor é injetado e só registra o que recebeu. Assim se
 * prova que a oferta entra no acervo, que o placeholder NÃO vira story e que o
 * título (og:title) chega ao criativo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chaveSegura, registrarOferta } from '../src/oferta.js';
import { buscarNoAcervo } from '../src/midia/acervo.js';
import { carregarDestinos } from '../src/redirecionador.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FOTO = path.join(RAIZ, 'test', 'fixtures', 'miniatura-whatsapp-1-72x72.jpg');
const LINK = 'https://produto.mercadolivre.com.br/MLB-1-_JM?matt_tool=20619494';

function fotoDataUrl() {
  return `data:image/jpeg;base64,${fs.readFileSync(FOTO).toString('base64')}`;
}

async function comPastas(executar) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-'));
  const midiaDir = path.join(base, 'midia');
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(midiaDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const cfg = {
    caminhos: { root: RAIZ, data: dataDir },
    publicacao: { midiaDir, goDestino: 'grupo' },
  };

  try {
    return await executar({ cfg, midiaDir, dataDir });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/* ---------------- CA-1: destino + acervo ---------------- */

test('registrarOferta grava destino e acervo (CA-1)', async () => {
  await comPastas(async ({ cfg, midiaDir, dataDir }) => {
    let recebido = null;
    const compor = async (opcoes) => {
      recebido = opcoes;
      fs.writeFileSync(opcoes.saida, 'jpeg-falso');
    };

    const r = await registrarOferta({
      chave: 'meli:MLB1',
      link: LINK,
      preco: 279.9,
      titulo: 'Conjunto Fitness',
      imagemBase64: fotoDataUrl(),
      config: cfg,
      deps: { compor },
    });

    assert.equal(r.chave, 'meli-MLB1', 'chave segura para URL');
    assert.equal(r.destino, true);
    assert.equal(r.acervo, true);

    const destinos = carregarDestinos(path.join(dataDir, 'go-destinos.json'));
    assert.equal(destinos['meli-MLB1'], LINK, 'link curto aponta para o afiliado');

    const item = buscarNoAcervo(midiaDir, 'meli-MLB1');
    assert.ok(item.arquivo.endsWith('.jpg'));
    assert.equal(item.preco, 279.9);
    assert.equal(item.link, LINK);

    assert.ok(recebido.saida.endsWith(item.arquivo), 'compôs no arquivo registrado');
    assert.ok(recebido.foto, 'passou a foto para composição');
  });
});

test('sem foto real (ou placeholder) o destino entra, mas o story não (CA-1)', async () => {
  await comPastas(async ({ cfg, midiaDir, dataDir }) => {
    const semFoto = await registrarOferta({
      chave: 'meli:MLB1',
      link: LINK,
      preco: 10,
      imagemBase64: null,
      config: cfg,
      deps: { compor: async () => assert.fail('não deveria compor') },
    });

    assert.equal(semFoto.destino, true, 'o link curto continua válido');
    assert.equal(semFoto.acervo, false);
    assert.equal(semFoto.motivo, 'sem-foto');

    const placeholder = await registrarOferta({
      chave: 'meli:MLB2',
      link: LINK,
      preco: 10,
      imagemBase64: fotoDataUrl(),
      placeholder: true,
      config: cfg,
      deps: { compor: async () => assert.fail('placeholder não vira story') },
    });

    assert.equal(placeholder.acervo, false);
    assert.equal(placeholder.motivo, 'sem-foto');
    assert.equal(buscarNoAcervo(midiaDir, 'meli-MLB2'), null);
    assert.ok(carregarDestinos(path.join(dataDir, 'go-destinos.json'))['meli-MLB2']);
  });
});

test('sem preço não compõe o story e avisa o motivo', async () => {
  await comPastas(async ({ cfg }) => {
    const r = await registrarOferta({
      chave: 'meli:MLB3',
      link: LINK,
      preco: null,
      imagemBase64: fotoDataUrl(),
      config: cfg,
      deps: { compor: async () => assert.fail('sem preço não compõe') },
    });

    assert.equal(r.acervo, false);
    assert.equal(r.motivo, 'sem-preco');
  });
});

/* ---------------- CA-2: título ---------------- */

test('o título do og:title vai para o criativo e para o acervo (CA-2)', async () => {
  await comPastas(async ({ cfg, midiaDir }) => {
    let textos = null;
    const compor = async (opcoes) => {
      textos = opcoes.textos;
      fs.writeFileSync(opcoes.saida, 'x');
    };

    await registrarOferta({
      chave: 'meli:MLB9',
      link: LINK,
      preco: 149.9,
      titulo: 'Barbeador Elétrico Profissional',
      imagemBase64: fotoDataUrl(),
      config: cfg,
      deps: { compor },
    });

    assert.equal(textos.titulo, 'Barbeador Elétrico Profissional', 'título no criativo');
    assert.match(textos.preco, /R\$ 149,90/);
    assert.equal(
      buscarNoAcervo(midiaDir, 'meli-MLB9').titulo,
      'Barbeador Elétrico Profissional',
      'título persistido',
    );
  });
});

test('sem identidade de produto devolve sem-chave e não compõe (loja genérica)', async () => {
  await comPastas(async ({ cfg, midiaDir }) => {
    const r = await registrarOferta({
      chave: '',
      link: LINK,
      preco: 199,
      imagemBase64: fotoDataUrl(),
      config: cfg,
      deps: { compor: async () => assert.fail('sem chave não compõe') },
    });

    assert.equal(r.acervo, false);
    assert.equal(r.destino, false, 'sem chave não há link curto');
    assert.equal(r.motivo, 'sem-chave');
    assert.equal(buscarNoAcervo(midiaDir, ''), null);
  });
});

test('chaveSegura troca separadores por hífen', () => {
  assert.equal(chaveSegura('meli:MLB4161352905'), 'meli-MLB4161352905');
  assert.equal(chaveSegura('shopee:762281166.23697998466'), 'shopee-762281166-23697998466');
  assert.equal(chaveSegura(''), '');
});

test('FEAT-013 CA-7: feed ativo compõe o 4:5 e deixa o post pendente', async () => {
  await comPastas(async ({ cfg, midiaDir }) => {
    cfg.publicacao.feedAtivo = true;
    let chamouFeed = false;

    const r = await registrarOferta({
      chave: 'meli:MLB1',
      link: LINK,
      preco: 279.9,
      titulo: 'Conjunto Fitness',
      imagemBase64: fotoDataUrl(),
      config: cfg,
      deps: {
        compor: async (o) => fs.writeFileSync(o.saida, 'story'),
        comporFeed: async (o) => {
          chamouFeed = true;
          fs.writeFileSync(o.saida, 'post');
        },
      },
    });

    assert.equal(r.acervo, true);
    assert.equal(chamouFeed, true, 'compôs o criativo do feed');

    const post = buscarNoAcervo(midiaDir, 'meli-MLB1:post');
    assert.ok(post, 'post na chave por formato');
    assert.equal(post.formato, 'post');
    assert.equal(post.publicadoEm, undefined, 'post fica pendente para o ciclo');

    assert.equal(buscarNoAcervo(midiaDir, 'meli-MLB1').formato, 'story');
  });
});

test('FEAT-013: falha ao compor o feed não derruba o story', async () => {
  await comPastas(async ({ cfg, midiaDir }) => {
    cfg.publicacao.feedAtivo = true;

    const r = await registrarOferta({
      chave: 'meli:MLB2',
      link: LINK,
      preco: 100,
      titulo: 'X',
      imagemBase64: fotoDataUrl(),
      config: cfg,
      deps: {
        compor: async (o) => fs.writeFileSync(o.saida, 'story'),
        comporFeed: async () => {
          throw new Error('ffmpeg caiu');
        },
      },
    });

    assert.equal(r.acervo, true, 'story continua registrado');
    assert.equal(buscarNoAcervo(midiaDir, 'meli-MLB2:post'), null);
  });
});
