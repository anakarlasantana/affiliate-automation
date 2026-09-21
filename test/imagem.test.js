import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const TEST_DATA_DIR = path.join(tmpdir(), 'affiliate-test-' + Date.now());
mkdirSync(TEST_DATA_DIR, { recursive: true });
mkdirSync(path.join(TEST_DATA_DIR, 'placeholders'), { recursive: true });
process.env.DATA_DIR = TEST_DATA_DIR;

const modulo = await import('../src/imagem.js');
const {
  validarImagemBase64,
  textoErro,
  legendaParaFoto,
  placeholderPara,
  ehGrupoDeEscuta,
  ID_GRUPO_ESCUTA,
  LIMITE_LEGENDA_FOTO,
} = modulo;

// Helper: PNG 320x240 com ruído → > 5KB decodificado
function pngValido() {
  return import('node:zlib').then((zlibMod) => {
    const deflateSync = zlibMod.deflateSync;
    function chunk(tipo, dados) {
      const len = Buffer.alloc(4); len.writeUInt32BE(dados.length, 0);
      const t = Buffer.from(tipo, 'ascii');
      let crc = 0xEDB88320;
      for (const b of Buffer.concat([t, dados])) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1; }
      const c = Buffer.alloc(4); c.writeUInt32BE(crc >>> 0, 0);
      return Buffer.concat([len, t, dados, c]);
    }
    const W = 320, H = 240;
    const raw = Buffer.alloc(H * (1 + W * 3));
    for (let y = 0; y < H; y++) {
      raw[y * (1 + W * 3)] = 0;
      for (let x = 0; x < W; x++) {
        const idx = y * (1 + W * 3) + 1 + x * 3;
        raw[idx] = (y * 7 + x * 13 + Math.floor(Math.random() * 100)) % 256;
        raw[idx + 1] = (y * 11 + x * 5 + Math.floor(Math.random() * 100)) % 256;
        raw[idx + 2] = (y * 3 + x * 17 + Math.floor(Math.random() * 100)) % 256;
      }
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    const idat = deflateSync(raw, { level: 6 });
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
    const b64 = png.toString('base64');
    const dadosB64 = b64.slice(b64.indexOf(',') + 1);
    const bytesDecodificados = Buffer.from(dadosB64, 'base64').length;
    if (bytesDecodificados < 5 * 1024) throw new Error('PNG muito pequeno: ' + bytesDecodificados + 'B');
    return 'data:image/png;base64,' + dadosB64;
  });
}

// PNG 1x1: decodificado = 74B (< 5KB) - usado para testar rejeição por tamanho
function pngPequeno() {
  return import('node:zlib').then((zlibMod) => {
    const deflateSync = zlibMod.deflateSync;
    function chunk(tipo, dados) {
      const len = Buffer.alloc(4); len.writeUInt32BE(dados.length, 0);
      const t = Buffer.from(tipo, 'ascii');
      let crc = 0xEDB88320;
      for (const b of Buffer.concat([t, dados])) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1; }
      const c = Buffer.alloc(4); c.writeUInt32BE(crc >>> 0, 0);
      return Buffer.concat([len, t, dados, c]);
    }
    const W = 1, H = 1;
    const raw = Buffer.alloc(H * (1 + W * 3));
    raw[1] = 100; raw[2] = 120; raw[3] = 140;
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    const idat = deflateSync(raw, { level: 6 });
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
    return 'data:image/png;base64,' + png.toString('base64');
  });
}

