/**
 * midia-node.test.js — download da mídia fora do Chromium (FEAT-019).
 *
 * A causa provada: o `downloadMedia` do wppconnect roda `evaluateAndReturn` e faz
 * o wa-js decodificar/reencodar a imagem DENTRO da página (`prepRawMedia`), o que
 * estoura `Runtime.callFunctionOn timed out` na VPS (91 vezes em 60 min) mesmo
 * com a máquina ociosa.
 *
 * Aqui se prova a criptografia que permite baixar em Node: derivar chaves,
 * validar o MAC e descriptografar — no formato exato do WhatsApp.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  baixarMidiaForaDoNavegador,
  derivarChaves,
  metadadosNaPagina,
  descriptografarMidia,
  normalizarMediaKey,
} from '../src/whatsapp/midia-node.js';

/** Monta um arquivo no formato do WhatsApp (ciphertext + mac de 10 bytes). */
function arquivoDoWhatsApp(conteudo, mediaKey, tipo = 'image') {
  const { iv, cipherKey, macKey } = derivarChaves(mediaKey, tipo);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  const corpo = Buffer.concat([cipher.update(conteudo), cipher.final()]);
  const mac = crypto
    .createHmac('sha256', macKey)
    .update(iv)
    .update(corpo)
    .digest()
    .subarray(0, 10);
  return Buffer.concat([corpo, mac]);
}

const CHAVE = crypto.randomBytes(32);

/* ============ CA-1: a chave e as derivações ============ */

test('CA-1: mediaKey válida tem 32 bytes; inválida devolve null', () => {
  assert.equal(normalizarMediaKey(CHAVE).length, 32);
  assert.equal(normalizarMediaKey(CHAVE.toString('base64')).length, 32);
  assert.equal(normalizarMediaKey('curta'), null);
  assert.equal(normalizarMediaKey(null), null);
  assert.equal(normalizarMediaKey(''), null);
});

test('CA-1: derivação HKDF produz iv 16 e chaves de 32 bytes', () => {
  const k = derivarChaves(CHAVE, 'image');
  assert.equal(k.iv.length, 16);
  assert.equal(k.cipherKey.length, 32);
  assert.equal(k.macKey.length, 32);
  assert.equal(k.refKey.length, 32);
  // determinística: mesma chave, mesmas partes
  assert.deepEqual(derivarChaves(CHAVE, 'image'), k);
  assert.equal(derivarChaves(null, 'image'), null);
});

test('CA-1: tipos diferentes derivam chaves diferentes', () => {
  const img = derivarChaves(CHAVE, 'image');
  const vid = derivarChaves(CHAVE, 'video');
  assert.notDeepEqual(img.cipherKey, vid.cipherKey);
});

/* ============ CA-2: descriptografia ============ */

test('CA-2: arquivo íntegro é descriptografado', () => {
  const original = Buffer.from('JPEG-FALSO-'.repeat(50));
  const arquivo = arquivoDoWhatsApp(original, CHAVE);

  const r = descriptografarMidia(arquivo, CHAVE);
  assert.equal(r.ok, true);
  assert.equal(r.motivo, null);
  assert.deepEqual(r.dados, original);
});

test('CA-2: MAC adulterado é recusado (não entrega lixo)', () => {
  const original = Buffer.from('conteudo');
  const arquivo = arquivoDoWhatsApp(original, CHAVE);
  const adulterado = Buffer.from(arquivo);
  adulterado[adulterado.length - 1] ^= 0xff;

  const r = descriptografarMidia(adulterado, CHAVE);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'mac-invalido');
  assert.equal(r.dados, null);
});

test('CA-2: chave errada não descriptografa', () => {
  const arquivo = arquivoDoWhatsApp(Buffer.from('segredo'), CHAVE);
  const r = descriptografarMidia(arquivo, crypto.randomBytes(32));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'mac-invalido');
});

test('CA-2: entradas inválidas não lançam', () => {
  assert.equal(descriptografarMidia(null, CHAVE).motivo, 'arquivo-vazio');
  assert.equal(descriptografarMidia(Buffer.alloc(5), CHAVE).motivo, 'arquivo-vazio');
  assert.equal(
    descriptografarMidia(Buffer.alloc(50), 'chave-ruim').motivo,
    'media-key-invalida',
  );
});

/* ============ CA-3: download em Node ============ */

test('CA-3: baixa e descriptografa sem tocar no Chromium', async () => {
  const original = Buffer.from('JPEG-DE-VERDADE'.repeat(30));
  const arquivo = arquivoDoWhatsApp(original, CHAVE);

  const http = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => arquivo.buffer.slice(arquivo.byteOffset, arquivo.byteOffset + arquivo.byteLength),
  });

  const r = await baixarMidiaForaDoNavegador({
    metadados: { directPath: '/v/abc.enc', mediaKey: CHAVE.toString('base64'), mimetype: 'image/jpeg' },
    http,
  });

  assert.equal(r.motivo, null);
  assert.ok(r.base64.startsWith('data:image/jpeg;base64,'));
  assert.equal(Buffer.from(r.base64.split(',')[1], 'base64').toString(), original.toString());
});

test('CA-3: metadados incompletos nem tentam baixar', async () => {
  let chamou = false;
  const r = await baixarMidiaForaDoNavegador({
    metadados: { directPath: null },
    http: async () => { chamou = true; return { ok: true }; },
  });
  assert.equal(r.motivo, 'metadados-incompletos');
  assert.equal(chamou, false);
});

test('CA-3: HTTP ruim reporta o status', async () => {
  const r = await baixarMidiaForaDoNavegador({
    metadados: { directPath: '/v/x.enc', mediaKey: CHAVE.toString('base64') },
    http: async () => ({ ok: false, status: 403 }),
  });
  assert.equal(r.motivo, 'http-403');
});

test('CA-3: falha de rede não lança', async () => {
  const r = await baixarMidiaForaDoNavegador({
    metadados: { directPath: '/v/x.enc', mediaKey: CHAVE.toString('base64') },
    http: async () => { throw new Error('ECONNRESET'); },
  });
  assert.match(r.motivo, /falha-rede/);
});

/* ============ CA-4: extração dos metadados na página (fake) ============ */

test('CA-4: metadadosNaPagina extrai directPath e mediaKey sem baixar a imagem', async () => {
  const chaveB64 = CHAVE.toString('base64');
  const chamadas = [];

  const client = {
    waPage: {
      evaluate: async (fn, id) => {
        chamadas.push(id);
        // simula o retorno do evaluate: só strings pequenas
        return { directPath: '/v/t62/abc.enc', mediaKey: chaveB64, mimetype: 'image/jpeg' };
      },
    },
  };

  const meta = await metadadosNaPagina(client, 'msg-123');
  assert.equal(meta.directPath, '/v/t62/abc.enc');
  assert.equal(meta.mediaKey, chaveB64);
  assert.deepEqual(chamadas, ['msg-123'], 'uma única chamada, sem trazer bytes de imagem');
});

test('CA-4: sem waPage ou sem id devolve null (não lança)', async () => {
  assert.equal(await metadadosNaPagina({}, 'x'), null);
  assert.equal(await metadadosNaPagina({ waPage: { evaluate: async () => ({}) } }, ''), null);
});

test('CA-4: erro no evaluate é engolido (fallback segue)', async () => {
  const client = {
    waPage: {
      evaluate: async () => {
        throw new Error("Attempted to use detached Frame 'X'");
      },
    },
  };
  assert.equal(await metadadosNaPagina(client, 'msg-1'), null);
});
