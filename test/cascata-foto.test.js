/**
 * cascata-foto.test.js — qual foto vai na oferta (FEAT-017 · CA-1..CA-8).
 *
 * O caso real: produção baixou foto 1218×1218 da mensagem e enviou placeholder,
 * porque o site do ML devolveu captcha e a regra `FONTES_FOTO_SOMENTE_SITE`
 * descartava a foto do grupo sem plano B.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  caminhoDoPlaceholder,
  classificarPagina,
  linhaDaFoto,
  resolverFotoDaOferta,
} from '../src/midia/cascata-foto.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FOTO = `data:image/jpeg;base64,${'A'.repeat(800)}`;
const dim = () => ({ largura: 1218, altura: 1218 });
const tam = () => ({ kb: 85 });

/* ================= CA-1: foto da mensagem é preservada ================= */

test('CA-1: sem preferência pelo site, a foto da mensagem é usada direto', async () => {
  const r = await resolverFotoDaOferta({
    fotoMensagem: FOTO,
    preferirSite: false,
    buscarNoSite: async () => {
      throw new Error('não deveria consultar o site');
    },
    dimensoes: dim,
  });

  assert.equal(r.base64, FOTO);
  assert.equal(r.origem, 'mensagem:download');
  assert.equal(r.motivo, null);
});

/* ============ CA-4: plano B — a regra pretere, mas não descarta ============ */

test('CA-4: site falhou e a regra pedia o site → usa a foto da mensagem', async () => {
  const r = await resolverFotoDaOferta({
    fotoMensagem: FOTO,
    preferirSite: true,
    buscarNoSite: async () => null,
    buscarNaApi: async () => null,
    placeholder: { arquivo: null, motivo: 'sem-placeholder' },
    dimensoes: dim,
  });

  assert.equal(r.base64, FOTO, 'a foto já baixada não pode virar placeholder');
  assert.equal(r.origem, 'mensagem:download');
  assert.deepEqual(
    r.tentativas.map((t) => t.fonte),
    ['site', 'api', 'mensagem'],
    'o site vem primeiro, a mensagem é o plano B',
  );
});

test('CA-4: site entregou → vence a foto da mensagem', async () => {
  const doSite = `data:image/jpeg;base64,${'B'.repeat(600)}`;
  const r = await resolverFotoDaOferta({
    fotoMensagem: FOTO,
    preferirSite: true,
    buscarNoSite: async () => ({ base64: doSite, origem: 'site:og-image' }),
    dimensoes: dim,
  });
  assert.equal(r.base64, doSite);
  assert.equal(r.origem, 'site:og-image');
});

/* ================= CA-3: falha de fonte é registrada ================= */

test('CA-3: erro numa fonte não interrompe a cascata e fica registrado', async () => {
  const avisos = [];
  const r = await resolverFotoDaOferta({
    fotoMensagem: null,
    preferirSite: true,
    buscarNoSite: async () => {
      throw new Error('captcha/timeout');
    },
    buscarNaApi: async () => ({ base64: FOTO, origem: 'loja:api-imagem' }),
    dimensoes: dim,
    avisar: (m) => avisos.push(m),
  });

  assert.equal(r.origem, 'loja:api-imagem');
  assert.ok(r.tentativas[0].motivo.includes('captcha'), 'motivo da falha registrado');
  assert.ok(avisos.some((a) => a.includes('site falhou')));
});

/* ================= CA-5: captcha é "sem foto" ================= */

test('CA-5: página de captcha do ML é classificada como captcha', () => {
  const captcha =
    '<html><head><title>Mercado Libre</title></head><body>not a robot</body></html>';
  assert.equal(classificarPagina(captcha), 'captcha');
});

test('CA-5: página com og:image é produto; vazia é vazia', () => {
  assert.equal(
    classificarPagina('<meta property="og:image" content="https://x/a.jpg">'),
    'produto',
  );
  assert.equal(classificarPagina(''), 'vazia');
  assert.equal(classificarPagina('<html><body>nada</body></html>'), 'vazia');
});

/* ================= CA-6/CA-7: placeholder da aplicação ================= */

test('CA-6: nenhuma fonte → placeholder da aplicação, oferta mantida', async () => {
  const r = await resolverFotoDaOferta({
    fotoMensagem: null,
    buscarNoSite: async () => null,
    buscarNaApi: async () => null,
    placeholder: {
      arquivo: path.join(RAIZ, 'assets', 'placeholder-confira-produto.png'),
      motivo: 'padrao',
    },
    dimensoes: () => ({ largura: 1080, altura: 1080 }),
  });

  assert.equal(r.origem, 'placeholder');
  assert.ok(r.base64?.startsWith('data:image/png;base64,'), 'placeholder é imagem real');
});

test('CA-7: caminho configurado inválido cai no placeholder do projeto', () => {
  const r = caminhoDoPlaceholder({
    raiz: RAIZ,
    caminhoConfigurado: '/home/sn-387116/Documents/affiliate-automation/assets/x.png',
    existe: (p) => fs.existsSync(p),
  });

  assert.ok(r.arquivo?.endsWith(path.join('assets', 'placeholder-confira-produto.png')));
  assert.equal(r.motivo, 'configurado-invalido-usando-padrao');
});

test('CA-7: caminho configurado válido é respeitado', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  const arquivo = path.join(tmp, 'ph.png');
  fs.writeFileSync(arquivo, 'png');
  try {
    assert.deepEqual(
      caminhoDoPlaceholder({ raiz: RAIZ, caminhoConfigurado: arquivo }),
      { arquivo, motivo: 'configurado' },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ================= CA-8: uma linha de log por oferta ================= */

test('CA-8: a linha da foto traz dimensão, fonte e KB', () => {
  assert.equal(
    linhaDaFoto({ base64: FOTO, origem: 'mensagem:download' }, dim, tam),
    '📸 foto=1218x1218 · fonte=mensagem:download · 85KB',
  );
  assert.match(
    linhaDaFoto({ base64: null, origem: 'placeholder' }),
    /foto=ausente · fonte=placeholder/,
  );
});

/* ================= CA-2: imagem persistida no reenvio ================= */

test('CA-2: foto persistida é reusada sem passar pelo site', async () => {
  let consultouSite = false;
  const r = await resolverFotoDaOferta({
    fotoMensagem: FOTO, // veio do banco (restaurarPendentes)
    preferirSite: false,
    buscarNoSite: async () => {
      consultouSite = true;
      return null;
    },
    dimensoes: dim,
  });

  assert.equal(r.base64, FOTO);
  assert.equal(consultouSite, false, 'não pode rebaixar a foto já resolvida');
});
