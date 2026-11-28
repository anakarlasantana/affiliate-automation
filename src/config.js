/**
 * config.js
 * Centraliza e valida todas as variáveis de ambiente do projeto.
 * Qualquer novo afiliado/genérico deve ser lido aqui.
 */
import 'dotenv/config';

/**
 * Valor de uma variável de ambiente, **saneado**.
 *
 * POR QUÊ existe: o `dotenv` NÃO remove comentário no fim da linha — em
 * `IG_ACCESS_TOKEN=EAG...ZDZD   # token (~60d)` o valor chega com o comentário
 * grudado. Isso quebrou a autenticação da Meta em 27/11 (400 "invalid token")
 * sem erro de código: o app enviava `"EAG...ZDZD   # token (~60d)"`.
 *
 * Corta tudo a partir de `#`, tira espaços nas pontas e remove aspas que
 * envolvam o valor inteiro. O `.env` continua podendo explicar a variável na
 * mesma linha.
 *
 * @param {string} nome
 * @param {string} [padrao]
 * @returns {string}
 */
export function valorEnv(nome, padrao = '') {
  const bruto = process.env[nome];
  if (bruto === undefined) return padrao;

  let valor = String(bruto).split('#')[0].trim();
  const entreAspas =
    valor.length >= 2 &&
    ((valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'")));
  if (entreAspas) valor = valor.slice(1, -1).trim();

  return valor === '' ? padrao : valor;
}
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
 * (sem foto na mensagem, no site e nem plano B). Versionada em
 * assets/placeholder-confira-produto.png; PLACEHOLDER_IMAGEM permite
 * apontar para outra arte sem mexer no codigo.
 *
 * FEAT-017: caminho absoluto que não existe (ex.: copiado do notebook) cai no
 * padrão relativo à raiz — em produção o `.env` apontava para
 * `/home/sn-…/assets/…`, e o app passava a usar um genérico de emergência.
 */
export const PLACEHOLDER_PATH = (() => {
  const configurado = (process.env.PLACEHOLDER_IMAGEM || '').trim();
  const padrao = path.join(ROOT_DIR, 'assets', 'placeholder-confira-produto.png');
  if (configurado && fs.existsSync(configurado)) return configurado;
  if (configurado) {
    console.warn(
      `   ⚠️  PLACEHOLDER_IMAGEM aponta para arquivo inexistente (${configurado}) — usando ${padrao}`,
    );
  }
  return padrao;
})();
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
    /**
     * Convite do grupo na legenda do feed (FEAT-014).
     *
     * Liga por padrão e só aparece quando `GO_DESTINO` NÃO é `grupo` — se a bio
     * já leva ao grupo, repetir o link é ruído. No Instagram ele não é clicável:
     * serve para copiar/colar e para quem reposta.
     */
    feedConviteNaLegenda: /^(1|true|sim|on)$/i.test(
      process.env.FEED_CONVITE_NA_LEGENDA ?? '1',
    ),
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
    /**
     * FEAT-019: baixar a midia FORA do Chromium quando o downloadMedia falhar.
     *
     * O `downloadMedia` do wppconnect roda dentro da pagina e o wa-js decodifica
     * a imagem no renderer (`prepRawMedia`) — na VPS isso estoura
     * `Runtime.callFunctionOn`. Ligado por padrao; `MIDIA_NO_NODE=0` desliga.
     */
    midiaNoNode: !/^(0|false|nao|off)$/i.test(process.env.MIDIA_NO_NODE || ''),
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
  /**
   * Publicação em canais externos (Instagram). Tudo desligado por padrão:
   * `PUBLICAR_STORIES=0` é o kill switch e a conta só entra quando o token
   * existir. Nada de segredo em código (FEAT-004).
   */
  publicacao: {
    /** URL pública que a Meta usa para baixar a mídia (sem ela, não publica) */
    baseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    /** Base do link curto que vai na bio/Direct */
    goBaseUrl: (process.env.GO_BASE_URL || '').replace(/\/+$/, ''),
    /** Para onde o link curto aponta por padrão: grupo | oferta */
    goDestino: (process.env.GO_DESTINO || 'grupo').toLowerCase(),
    /** Onde as mídias compostas são servidas */
    midiaDir: process.env.MIDIA_DIR || path.join(DATA_DIR, 'midia'),
    maxStoriesDia: parseInt(process.env.MAX_STORIES_DIA || '5', 10),
    /** Segundos entre duas publicações automáticas (FEAT-012). */
    intervaloStorySeg: Math.max(
      120,
      parseInt(process.env.INTERVALO_STORY_SEG || '600', 10),
    ),
    /**
     * Compõe também o criativo 4:5 do feed na captura (FEAT-013).
     * Ligado por padrão: sem isso o post teria de ser composto na mão.
     */
    feedAtivo: /^(1|true|sim|on)$/i.test(process.env.FEED_ATIVO ?? '1'),
    maxReelsDia: parseInt(process.env.MAX_REELS_DIA || '1', 10),
    /**
     * Teto de POSTS no feed por dia (FEAT-013).
     *
     * Separado do de stories de propósito: story dura 24 h, post fica na grade
     * para sempre. 12/dia viraria 84 posts por semana na parede do perfil.
     * A quota da Meta (100/24 h) é compartilhada e serve de teto absoluto.
     */
    maxPostsDia: parseInt(process.env.MAX_POSTS_DIA || '6', 10),
    /**
     * Quantos stories para cada post no feed (FEAT-013).
     *
     * `0` = prioridade absoluta do story (o post só entra quando o story bate o
     * teto). `2` = a cada 2 stories entra 1 post — feed mais ativo, que é o
     * pedido da operação: post é permanente, story some em 24 h.
     */
    storiesPorPost: Math.max(0, parseInt(process.env.STORIES_POR_POST || '2', 10)),
    /** Resposta automática no Direct (FEAT-005) */
    diretoAtivo: /^(1|true|sim|on)$/i.test(process.env.DIRETO_ATIVO || ''),
    palavraDireto: (process.env.DIRECT_PALAVRA || 'LINK').trim(),
    /** Porta do servidor de mídia/redirecionador/webhook */
    porta: parseInt(process.env.PORT || '3000', 10),
  },
  instagram: {
    /** ID numérico da conta profissional (não é o @handle) */
    userId: valorEnv('IG_USER_ID'),
    /** Token de longa duração (System User = não expira) */
    token: valorEnv('IG_ACCESS_TOKEN'),
    /** Segredo do app — só para validar a assinatura do webhook */
    appSecret: valorEnv('IG_APP_SECRET'),
    /** Token do handshake do webhook (`hub.verify_token`) */
    verifyToken: valorEnv('IG_VERIFY_TOKEN'),
    graphVersion: process.env.IG_GRAPH_VERSION || 'v21.0',
    /** Kill switch da publicação de story (default: desligado) */
    publicarStories: /^(1|true|sim|on)$/i.test(process.env.PUBLICAR_STORIES || ''),
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
