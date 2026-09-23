/**
 * config.js
 * Centraliza e valida todas as variáveis de ambiente do projeto.
 * Qualquer novo afiliado/genérico deve ser lido aqui.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ================= Caminhos absolutos ================= */
/**
 * Derivados do proprio arquivo: o app se comporta igual iniciado de qualquer
 * diretorio de trabalho (nohup, pm2, systemd, cron). Vale inclusive para o
 * perfil do Chrome — que antes era criado relativo ao cwd e, se o app subisse
 * de outro lugar, nascia vazio (pedindo QR de novo).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const TOKENS_DIR = path.join(ROOT_DIR, 'tokens');
/**
 * Foto fixa enviada quando a oferta cai no nivel "placeholder" da cascata
 * (sem foto na mensagem e sem og:image no site). Versionada em
 * assets/placeholder-confira-produto.png; PLACEHOLDER_IMAGEM permite
 * apontar para outra arte sem mexer no codigo.
 */
export const PLACEHOLDER_PATH =
  (process.env.PLACEHOLDER_IMAGEM || '').trim() ||
  path.join(ROOT_DIR, 'assets', 'placeholder-confira-produto.png');
for (const dir of [DATA_DIR, TOKENS_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Sem permissao: o doctor reporta isso de forma explicita.
  }
}

/* ================= Fuso de operacao ================= */
/**
 * O anti-ban decide "pico" e "madrugada" pela HORA DO DIA e o limite diario
 * pela VIRADA DO DIA. Num servidor em UTC (padrao em VPS) isso dispararia os
 * envios na madrugada errada — por isso o fuso e explicito e independente do
 * relogio do host.
 */
const TZ_PADRAO = 'America/Sao_Paulo';
const tzOperacao = process.env.TZ_OPERACAO || process.env.TZ || TZ_PADRAO;
process.env.TZ = tzOperacao;

/** Hora (0-23) no fuso de operacao. */
export function horaOperacional(data = new Date()) {
  const hora = new Intl.DateTimeFormat('en-US', {
    timeZone: tzOperacao,
    hour12: false,
    hour: '2-digit',
  })
    .formatToParts(data)
    .find((parte) => parte.type === 'hour')?.value;
  return Number(hora ?? 0) % 24;
}

/** Deslocamento (minutos) do fuso de operacao em relacao ao UTC. */
function offsetOperacional(data = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tzOperacao,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value])
  );
  const comoUtc = Date.UTC(
    +partes.year,
    +partes.month - 1,
    +partes.day,
    Number(partes.hour) % 24,
    +partes.minute,
    +partes.second
  );
  return Math.round((comoUtc - data.getTime()) / 60000);
}

/**
 * Inicio do dia no fuso de operacao, no mesmo formato que o SQLite grava em
 * CURRENT_TIMESTAMP (UTC): "YYYY-MM-DD HH:MM:SS".
 */
export function inicioDoDiaOperacional(data = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tzOperacao,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value])
  );
  const meiaNoiteEmUtc =
    Date.UTC(+partes.year, +partes.month - 1, +partes.day, 0, 0, 0) -
    offsetOperacional(data) * 60000;
  return new Date(meiaNoiteEmUtc).toISOString().slice(0, 19).replace('T', ' ');
}

function lista(envValue) {
  return (envValue || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normaliza uma entrada de origem para comparação:
 * "whatsapp:12036...@g.us" / "@promobit_oficial" → "12036...@g.us" / "promobit_oficial".
 */
export function normalizarOrigem(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .replace(/^(whatsapp|telegram):/, '')
    .replace(/^@/, '');
}

/** Converte "min,max" do .env em objeto numérico. */
function faixaSegundos(envValue, padraoMin, padraoMax) {
  const [min, max] = (envValue || '').split(',').map(Number);
  return {
    min: Number.isFinite(min) && min > 0 ? min : padraoMin,
    max: Number.isFinite(max) && max > min ? max : padraoMax,
  };
}

/** Converte "12-14,19-22" do .env em array de janelas [{inicio, fim}]. */
function janelasHorarias(envValue, padrao) {
  const fonte = envValue || padrao;
  return (fonte || '')
    .split(',')
    .map((j) => j.trim().split('-').map(Number))
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b))
    .map(([inicio, fim]) => ({ inicio, fim }));
}

function validarObrigatorias(campos) {
  const faltando = campos.filter(([, valor]) => !valor);
  if (faltando.length) {
    const nomes = faltando.map(([nome]) => nome).join(', ');
    console.warn(`⚠️  Variáveis de ambiente ausentes: ${nomes}`);
    console.warn('    Preencha o arquivo .env antes de usar essas integrações.');
  }
}