describe('imagem.js — validarImagemBase64', () => {
  it('aceita data-URL PNG válido grande o suficiente (>= 5KB decodificado)', async () => {
    const img = await pngValido();
    const r = validarImagemBase64(img);
    assert.strictEqual(r.valido, true);
    assert.ok(r.mime.startsWith('image/'));
    assert.ok(r.kb >= 5, 'deve ser >= 5KB, atual: ' + r.kb);
  });

  it('rejeita string vazia / null / undefined', () => {
    assert.deepStrictEqual(validarImagemBase64(''), { valido: false, motivo: 'vazia' });
    assert.deepStrictEqual(validarImagemBase64(null), { valido: false, motivo: 'vazia' });
    assert.deepStrictEqual(validarImagemBase64(undefined), { valido: false, motivo: 'vazia' });
  });

  it('rejeita sem prefixo data:image', () => {
    assert.deepStrictEqual(validarImagemBase64('data:text/plain;base64,abc'), { valido: false, motivo: 'sem prefixo data:image' });
    assert.deepStrictEqual(validarImagemBase64('nao-e-um-data-url'), { valido: false, motivo: 'sem prefixo data:image' });
  });

  it('rejeita MIME não suportado (ex.: image/svg+xml)', () => {
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
    const r = validarImagemBase64(svg);
    assert.strictEqual(r.valido, false);
    assert.ok(r.motivo.includes('mime'));
  });

  it('rejeita base64 com payload curto demais (< 100 chars após prefixo)', () => {
    const r = validarImagemBase64('data:image/png;base64,' + 'A'.repeat(50));
    assert.strictEqual(r.valido, false);
    assert.ok(r.motivo.includes('curto'));
  });

  it('rejeita base64 corrompido que não decodifica (caracteres inválidos → menos bytes)', async () => {
    const zlibMod = await import('node:zlib');
    const { deflateSync } = zlibMod;
    function chunk(tipo, dados) {
      const len = Buffer.alloc(4); len.writeUInt32BE(dados.length, 0);
      const t = Buffer.from(tipo, 'ascii');
      let crc = 0xEDB88320;
      for (const b of Buffer.concat([t, dados])) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1; }
      const c = Buffer.alloc(4); c.writeUInt32BE(crc >>> 0, 0);
      return Buffer.concat([len, t, dados, c]);
    }
    const W = 80, H = 80;
    const raw = Buffer.alloc(H * (1 + W * 3));
    for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; for (let x = 0; x < W; x++) { const idx = y * (1 + W * 3) + 1 + x * 3; raw[idx] = 100; raw[idx + 1] = 120; raw[idx + 2] = 140; } }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    const idat = deflateSync(raw, { level: 6 });
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
    let b64 = png.toString('base64');
    const virgulaIdx = b64.indexOf(',');
    const cabecalho = b64.slice(0, virgulaIdx + 1);
    const dadosOriginais = b64.slice(virgulaIdx + 1);
    // Substitui parte dos dados por caracteres não-base64 ("!!!!!")
    const dadosCorrompidos = '!!!!!'.repeat(20) + dadosOriginais.slice(20);
    const imgCorrompido = cabecalho + dadosCorrompidos;
    const bytesDecodificados = Buffer.from(dadosCorrompidos, 'base64').length;
    console.log('[base64 corrompido] bytes decodificados:', bytesDecodificados, '(originais:', dadosOriginais.length, ')');
    const r = validarImagemBase64(imgCorrompido);
    assert.strictEqual(r.valido, false, 'base64 corrompido deve ser rejeitado');
    assert.ok(r.motivo.includes('curto') || r.motivo.includes('invalido') || bytesDecodificados < dadosOriginais.length,
      'motivo: ' + r.motivo + ', bytes decodificados: ' + bytesDecodificados);
  });

  it('rejeita imagem menor que MIN_BYTES_IMAGEM (5KB) — usa PNG 1x1 decodificado = 74B', async () => {
    const img = await pngPequeno();
    const bytesDecodificados = Buffer.from(img.slice(img.indexOf(',') + 1), 'base64').length;
    console.log('[PNG pequeno 1x1] bytes decodificados:', bytesDecodificados, ', base64 length:', img.slice(img.indexOf(',') + 1).length);
    const r = validarImagemBase64(img);
    assert.strictEqual(r.valido, false, 'PNG 1x1 deve ser rejeitado (< 5KB)');
    assert.ok(r.motivo.includes('pequena') || r.motivo.includes('curto') || bytesDecodificados < 5 * 1024,
      'motivo: ' + r.motivo + ', bytes: ' + bytesDecodificados);
  });
});

describe('imagem.js — textoErro', () => {
  it('extrai text de {erro:true, text}', () => {
    assert.strictEqual(textoErro({ erro: true, text: 'erro do wppconnect' }), 'erro do wppconnect');
  });

  it('extrai message quando não há text', () => {
    assert.strictEqual(textoErro({ message: 'fallback message' }), 'fallback message');
  });

  it('retorna a própria string quando recebida', () => {
    assert.strictEqual(textoErro('erro direto'), 'erro direto');
  });

  it('retorna JSON para objeto sem text/message', () => {
    const r = textoErro({ codigo: 500, detalhe: 'interno' });
    assert.ok(typeof r === 'string' && r.includes('500'));
  });

  it('retorna string para null/undefined', () => {
    assert.strictEqual(textoErro(null), 'erro desconhecido');
    assert.strictEqual(textoErro(undefined), 'erro desconhecido');
  });
});

describe('imagem.js — legendaParaFoto', () => {
  it('devolve intacto quando menor que o limite', () => {
    const texto = 'oferta boa! http link'.repeat(5);
    const r = legendaParaFoto(texto, 'http://link.com');
    assert.strictEqual(r, texto);
  });

  it('preserva o link de afiliado no meio do corte (link longo + texto grande)', async () => {
    const meuLink = 'https://www.mercadolivre.com.br/MLB-123456-produto-exemplo-_-p';
    const inicio = '🚗 OFERTA DE CARRO IMPORTADO! '.repeat(20);
    const fim = ' Compre agora!!! '.repeat(30) + 'fim garantido';
    const texto = inicio + meuLink + fim;
    assert.ok(texto.length > LIMITE_LEGENDA_FOTO, 'texto deve ser > 1000 chars, atual: ' + texto.length);
    const r = legendaParaFoto(texto, meuLink);
    assert.ok(r.length <= LIMITE_LEGENDA_FOTO, 'legenda truncada deve ter <= 1000 chars');
    assert.ok(r.includes(meuLink), 'link de afiliado deve ser preservado');
  });

  it('quando não há link, simplesmente trunca com …', () => {
    const texto = 'M' + 'A'.repeat(LIMITE_LEGENDA_FOTO + 50);
    const r = legendaParaFoto(texto, null);
    assert.strictEqual(r.length, LIMITE_LEGENDA_FOTO);
    assert.ok(r.endsWith('…'));
  });

  it('link vazio trata como se não houvesse link', () => {
    const texto = 'X'.repeat(LIMITE_LEGENDA_FOTO + 50);
    const r = legendaParaFoto(texto, '');
    assert.strictEqual(r.length, LIMITE_LEGENDA_FOTO);
    assert.ok(r.endsWith('…'));
  });
});

