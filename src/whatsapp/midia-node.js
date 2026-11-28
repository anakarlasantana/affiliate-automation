/**
 * midia-node.js — baixa a mídia do WhatsApp FORA do Chromium (FEAT-019).
 *
 * POR QUÊ existe: em 28/11 o `downloadMedia` do wppconnect falhou 91 vezes com
 * `Runtime.callFunctionOn timed out` — inclusive com a VPS ociosa (4 vCPU,
 * load 0,21). O motivo está no próprio wppconnect:
 *
 *   downloadMedia() → evaluateAndReturn(page, () => WPP.chat.downloadMedia(id))
 *
 * ou seja, o wa-js **decodifica e reencoda a imagem dentro da página**
 * (`prepRawMedia` com maxDimension 1600). Na VPS esse trabalho dentro do
 * Chromium estoura o prazo do CDP; no notebook passa.
 *
 * Aqui o trabalho pesado sai do navegador:
 *   1. a página só devolve METADADOS (directPath, mediaKey, mimetype) — leve
 *   2. Node baixa os bytes de mmg.whatsapp.net
 *   3. Node descriptografa (AES-256-CBC + HMAC-SHA256, formato do WhatsApp)
 *   → JPEG original, sem o Chromium processar imagem.
 */
import crypto from 'node:crypto';

/** Host dos arquivos de mídia do WhatsApp. */
export const HOST_MIDIA = 'https://mmg.whatsapp.net';

/**
 * Normaliza a `mediaKey` do WhatsApp (32 bytes).
 * @param {string|Buffer} chave base64 ou Buffer
 * @returns {Buffer|null}
 */
export function normalizarMediaKey(chave) {
  if (Buffer.isBuffer(chave)) return chave.length === 32 ? chave : null;
  if (typeof chave !== 'string' || !chave) return null;
  try {
    const buf = Buffer.from(chave, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Deriva as partes da chave (HKDF-SHA256) usadas pelo WhatsApp:
 * `iv` (16 B), `cipherKey` (32 B), `macKey` (32 B) e `refKey` (32 B).
 * @param {Buffer} mediaKey 32 bytes
 * @param {'image'|'video'|'audio'|'document'} tipo
 * @returns {{iv:Buffer, cipherKey:Buffer, macKey:Buffer, refKey:Buffer}|null}
 */
export function derivarChaves(mediaKey, tipo = 'image') {
  const chave = normalizarMediaKey(mediaKey);
  if (!chave) return null;

  const info = `WhatsApp ${String(tipo).toLowerCase()} Keys`;
  const expandida = Buffer.from(
    crypto.hkdfSync('sha256', chave, Buffer.alloc(0), info, 112),
  );
  if (expandida.length < 112) return null;

  return {
    iv: expandida.subarray(0, 16),
    cipherKey: expandida.subarray(16, 48),
    macKey: expandida.subarray(48, 80),
    refKey: expandida.subarray(80, 112),
  };
}

/**
 * Descriptografa o arquivo baixado.
 *
 * Formato do WhatsApp: os **10 últimos bytes** são o MAC; o restante é o
 * ciphertext AES-256-CBC. O MAC é o HMAC-SHA256 de (iv + ciphertext) com a
 * `macKey`, truncado em 10 bytes.
 *
 * @param {Buffer} buffer bytes baixados
 * @param {Buffer} mediaKey 32 bytes
 * @param {'image'|'video'|'audio'|'document'} [tipo]
 * @returns {{ok:boolean, dados:Buffer|null, motivo:string|null}}
 */
export function descriptografarMidia(buffer, mediaKey, tipo = 'image') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 11) {
    return { ok: false, dados: null, motivo: 'arquivo-vazio' };
  }
  const chaves = derivarChaves(mediaKey, tipo);
  if (!chaves) return { ok: false, dados: null, motivo: 'media-key-invalida' };

  const corpo = buffer.subarray(0, buffer.length - 10);
  const mac = buffer.subarray(buffer.length - 10);

  const esperado = crypto
    .createHmac('sha256', chaves.macKey)
    .update(chaves.iv)
    .update(corpo)
    .digest()
    .subarray(0, 10);

  if (!crypto.timingSafeEqual(mac, esperado)) {
    return { ok: false, dados: null, motivo: 'mac-invalido' };
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      chaves.cipherKey,
      chaves.iv,
    );
    const dados = Buffer.concat([decipher.update(corpo), decipher.final()]);
    return { ok: true, dados, motivo: null };
  } catch (erro) {
    return { ok: false, dados: null, motivo: `falha-decrypt: ${erro.message}` };
  }
}