const config = {
  caminhos: {
    root: ROOT_DIR,
    data: DATA_DIR,
    tokens: TOKENS_DIR,
  },
  operacao: {
    /** Fuso usado nas janelas de envio e na virada do dia (anti-ban) */
    tz: tzOperacao,
    /**
     * Origens (grupos/canais monitorados) cuja oferta tem a foto da mensagem
     * IGNORADA — a imagem vem sempre do site do produto (og:image). Caso real:
     * o grupo Promobit envia um card com a marca deles, não o produto.
     * Aceita "whatsapp:<id>@g.us", "<id>@g.us", "@canal" ou "canal".
     */
    fontesSoFotoSite: lista(process.env.FONTES_FOTO_SOMENTE_SITE),
  },
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    session: process.env.TELEGRAM_SESSION_STRING || '',
    canaisMonitorados: lista(process.env.CANAIS_TELEGRAM_MONITORADOS),
  },
  whatsapp: {
    meuGrupo: process.env.MEU_GRUPO_WHATSAPP || '',
    gruposMonitorados: lista(process.env.GRUPOS_WHATSAPP_MONITORADOS),
    /** Link de convite do SEU grupo (chat.whatsapp.com/...) — divulgado no rodape das ofertas */
    meuGrupoLink: process.env.MEU_GRUPO_LINK || '',
    /** Nome da sessao = pasta dentro de tokens/ */
    sessao: process.env.WPP_SESSAO || 'affiliate-automation',
    /** Binario do Chrome/Chromium ('' = detecta automaticamente no boot) */
    chromePath: process.env.CHROME_PATH || '',
    /**
     * Versao do WhatsApp Web:
     *   'auto'   -> fixa a versao mais recente embutida no wppconnect (recomendado:
     *               evita o fallback para a versao live, que quebra a injecao)
     *   'latest' -> nao fixa nada (usa a versao live do WhatsApp Web)
     *   ou a versao exata, ex.: '2.3000.1047455456-alpha'
     */
    webVersion: process.env.WHATSAPP_WEB_VERSION || 'auto',
    /** Segundos que a pagina espera o QR ser escaneado (0 = nunca fecha) */
    timeoutQrMs: Math.max(0, parseInt(process.env.WPP_TIMEOUT_QR || '300', 10)) * 1000,
    /** Segundos maximos aguardando a sincronizacao do dispositivo (backlog) */
    deviceSyncMs: Math.max(0, parseInt(process.env.WPP_DEVICE_SYNC_TIMEOUT || '900', 10)) * 1000,
    /** Tentativas de conexao antes de desistir */
    tentativas: Math.max(1, parseInt(process.env.WPP_TENTATIVAS || '3', 10)),
    /**
     * Modo diagnostico de midia (DIAG_MIDIA=1): o app conecta, escuta e
     * enfileira normalmente, mas NUNCA envia — e imprime o payload cru de cada
     * mensagem com foto (`body` / `mediaData.preview` / `downloadMedia` com
     * dimensoes e KB) e o resultado da cascata, para dizer de onde veio a
     * imagem. Inerte em producao (default: false).
     */
    diagMidia: /^(1|true|sim|on)$/i.test(process.env.DIAG_MIDIA || ''),
  },
  antiban: {
    /** Limite máximo de ofertas enviadas por dia (0 = sem limite) */
    maxEnviosDia: parseInt(process.env.MAX_ENVIOS_DIA || '150', 10),
    /**
     * Janelas quentes (pico de compra no e-commerce BR):
     * almoço 12-14h e noite 19-22h. Configurável via .env.
     */
    horasQuentes: janelasHorarias(process.env.HORAS_QUENTES, '12-14,19-22'),
    /** Janela de silêncio (madrugada): envios ficam muito espaçados */
    horasSilencio: janelasHorarias(process.env.HORAS_SILENCIO, '0-7'),
    /** Delays entre envios (segundos) por faixa de horário */
    delayQuente: faixaSegundos(process.env.DELAY_QUENTE, 5, 15),
    delayNormal: faixaSegundos(process.env.DELAY_NORMAL, 45, 120),
    delayFrio: faixaSegundos(process.env.DELAY_FRIO, 180, 420),
  },
  afiliados: {
    shopee: {
      appId: process.env.SHOPEE_APP_ID || '',
      secret: process.env.SHOPEE_SECRET || '',
      /** Marca d'água (subId) dos short links gerados — antes era fixo no código */
      subId: process.env.SHOPEE_SUB_ID || '',
    },
    amazon: {
      tag: process.env.AMAZON_TAG || '',
    },
    magalu: {
      loja: process.env.MAGALU_STORE_ID || '',
    },
    mercadolivre: {
      affiliateId: process.env.MELI_AFFILIATE_ID || '',
      /** Slug da sua vitrine Meli (o que vem depois de /social/ no seu link) */
      vitrine: process.env.MELI_SOCIAL_ID || '',
    },
    shein: {
      affiliateId: process.env.SHEIN_AFFILIATE_ID || '',
    },
    tiktokshop: {
      affiliateId: process.env.TIKTOKSHOP_AFFILIATE_ID || '',
    },
    /**
     * Afiliados genéricos configurados 100% via .env:
     * AFFILIATE_GENERIC_N = "dominio.com:parametro:valor"
     */
    genericos: [1, 2, 3]
      .map((n) => {
        const raw = process.env[`AFFILIATE_GENERIC_${n}`];
        if (!raw) return null;
        const [dominio, parametro, valor] = raw.split(':');
        if (!dominio || !parametro || !valor) return null;
        return { dominio, parametro, valor };
      })
      .filter(Boolean),
  },
};

validarObrigatorias([
  ['TELEGRAM_API_ID', config.telegram.apiId],
  ['TELEGRAM_API_HASH', config.telegram.apiHash],
]);

export default config;

/**
 * A origem da mensagem está entre as que DEVEM IGNORAR a foto da própria
 * mensagem (FONTES_FOTO_SOMENTE_SITE)? Comparação normalizada — tanto faz
 * "whatsapp:12036...@g.us" quanto só o ID, "@canal" ou "canal".
 * @param {string} origem ex.: "whatsapp:120363419781062962@g.us" | "telegram:@promobit_oficial"
 * @returns {boolean}
 */
export function origemSoFotoSite(origem) {
  const alvo = normalizarOrigem(origem);
  if (!alvo) return false;
  return config.operacao.fontesSoFotoSite.some(
    (fonte) => normalizarOrigem(fonte) === alvo,
  );
}
