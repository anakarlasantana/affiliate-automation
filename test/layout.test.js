/**
 * layout.test.js — composição por template (FEAT-008).
 *
 * Nada de ffmpeg de verdade: provamos o MAPA (zonas), a matemática de
 * enquadramento e o argv gerado. Foi assim que descobrimos que a foto de
 * 500×500 estava sendo esticada 3,84× até borrar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ALTURA,
  LARGURA,
  LAYOUT_EMBUTIDO,
  calcularFotoNaZona,
  carregarLayout,
  montarArgsComTemplate,
  normalizarTemplate,
  truncarTitulo,
  validarLayout,
} from '../src/midia/layout.js';

const LAYOUT_VALIDO = {
  versao: 1,
  largura: LARGURA,
  altura: ALTURA,
  foto: { x: 140, y: 570, w: 818, h: 698, escalaMax: 1 },
  titulo: { x: 150, y: 1330, maxLargura: 780, tamanho: 40, linhas: 2 },
  preco: { x: 150, y: 1430, tamanho: 108, contorno: 3 },
  cta: { y: 1685, tamanho: 58 },
};

const TEXTOS = {
  titulo: 'Kit 10 Panos de Microfibra',
  preco: 'R$ 279,90',
  de: 'de R$ 399 (-30%)',
  principal: 'LINK NA BIO',
};

function comArquivoTemporario(conteudo, executar) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
  const arquivo = path.join(pasta, 'story.json');
  if (conteudo !== null) fs.writeFileSync(arquivo, conteudo);
  try {
    return executar(arquivo);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

/* ---------------- CA-1 / CA-2: leitura do JSON ---------------- */

test('layout válido é carregado e mescla as zonas (CA-1)', () => {
  comArquivoTemporario(JSON.stringify(LAYOUT_VALIDO), (arquivo) => {
    const layout = carregarLayout(arquivo);

    assert.ok(layout, 'layout carregado');
    assert.equal(layout.foto.w, 818);
    assert.equal(layout.foto.escalaMax, 1);
    assert.equal(layout.titulo.maxLargura, 780);
    assert.equal(layout.cta.y, 1685);
    assert.equal(layout.precoDe.tamanho, LAYOUT_EMBUTIDO.precoDe.tamanho, 'zona ausente herda o padrão');
  });
});

test('JSON ausente ou inválido devolve null (fallback embutido) (CA-2)', () => {
  comArquivoTemporario(null, (arquivo) => {
    assert.equal(carregarLayout(arquivo), null, 'arquivo ausente');
  });

  comArquivoTemporario('{ isso não é json', (arquivo) => {
    assert.equal(carregarLayout(arquivo), null, 'json quebrado');
  });

  comArquivoTemporario(JSON.stringify({ largura: 1080 }), (arquivo) => {
    assert.equal(carregarLayout(arquivo), null, 'json sem as zonas obrigatórias');
  });

  assert.equal(validarLayout({}).ok, false);
  assert.deepEqual(validarLayout(null).erros, ['layout não é objeto']);
});

/* ---------------- CA-3: enquadramento sem ampliar ---------------- */

test('foto menor que a zona fica em contain, sem ampliar (CA-3)', () => {
  const dim = calcularFotoNaZona({ largura: 500, altura: 500 }, LAYOUT_VALIDO.foto, 1);

  assert.equal(dim.escala, 1, 'escalaMax impede ampliar');
  assert.equal(dim.w, 500);
  assert.equal(dim.h, 500);
  assert.equal(dim.x, 299, 'centralizada na zona (140 + (818-500)/2)');
  assert.equal(dim.y, 669, 'centralizada na zona (570 + (698-500)/2)');
});

test('foto grande é reduzida para caber na zona', () => {
  const dim = calcularFotoNaZona({ largura: 2000, altura: 2000 }, LAYOUT_VALIDO.foto, 1);
  assert.ok(dim.w <= LAYOUT_VALIDO.foto.w && dim.h <= LAYOUT_VALIDO.foto.h);
  assert.ok(dim.escala < 1);
});