/**
 * baixarMidiaForaDoNavegador — o download que NÃO passa pelo Chromium.
 *
 * Fluxo (FEAT-019):
 *   1. recebe os metadados da mensagem (`directPath` + `mediaKey`)
 *   2. baixa os bytes de `mmg.whatsapp.net` via fetch (Node, 4 vCPU livres)
 *   3. descriptografa com AES-256-CBC + HMAC (formato do WhatsApp)
 *   → data-URL do JPEG original
 *
 * POR QUÊ não usar `client.downloadMedia`: ele roda `evaluateAndReturn` e o wa-js
 * faz `prepRawMedia` **dentro da página** — é isso que estoura o
 * `Runtime.callFunctionOn` na VPS mesmo com a máquina ociosa.
 *
 * @param {object} opcoes
 * @param {{directPath?:string, mediaKey?:string, mimetype?:string}} opcoes.metadados
 * @param {typeof fetch} [opcoes.http]
 * @param {string} [opcoes.host]
 * @param {number} [opcoes.timeoutMs]
 * @returns {Promise<{base64:string|null, bytes:number, motivo:string|null}>}
 */
export async function baixarMidiaForaDoNavegador({
  metadados = {},
  http = fetch,
  host = HOST_MIDIA,
  timeoutMs = 20_000,
} = {}) {
  const { directPath, mediaKey, mimetype } = metadados;

  if (!directPath || !mediaKey) {
    return { base64: null, bytes: 0, motivo: 'metadados-incompletos' };
  }

  const url = String(directPath).startsWith('http')
    ? String(directPath)
    : `${host}${directPath}`;

  let bytes;
  try {
    const resposta = await http(url, {
      // O host de mídia não precisa de cookies: o acesso é pela URL assinada.
      headers: { 'user-agent': 'WhatsApp/2.23' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resposta?.ok) {
      return { base64: null, bytes: 0, motivo: `http-${resposta?.status ?? 'sem-resposta'}` };
    }
    bytes = Buffer.from(await resposta.arrayBuffer());
  } catch (erro) {
    const motivo = /timeout|abort/i.test(erro?.message || '')
      ? 'timeout-download'
      : `falha-rede: ${erro?.message || erro}`;
    return { base64: null, bytes: 0, motivo };
  }

  const tipo = String(mimetype || 'image/jpeg').startsWith('video')
    ? 'video'
    : 'image';
  const aberto = descriptografarMidia(bytes, mediaKey, tipo);
  if (!aberto.ok) {
    return { base64: null, bytes: bytes.length, motivo: aberto.motivo };
  }

  const mime = mimetype || 'image/jpeg';
  return {
    base64: `data:${mime};base64,${aberto.dados.toString('base64')}`,
    bytes: aberto.dados.length,
    motivo: null,
  };
}

/**
 * Extrai os metadados de mídia **dentro da página** (chamada leve).
 *
 * Só devolve strings pequenas (directPath, mediaKey, mimetype) — diferente do
 * `downloadMedia`, que devolve a imagem inteira em base64 e faz o wa-js
 * decodificar tudo no renderer.
 *
 * @param {{waPage?:{evaluate:Function}}} client
 * @param {string} msgId
 * @param {{timeoutMs?:number}} [opcoes]
 * @returns {Promise<object|null>}
 */
export async function metadadosNaPagina(client, msgId, { timeoutMs = 15_000 } = {}) {
  const page = client?.waPage;
  if (!page?.evaluate || !msgId) return null;

  try {
    const bruto = await page.evaluate(
      async (id) => {
        const msg = await window.WPP.chat.getMessageById(id);
        const midia =
          msg?.mediaData || msg?.message?.imageMessage || msg?.message?.videoMessage || {};
        if (!midia?.directPath) return null;
        const paraBase64 = (v) => {
          if (!v) return null;
          if (typeof v === 'string') return v;
          const u8 = v instanceof Uint8Array ? v : new Uint8Array(v);
          return btoa(String.fromCharCode(...u8));
        };
        return {
          directPath: midia.directPath || null,
          mediaKey: paraBase64(midia.mediaKey),
          mimetype: midia.mimetype || null,
        };
      },
      msgId,
    );
    return bruto;
  } catch {
    return null;
  } finally {
    // sem estado para limpar; o timeout é do chamador
    void timeoutMs;
  }
}
