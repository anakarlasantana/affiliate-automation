/**
 * config.js
 * Centraliza e valida todas as variáveis de ambiente do projeto.
 * Qualquer novo afiliado/genérico deve ser lido aqui.
 */
import 'dotenv/config';

function lista(envValue) {
  return (envValue || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