/* ---------------- CA-4: normalização do template ---------------- */

test('template 768x1376 é normalizado para 1080x1920 cortando o centro (CA-4)', () => {
  const n = normalizarTemplate({ largura: 768, altura: 1376 });

  assert.equal(n.precisa, true);
  assert.equal(n.escala, 1.40625);
  assert.equal(n.alturaEscalada, 1935);
  assert.equal(n.cropY, 7, 'corta 7px no topo e 8 na base');
  assert.equal(n.padY, 0);

  const jaCerto = normalizarTemplate({ largura: 1080, altura: 1920 });
  assert.equal(jaCerto.precisa, false);
  assert.equal(jaCerto.cropY, 0);

  assert.throws(() => normalizarTemplate({ largura: 0, altura: 0 }));
});

/* ---------------- CA-5: título truncado ---------------- */

test('título longo é truncado em duas linhas com reticências (CA-5)', () => {
  const longo = 'Kit 10 Panos de Limpeza Microfibra Alta Absorção Multiuso 3 Unidades Promoção';
  const linhas = truncarTitulo(longo, LAYOUT_VALIDO.titulo);

  assert.equal(linhas.length, 2);
  assert.match(linhas[1], /…$/, 'última linha marca o corte');
  for (const linha of linhas) assert.ok(linha.length <= 36, `linha cabe na zona (${linha})`);

  assert.deepEqual(truncarTitulo('Fritadeira 5L', LAYOUT_VALIDO.titulo), ['Fritadeira 5L']);
  assert.deepEqual(truncarTitulo('', LAYOUT_VALIDO.titulo), []);
});

/* ---------------- CA-6 / CA-7: argv ---------------- */

test('argv compõe sobre o template com preço contornado e CTA centralizado (CA-6)', () => {
  const args = montarArgsComTemplate({
    base: '/arte/story-base.png',
    foto: '/tmp/foto.jpg',
    dimensoesFoto: { largura: 500, altura: 500 },
    layout: LAYOUT_VALIDO,
    textos: TEXTOS,
    saida: '/tmp/story.jpg',
    fonte: '/fonte.ttf',
  });

  const filtro = args[args.indexOf('-filter_complex') + 1];

  assert.ok(args.includes('/arte/story-base.png'), 'usa o PNG base');
  assert.match(filtro, /scale=500:500:flags=lanczos/, 'foto sem upscale');
  assert.match(filtro, /overlay=299:669/, 'foto na zona calculada');
  assert.match(filtro, /borderw=3:bordercolor=black/, 'preço com contorno');
  assert.match(filtro, /x=\(w-text_w\)\/2/, 'CTA centralizado');
  assert.match(filtro, /R\$ 279\\,90/, 'preço no criativo (vírgula escapada p/ drawtext)');
  assert.match(filtro, /de R\$ 399 \(-30\\%\)/, '"de/por" com % no criativo');
  assert.equal(
    (filtro.match(/expansion=none/g) || []).length,
    4,
    'todo drawtext tem expansion=none (sem isso, % faz o texto sumir)',
  );
  assert.match(filtro, /LINK NA BIO/, 'CTA no criativo');
  assert.equal(args.at(-1), '/tmp/story.jpg');
  assert.equal(args[args.indexOf('-q:v') + 1], '2', 'JPEG de qualidade 2');
});

test('compor sem preço é erro explícito (CA-7)', () => {
  assert.throws(
    () =>
      montarArgsComTemplate({
        base: '/arte/story-base.png',
        foto: '/tmp/foto.jpg',
        dimensoesFoto: { largura: 500, altura: 500 },
        layout: LAYOUT_VALIDO,
        textos: { titulo: 'X', principal: 'LINK NA BIO' },
        saida: '/tmp/story.jpg',
      }),
    /preço/,
  );
});