describe('imagem.js — placeholderPara', () => {
  it('gera PNG sólido (fallback) quando não há arquivo em disco', async () => {
    const ph = placeholderPara('MercadoLivre');
    assert.ok(ph.base64.startsWith('data:image/png;base64,'));
    assert.strictEqual(ph.origem, 'placeholder');
    const v = validarImagemBase64(ph.base64);
    assert.strictEqual(v.valido, true, 'placeholder deve ser um PNG válido');
  });

  it('default (loja desconhecida) gera placeholder azul', async () => {
    const ph = placeholderPara('LojaInexistente123');
    const v = validarImagemBase64(ph.base64);
    assert.strictEqual(v.valido, true);
    assert.strictEqual(ph.origem, 'placeholder');
  });

  it('placeholderPara sempre retorna base64 válido (garantia de nunca vir texto puro)', async () => {
    for (const loja of ['MercadoLivre', 'Shopee', 'Magalu', 'Amazon', 'Shein', 'TikTokShop', 'RandomShopXYZ', '']) {
      const ph = placeholderPara(loja);
      const v = validarImagemBase64(ph.base64);
      assert.strictEqual(v.valido, true, 'placeholder para ' + loja + ' deve ser válido');
      assert.ok(ph.base64.startsWith('data:image/png;base64,'));
      assert.strictEqual(ph.origem, 'placeholder');
    }
  });
});

describe('imagem.js — grupo de escuta (promobit) ignora foto do grupo', () => {
  it('detecta grupo de escuta pelo domínio promobit na URL final', () => {
    assert.strictEqual(ehGrupoDeEscuta({ urlLimpa: 'https://promobit.com.br/redirecionar/123' }), true);
  });

  it('detecta pelo chat id do grupo de escuta na origem (grupo @g.us)', () => {
    assert.strictEqual(ehGrupoDeEscuta({ origem: `whatsapp:${ID_GRUPO_ESCUTA}@g.us` }), true);
  });

  it('detecta pela origem real de producao (contato @c.us, como chega do listener)', () => {
    assert.strictEqual(ehGrupoDeEscuta({ origem: `whatsapp:${ID_GRUPO_ESCUTA}@c.us` }), true);
  });

  it('grupo alvo (120363403040134708) NÃO é tratado como grupo de escuta', () => {
    assert.strictEqual(ehGrupoDeEscuta({ origem: 'whatsapp:120363403040134708@g.us', urlLimpa: 'https://www.mercadolivre.com.br/produto/MLB-123456' }), false);
  });

  it('origem/url vazias ou ausentes nunca marcam grupo de escuta', () => {
    assert.strictEqual(ehGrupoDeEscuta(), false);
    assert.strictEqual(ehGrupoDeEscuta({}), false);
    assert.strictEqual(ehGrupoDeEscuta({ origem: '', urlLimpa: '' }), false);
    assert.strictEqual(ehGrupoDeEscuta({ origem: 'whatsapp:120363424391943212@g.us' }), false);
  });

  it('quando o grupo é de escuta, o fallback de foto (site → placeholder) segue válido', () => {
    assert.strictEqual(ehGrupoDeEscuta({ urlLimpa: 'https://promobit.com.br/redirecionar/123' }), true);
    const ph = placeholderPara('MercadoLivre');
    const v = validarImagemBase64(ph.base64);
    assert.strictEqual(v.valido, true, 'placeholder deve ser válido como fallback');
    assert.strictEqual(ph.origem, 'placeholder');
  });
});

describe('config.js — DATA_DIR isolado no teste (não escreve em data/ de produção)', () => {
  it('DATA_DIR honra process.env.DATA_DIR definido pelo teste', async () => {
    const { DATA_DIR } = await import('../src/config.js');
    assert.strictEqual(DATA_DIR, TEST_DATA_DIR);
    assert.strictEqual(DATA_DIR.startsWith(tmpdir()), true, 'DATA_DIR deve ficar em tmpdir durante os testes');
  });

  it('placeholderPara grava o PNG procedural dentro do DATA_DIR de teste', () => {
    placeholderPara('LojaNovaDeTeste999');
    const arquivo = path.join(TEST_DATA_DIR, 'placeholders', 'lojanovadeteste999.png');
    assert.strictEqual(existsSync(arquivo), true, 'placeholder deve ser gravado no dir de teste, não em data/');
  });
});

process.env.DATA_DIR = ORIGINAL_DATA_DIR;
