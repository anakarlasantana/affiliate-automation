/**
 * imagem.test.js — testes do pipeline de imagem.
 *
 * O teste central cobre o BUG que motivou tudo: mensagem com foto no WhatsApp
 * traz em `msg.body` apenas o `jpegThumbnail` (72x72, 1,5-2,5 KB). O piso de
 * BYTES nao separa isso de uma foto real (um og:image legitimo tem 15 KB) —
 * quem separa e a DIMENSAO. As fixtures sao imagens REAIS extraidas da fila
 * (ver test/fixtures/ORIGEM.md), nao buffers inventados.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_LADO_FOTO,
  baixarMidiaComRetry,
  classificarMidia,
  dimensoesImagem,
  validarImagemBase64,
} from '../src/imagem.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (nome) => fs.readFileSync(path.join(FIXTURES, nome));
const comoDataUrl = (buf, mime = 'image/jpeg') =>
  `data:${mime};base64,${buf.toString('base64')}`;

/* ---------- geradores sinteticos (so cabecalho: bastam p/ dimensoes) ---------- */

const jpegSintetico = (largura, altura, marcadorSof = 0xc0) => {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write('JFIF\0', 4, 'latin1');
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xff00 | marcadorSof, 0);
  sof.writeUInt16BE(17, 2); // 8 (precisao) + 2 + 2 + 1 + 3*3 = 15 de payload
  sof[4] = 8;
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
};

const pngSintetico = (largura, altura) => {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(largura, 16);
  buf.writeUInt32BE(altura, 20);
  buf[24] = 8;
  buf[25] = 2;
  return buf;
};

const gifSintetico = (largura, altura) => {
  const buf = Buffer.alloc(20);
  buf.write('GIF89a', 0, 'latin1');
  buf.writeUInt16LE(largura, 6);
  buf.writeUInt16LE(altura, 8);
  return buf;
};

const webpVp8x = (largura, altura) => {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'latin1');
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8X', 12, 'latin1');
  const w = largura - 1;
  const h = altura - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
};

const webpVp8l = (largura, altura) => {
  const buf = Buffer.alloc(25);
  buf.write('RIFF', 0, 'latin1');
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8L', 12, 'latin1');
  buf[20] = 0x2f;
  const bits = (largura - 1) | ((altura - 1) << 14);
  buf.writeUInt32LE(bits >>> 0, 21);
  return buf;
};

/* ================== o bug das miniaturas 72x72 ================== */

test('miniatura REAL do WhatsApp (msg.body, 72x72) e classificada como miniatura', () => {
  for (const arquivo of ['miniatura-whatsapp-1-72x72.jpg', 'miniatura-whatsapp-2-72x72.jpg']) {
    const bytes = ler(arquivo);
    const info = dimensoesImagem(bytes);
    assert.deepEqual(
      { largura: info.largura, altura: info.altura, formato: info.formato },
      { largura: 72, altura: 72, formato: 'jpeg' },
      `${arquivo} deveria medir 72x72`,
    );
    assert.equal(classificarMidia(bytes).miniatura, true, `${arquivo} precisa ser rejeitada`);
    assert.ok(bytes.length < 2500, `${arquivo} tem ${bytes.length} B (miniatura real)`);
  }
});

test('o piso de BYTES aprova a miniatura — prova de que bytes nao resolvem o bug', () => {
  const miniatura = comoDataUrl(ler('miniatura-whatsapp-1-72x72.jpg'));
  // validarImagemBase64 (piso de 1500 B) diz "valida": foi EXATAMENTE por isso
  // que o body da mensagem passava e o grupo recebia quadrado borrado.
  assert.equal(validarImagemBase64(miniatura).valido, true);
  // classificarMidia (dimensao) diz "miniatura": e este o gate que corrige.
  assert.equal(classificarMidia(miniatura).miniatura, true);
});

test('og:image REAL de 15 KB NAO e miniatura (byte maior, foto legitima)', () => {
  const bytes = ler('foto-og-image-322x500.jpg');
  assert.ok(bytes.length > 14000);
  const info = dimensoesImagem(bytes);
  assert.deepEqual({ largura: info.largura, altura: info.altura }, { largura: 322, altura: 500 });
  assert.equal(classificarMidia(bytes).miniatura, false);
  assert.ok(Math.min(info.largura, info.altura) > MIN_LADO_FOTO);
});

test('WebP real (og:image) e lido e aceito', () => {
  const bytes = ler('foto-og-image-500x459.webp');
  const info = dimensoesImagem(bytes);
  assert.equal(info.formato, 'webp');
  assert.deepEqual({ largura: info.largura, altura: info.altura }, { largura: 500, altura: 459 });
  assert.equal(classificarMidia(bytes).miniatura, false);
});

test('PNG placeholder 800x800 e aceito', () => {
  const bytes = ler('placeholder-800x800.png');
  const info = dimensoesImagem(bytes);
  assert.deepEqual(
    { largura: info.largura, altura: info.altura, formato: info.formato },
    { largura: 800, altura: 800, formato: 'png' },
  );
  assert.equal(classificarMidia(bytes).miniatura, false);
});

test('data-URL e base64 cru dao o mesmo resultado', () => {
  const bytes = ler('miniatura-whatsapp-1-72x72.jpg');
  const cru = bytes.toString('base64');
  assert.deepEqual(dimensoesImagem(cru), dimensoesImagem(comoDataUrl(bytes)));
  assert.equal(classificarMidia(cru).miniatura, true);
});

/* ================== formatos e limites ================== */

