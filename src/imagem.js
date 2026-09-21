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

/** Tamanho minimo para descartar pixel de tracking / imagem quebrada. */
const MIN_BYTES_IMAGEM = 5 * 1024;

/** Cache dos placeholders carregados (evita ler disco a cada oferta). */
const cachePlaceholder = new Map();
/** mtime do arquivo no momento do cache — hot-reload: trocou o PNG, entra sem restart. */
const cachePlaceholderMtime = new Map();

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
export async function baixarMidiaComRetry(client, msgId, rotulo = '') {
  // Fail-fast: ID inválido nunca vai funcionar com retry (comum em backlog SYNCING).
  if (msgId != null && typeof msgId === 'object' && !msgId.id && !msgId._serialized) {
    return { base64: null, tentativas: 0 };
  }
  const ESPERAS_MS = [2000, 5000];
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const base64 = await client.downloadMedia(msgId);
      if (base64) {
        const v = validarImagemBase64(String(base64));
        if (v.valido) {
          console.log(`   Foto da mensagem obtida (tentativa ${tentativa}/3, ${v.kb} KB, ${v.mime})${rotulo ? ` [${rotulo}]` : ''}`);
          return { base64: String(base64), tentativas: tentativa };
        }
        ultimoErro = new Error(`download invalido: ${v.motivo}`);
        console.warn(`   Download midia tentativa ${tentativa}/3 invalido: ${v.motivo} — de novo...`);
      } else {
        ultimoErro = new Error('download retornou vazio');
        console.warn(`   Download midia tentativa ${tentativa}/3 vazio — de novo...`);
      }
    } catch (e) {
      ultimoErro = e;
      const msg = textoErro(e);
      // Erro de entrada inválida (sem id): retry é inútil — desiste na hora.
      if (/undefined or null|messageId is undefined/i.test(msg)) {
        console.warn(`   Download midia sem ID válido (${rotulo || 's/rotulo'}) — pulando para fallback do site.`);
        return { base64: null, tentativas: tentativa };
      }
      console.warn(`   Download midia tentativa ${tentativa}/3 falhou: ${msg}`);
    }
    if (tentativa < 3) await new Promise((r) => setTimeout(r, ESPERAS_MS[tentativa - 1]));
  }
  console.warn(`   Foto da mensagem indisponivel apos 3 tentativas: ${textoErro(ultimoErro)} — fallback do site.`);
  return { base64: null, tentativas: 3 };
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
  const slugLower = chave.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'default';
  const slugOriginal = chave.replace(/[^a-zA-Z0-9]+/g, '-') || 'default';
  const arquivoLower = path.join(DATA_DIR, 'placeholders', `${slugLower}.png`);
  const arquivoOriginal = path.join(DATA_DIR, 'placeholders', `${slugOriginal}.png`);
  // Hot-reload: arte propria no disco tem prioridade e entra sem restart.
  // Tenta primeiro o slug minúsculo (normalizado), depois o nome original (maiúsculo).
  const arquivosParaVerificar = [arquivoLower, arquivoOriginal];
  for (const arquivo of arquivosParaVerificar) {
    try {
      if (fs.existsSync(arquivo)) {
        const mtime = fs.statSync(arquivo).mtimeMs;
        if (cachePlaceholder.has(chave) && cachePlaceholderMtime.get(chave) === mtime) {
          return { base64: cachePlaceholder.get(chave), origem: 'placeholder' };
        }
        const dataUrl = `data:image/png;base64,${fs.readFileSync(arquivo).toString('base64')}`;
        if (validarImagemBase64(dataUrl).valido) {
          cachePlaceholder.set(chave, dataUrl);
          cachePlaceholderMtime.set(chave, mtime);
          return { base64: dataUrl, origem: 'placeholder' };
        }
      }
    } catch { /* segue para o próximo arquivo ou geração procedural */ }
  }
  // Se não achou nenhum arquivo em disco, gera o placeholder procedural
  const arquivoSalvar = path.join(DATA_DIR, 'placeholders', `${slugLower}.png`);
  try {
    const png = gerarPngSolido(PLACEHOLDERS[chave] || '#1F6FEB');
    try {
      fs.mkdirSync(path.dirname(arquivoSalvar), { recursive: true });
      fs.writeFileSync(arquivoSalvar, png);
    } catch { /* cache em memoria basta */ }
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    cachePlaceholder.set(chave, dataUrl);
    cachePlaceholderMtime.set(chave, fs.existsSync(arquivoSalvar) ? fs.statSync(arquivoSalvar).mtimeMs : 0);
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
 * Re-hidrata uma mensagem do WhatsApp pelo ID: busca o objeto atualizado
 * (que no backlog SYNCING chega sem mediaKey) e tenta o download.
 * @returns {Promise<{ base64: string|null, origem: string|null }>}
 */
export async function reidratarMidia(client, msgId) {
  if (!msgId) return { base64: null, origem: null };
  // 1) Tenta recarregar o objeto da mensagem (2a leitura costuma vir completa)
  let msgAtual = null;
  for (const metodo of ['getMessageById']) {
    try {
      if (typeof client[metodo] === 'function') {
        msgAtual = await client[metodo](msgId);
        if (msgAtual) break;
      }
    } catch { /* tenta proximo */ }
  }
  // 2) Se o objeto tem midia agora, tenta body/preview/download
  if (msgAtual) {
    const corpo = String(msgAtual.body || '');
    if (/^data:image\//i.test(corpo)) {
      const v = validarImagemBase64(corpo);
      if (v.valido) return { base64: corpo, origem: 'mensagem-reidratada' };
    }
    if (msgAtual.mediaData?.preview) {
      try {
        const prev = String(msgAtual.mediaData.preview);
        const cand = /^data:/i.test(prev) ? prev : `data:${msgAtual.mimetype || 'image/jpeg'};base64,${prev}`;
        if (validarImagemBase64(cand).valido) return { base64: cand, origem: 'mensagem-reidratada' };
      } catch { /* segue */ }
    }
  }
  // 3) Download direto pelo ID (agora com o servidor sincronizado pode funcionar)
  const idAlvo = msgAtual?.id?._serialized || msgAtual?.id || msgId;
  const dl = await baixarMidiaComRetry(client, idAlvo, 'reidratacao');
  if (dl.base64) return { base64: dl.base64, origem: 'mensagem-reidratada' };
  return { base64: null, origem: null };
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
