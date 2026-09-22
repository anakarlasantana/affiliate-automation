/**
 * imagem.js — Pipeline de imagem da oferta (cascata sem descarte).
 *
 * Politica: TODA oferta sai com foto, nenhuma e descartada por falta de imagem.
 * Cascata: 1. foto da mensagem | 2. foto do site | 3. placeholder da loja.
 * Envio SEMPRE via sendImageFromBase64(foto, legenda) — nunca sendText puro.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR } from './config.js';

/** Limite do WhatsApp para legenda de foto (~1024 chars). */
export const LIMITE_LEGENDA_FOTO = 1000;

/** Mimes aceitos pelo wppconnect (sender.layer.js allowlist). */
const MIME_ACEITO = /image\/(jpeg|jpg|png|webp|gif)/i;

/**
 * Piso de bytes APENAS para descartar pixel de tracking / imagem corrompida.
 * NAO serve para separar miniatura de foto real: o `jpegThumbnail` que o
 * WhatsApp coloca em `msg.body` tem 1,5-2,5 KB e um og:image legitimo pode ter
 * 15 KB — qualquer piso que barre um barra o outro. Quem separa e a dimensao
 * (MIN_LADO_FOTO / classificarMidia).
 */
const MIN_BYTES_IMAGEM = 1500;

/**
 * Lado minimo (px) para tratar a imagem como "foto de verdade".
 *
 * POR QUE (bug real): em mensagem com foto, `msg.body` do wppconnect carrega o
 * `jpegThumbnail` (72x72, ~1,5-2,5 KB) — nao a foto. Como a cascata antiga
 * aceitava `msg.body` sem validar dimensao, o downloadMedia (que traria a foto
 * em resolucao cheia) nunca era tentado e o grupo recebia quadrado borrado.
 */
export const MIN_LADO_FOTO = 300;

/** Cache dos placeholders carregados (evita ler disco a cada oferta). */
const cachePlaceholder = new Map();

/** Aceita data-URL, base64 cru ou Buffer. */
function paraBuffer(entrada) {
  if (Buffer.isBuffer(entrada)) return entrada;
  if (typeof entrada !== 'string' || !entrada) return null;
  const base64 = entrada.startsWith('data:') ? entrada.slice(entrada.indexOf(',') + 1) : entrada;
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

/** Dimensoes de JPEG: varre os segmentos ate o SOF (C0-CF, exceto C4/C8/CC). */
function dimensoesJpeg(buf) {
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marcador = buf[off + 1];
    if (marcador === 0xff) {
      off++;
      continue;
    }
    // Marcadores sem payload (TEM=01 e RST/SOI/EOI=D0-D9).
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) {
      off += 2;
      continue;
    }
    const tam = buf.readUInt16BE(off + 2);
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return {
        largura: buf.readUInt16BE(off + 7),
        altura: buf.readUInt16BE(off + 5),
        formato: 'jpeg',
      };
    }
    if (tam < 2) return null;
    off += 2 + tam;
  }
  return null;
}

/** Dimensoes de WebP (VP8 com perda, VP8L sem perda e VP8X estendido). */
function dimensoesWebp(buf) {
  const tipo = buf.subarray(12, 16).toString('latin1');
  if (tipo === 'VP8 ' && buf.length >= 30) {
    return {
      largura: buf.readUInt16LE(26) & 0x3fff,
      altura: buf.readUInt16LE(28) & 0x3fff,
      formato: 'webp',
    };
  }
  if (tipo === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return {
      largura: (bits & 0x3fff) + 1,
      altura: ((bits >> 14) & 0x3fff) + 1,
      formato: 'webp',
    };
  }
  if (tipo === 'VP8X' && buf.length >= 30) {
    return {
      largura: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
      altura: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
      formato: 'webp',
    };
  }
  return null;
}

/**
 * Dimensoes reais lidas do CABECALHO dos bytes (JPEG/PNG/GIF/WebP).
 * Aceita data-URL, base64 cru ou Buffer. Retorna { largura, altura, formato }
 * ou null quando o formato nao e reconhecido (nunca inventa dimensao).
 */