test('formatos sinteticos: dimensoes corretas e veredito pelo lado maior', () => {
  assert.equal(classificarMidia(pngSintetico(10, 10)).miniatura, true);
  assert.equal(classificarMidia(pngSintetico(300, 300)).miniatura, false);
  assert.equal(classificarMidia(gifSintetico(500, 300)).miniatura, false);
  // Banner largo e baixo (499x120) NAO e miniatura: a regra olha o MAIOR lado,
  // senao um og:image real de 500x271 (existe na fila!) seria rejeitado.
  assert.equal(classificarMidia(gifSintetico(499, 120)).miniatura, false);
  assert.equal(classificarMidia(gifSintetico(120, 90)).miniatura, true);
  assert.equal(classificarMidia(webpVp8x(2048, 1024)).formato, 'webp');
  assert.equal(classificarMidia(webpVp8x(2048, 1024)).miniatura, false);
  assert.deepEqual(dimensoesImagem(webpVp8l(64, 48)), {
    largura: 64,
    altura: 48,
    formato: 'webp',
  });
  // JPEG progressivo (SOF2) tambem carrega dimensao.
  assert.deepEqual(dimensoesImagem(jpegSintetico(1024, 768, 0xc2)), {
    largura: 1024,
    altura: 768,
    formato: 'jpeg',
  });
  // Casos-limite em volta do MIN_LADO_FOTO (300): 100x150 e miniatura,
  // 300x500 passa mesmo com um lado exatamente no limite.
  assert.equal(classificarMidia(jpegSintetico(100, 150)).miniatura, true);
  assert.equal(classificarMidia(jpegSintetico(300, 500)).miniatura, false);
});

test('entrada ilegivel nao vira miniatura nem quebra', () => {
  for (const entrada of ['', null, undefined, 'nao sou imagem', Buffer.alloc(0), [1, 2, 3]]) {
    assert.equal(dimensoesImagem(entrada), null);
    assert.equal(classificarMidia(entrada).miniatura, false);
  }
});

test('dimensoesImagem aceita Buffer e data-URL sem o ";base64"', () => {
  const bytes = ler('miniatura-whatsapp-2-72x72.jpg');
  assert.deepEqual(
    dimensoesImagem(`data:image/jpeg,${bytes.toString('base64')}`),
    dimensoesImagem(bytes),
  );
});

test('validarImagemBase64 rejeita lixo e aceita as fixtures reais', () => {
  assert.equal(validarImagemBase64('nao é data-url').valido, false);
  // 'AAAA' (3 B) cai primeiro no piso de base64 curto; o piso de bytes
  // (MIN_BYTES_IMAGEM) e o segundo filtro, so para imagens de verdade.
  assert.equal(validarImagemBase64('data:image/jpeg;base64,AAAA').motivo, 'base64 curto demais');
  assert.equal(
    validarImagemBase64(`data:image/jpeg;base64,${Buffer.alloc(600).toString('base64')}`).motivo,
    'pequena demais (600B)',
  );
  assert.equal(validarImagemBase64(comoDataUrl(ler('foto-og-image-322x500.jpg'))).valido, true);
  assert.equal(
    validarImagemBase64(comoDataUrl(ler('foto-og-image-500x459.webp'), 'image/webp')).valido,
    true,
  );
});

/* ================== baixarMidiaComRetry ================== */

const clienteFake = (comportamento) => {
  const chamadas = [];
  return {
    chamadas,
    async downloadMedia(id) {
      chamadas.push(id);
      return comportamento(id);
    },
  };
};

test('baixarMidiaComRetry desiste na hora quando o ID e invalido', async () => {
  const cliente = clienteFake(() => 'nunca deveria ser chamado');
  const r = await baixarMidiaComRetry(cliente, {}, 'teste', { esperasMs: [1, 1, 1] });
  assert.deepEqual(r, { base64: null, tentativas: 0 });
  assert.equal(cliente.chamadas.length, 0);
});

test('baixarMidiaComRetry para de insistir em "no media found" (vai re-hidratar)', async () => {
  const cliente = clienteFake(() => {
    throw { erro: true, text: 'no media found for message id 3EB0' };
  });
  const r = await baixarMidiaComRetry(cliente, '3EB0', 'teste', { esperasMs: [1, 1, 1] });
  assert.equal(r.base64, null);
  assert.equal(r.semMidia, true);
  assert.equal(r.tentativas, 1, 'nao deve repetir: a store ainda nao tem a midia');
  assert.equal(cliente.chamadas.length, 1);
});

test('baixarMidiaComRetry devolve a midia valida na primeira tentativa', async () => {
  const foto = comoDataUrl(ler('foto-og-image-322x500.jpg'));
  const cliente = clienteFake(() => foto);
  const r = await baixarMidiaComRetry(cliente, '3EB0', 'teste', { esperasMs: [1] });
  assert.equal(r.base64, foto);
  assert.equal(r.tentativas, 1);
});

test('baixarMidiaComRetry esgota as tentativas e devolve null', async () => {
  // Comportamento do "download retornou vazio": 4 tentativas (3 esperas).
  const cliente = clienteFake(() => '');
  const r = await baixarMidiaComRetry(cliente, '3EB0', 'teste', { esperasMs: [1, 1, 1] });
  assert.equal(r.base64, null);
  assert.equal(r.tentativas, 4);
  assert.equal(cliente.chamadas.length, 4);
});

test('midia baixada que ainda for miniatura e pega pelo gate de dimensao', () => {
  // Defesa em profundidade do app.js: se o downloadMedia devolver os bytes da
  // miniatura, o classificarMidia barra antes de publicar no grupo.
  const bytes = ler('miniatura-whatsapp-1-72x72.jpg');
  assert.equal(classificarMidia(comoDataUrl(bytes)).miniatura, true);
});