export function dimensoesImagem(entrada) {
  const buf = paraBuffer(entrada);
  if (!buf || buf.length < 16) return null;
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) return dimensoesJpeg(buf);
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20), formato: 'png' };
    }
    if (buf.subarray(0, 3).toString('latin1') === 'GIF') {
      return { largura: buf.readUInt16LE(6), altura: buf.readUInt16LE(8), formato: 'gif' };
    }
    if (
      buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buf.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
      return dimensoesWebp(buf);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Classifica a imagem contra MIN_LADO_FOTO — e isto que separa a miniatura do
 * WhatsApp (72x72) da foto real, independente do tamanho em bytes.
 * Formato ilegivel => miniatura:false (nunca descarta o que nao consegue medir;
 * a decisao fica com o resto da cascata).
 */
export function classificarMidia(entrada) {
  const dim = dimensoesImagem(entrada);
  if (!dim || !dim.largura || !dim.altura) {
    return { miniatura: false, largura: 0, altura: 0, formato: 'desconhecido', motivo: 'dimensao ilegivel' };
  }
  const maiorLado = Math.max(dim.largura, dim.altura);
  return {
    miniatura: maiorLado < MIN_LADO_FOTO,
    largura: dim.largura,
    altura: dim.altura,
    formato: dim.formato,
    motivo: `${dim.largura}x${dim.altura}`,
  };
}

/**
 * Extrai mensagem legivel de qualquer formato de erro do wppconnect
 * (o wppconnect lanca {erro:true, text} — objeto sem .message — por isso
 * o log antigo imprimia "falhou (undefined)").
 */
export function textoErro(erro) {
  if (!erro) return 'erro desconhecido';
  if (typeof erro === 'string') return erro;
  if (erro.text || erro.message) return erro.text || erro.message;
  try { return JSON.stringify(erro); } catch { return String(erro); }
}

/**
 * Valida um data-URL de imagem: prefixo, mime aceito e tamanho minimo.
 */
export function validarImagemBase64(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return { valido: false, motivo: 'vazia' };
  const m = /^data:(image\/[a-z0-9+.-]+)(;base64)?,/i.exec(dataUrl);
  if (!m) return { valido: false, motivo: 'sem prefixo data:image' };
  if (!MIME_ACEITO.test(m[1])) return { valido: false, motivo: `mime rejeitado: ${m[1]}` };
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!base64 || base64.length < 100) return { valido: false, motivo: 'base64 curto demais' };
  let bytes = 0;
  try { bytes = Buffer.from(base64, 'base64').length; }
  catch { return { valido: false, motivo: 'base64 invalido' }; }
  if (bytes < MIN_BYTES_IMAGEM) return { valido: false, motivo: `pequena demais (${bytes}B)` };
  return { valido: true, mime: m[1], kb: Math.round(bytes / 1024) };
}

/**
 * Baixa midia do WhatsApp com retry (o erro "callFunctionOn timed out" e
 * transitorio sob carga do Chromium — 2a/3a tentativa costuma funcionar).
 */
export async function baixarMidiaComRetry(
  client,
  msgId,
  rotulo = '',
  // Esperas progressivas: o "callFunctionOn timed out" acontece sob carga do
  // Chromium e costuma passar depois que a sincronizacao inicial termina.
  // Injetaveis para o teste nao esperar 22s.
  { esperasMs = [2000, 5000, 15000] } = {}
) {
  // Fail-fast: ID inválido nunca vai funcionar com retry (comum em backlog SYNCING).
  if (msgId != null && typeof msgId === 'object' && !msgId.id && !msgId._serialized) {
    return { base64: null, tentativas: 0 };
  }
  const ESPERAS_MS = esperasMs;
  const MAX_TENTATIVAS = ESPERAS_MS.length + 1;
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const base64 = await client.downloadMedia(msgId);
      if (base64) {
        const v = validarImagemBase64(String(base64));
        if (v.valido) {
          console.log(`   Foto da mensagem obtida (tentativa ${tentativa}/${MAX_TENTATIVAS}, ${v.kb} KB, ${v.mime})${rotulo ? ` [${rotulo}]` : ''}`);
          return { base64: String(base64), tentativas: tentativa };
        }
        ultimoErro = new Error(`download invalido: ${v.motivo}`);
        console.warn(`   Download midia tentativa ${tentativa}/${MAX_TENTATIVAS} invalido: ${v.motivo} — de novo...`);
      } else {
        ultimoErro = new Error('download retornou vazio');
        console.warn(`   Download midia tentativa ${tentativa}/${MAX_TENTATIVAS} vazio — de novo...`);
      }
    } catch (e) {
      ultimoErro = e;
      const msg = textoErro(e);
      // Erro de entrada inválida (sem id): retry é inútil — desiste na hora.
      if (/undefined or null|messageId is undefined/i.test(msg)) {
        console.warn(`   Download midia sem ID válido (${rotulo || 's/rotulo'}) — pulando para fallback do site.`);
        return { base64: null, tentativas: tentativa };
      }
      // A midia nao esta na store (backlog/SYNCING): insistir aqui nao resolve,
      // quem resolve e re-hidratar a mensagem (getMessageById) no chamador.
      if (/no media found/i.test(msg)) {
        console.warn(`   Midia ainda nao disponivel na store (${rotulo || 's/rotulo'}) — tentando re-hidratar.`);
        return { base64: null, tentativas: tentativa, semMidia: true };
      }
      console.warn(`   Download midia tentativa ${tentativa}/${MAX_TENTATIVAS} falhou: ${msg}`);
    }
    if (tentativa < MAX_TENTATIVAS) await new Promise((r) => setTimeout(r, ESPERAS_MS[tentativa - 1]));
  }
  console.warn(`   Foto da mensagem indisponivel apos ${MAX_TENTATIVAS} tentativas: ${textoErro(ultimoErro)} — fallback do site.`);
  return { base64: null, tentativas: MAX_TENTATIVAS };
}
/**
 * Placeholder por loja (ultimo nivel da cascata — nunca descarta oferta).
 * PNG 800x800 de cor da loja gerado sem dependencias nativas (zlib puro).
 * Se existir arte propria em data/placeholders/<loja>.png ela tem prioridade.
 */
const PLACEHOLDERS = {
  MercadoLivre: '#FFE600',
  Shopee: '#EE4D2D',
  Magalu: '#0086FF',
  Amazon: '#FF9900',
  Shein: '#000000',
  TikTokShop: '#111111',
};

export function placeholderPara(loja) {
  const chave = String(loja || 'default');
  if (cachePlaceholder.has(chave)) return { base64: cachePlaceholder.get(chave), origem: 'placeholder' };
  const slug = chave.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'default';
  const arquivo = path.join(DATA_DIR, 'placeholders', `${slug}.png`);
  try {
    if (fs.existsSync(arquivo)) {
      const dataUrl = `data:image/png;base64,${fs.readFileSync(arquivo).toString('base64')}`;
      if (validarImagemBase64(dataUrl).valido) {
        cachePlaceholder.set(chave, dataUrl);
        return { base64: dataUrl, origem: 'placeholder' };
      }
    }
    const png = gerarPngSolido(PLACEHOLDERS[chave] || '#1F6FEB');
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      fs.writeFileSync(arquivo, png);
    } catch { /* cache em memoria basta */ }
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    cachePlaceholder.set(chave, dataUrl);
    return { base64: dataUrl, origem: 'placeholder' };
  } catch (e) {
    console.warn(`   Falha ao gerar placeholder (${textoErro(e)}) — emergencia.`);
    const dataUrl = `data:image/png;base64,${gerarPngSolido('#1F6FEB').toString('base64')}`;
    cachePlaceholder.set(chave, dataUrl);
    return { base64: dataUrl, origem: 'placeholder' };
  }
}

function hexParaRgb(hex) {
  const h = String(hex || '#1F6FEB').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function crc32(buf) {
  let tab = crc32.tab;
  if (!tab) {
    tab = crc32.tab = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tab[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ tab[(crc ^ buf[i]) & 255];
  return (crc ^ -1) >>> 0;
}

function chunkPng(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length, 0);
  const tipoBuf = Buffer.from(tipo, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tipoBuf, dados])), 0);
  return Buffer.concat([len, tipoBuf, dados, crc]);
}

/** PNG 800x800 de cor solida com textura diagonal (sem libs nativas). */
function gerarPngSolido(hex) {
  const W = 800, H = 800;
  const [r, g, b] = hexParaRgb(hex);
  const raw = Buffer.alloc(H * (1 + W * 3));
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const faixa = ((x + y) % 64) < 6;
      const borda = x < 12 || y < 12 || x >= W - 12 || y >= H - 12;
      const f = faixa ? 24 : 0;
      const d = borda ? 60 : 0;
      raw[p++] = Math.max(0, Math.min(255, r + f - d));
      raw[p++] = Math.max(0, Math.min(255, g + f - d));
      raw[p++] = Math.max(0, Math.min(255, b + f - d));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunkPng('IHDR', ihdr),
    chunkPng('IDAT', idat),
    chunkPng('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Trunca a legenda para o limite do WhatsApp em caption de imagem,
 * preservando o link de afiliado (corta o meio, mantem inicio + link + fim).
 */
export function legendaParaFoto(mensagemFinal, meuLink) {
  const texto = String(mensagemFinal || '');
  if (texto.length <= LIMITE_LEGENDA_FOTO) return texto;
  if (meuLink && texto.includes(meuLink)) {
    const sobra = LIMITE_LEGENDA_FOTO - meuLink.length - 20;
    const ini = Math.ceil(sobra * 0.6);
    const fim = Math.floor(sobra * 0.4);
    return texto.slice(0, ini) + '\n…\n' + meuLink + '\n' + texto.slice(-fim);
  }
  return texto.slice(0, LIMITE_LEGENDA_FOTO - 1) + '…';
}
