/**
 * canais/base.js — contrato de canal de publicação + a regra de quando publicar.
 *
 * Espelha src/affiliates/base.js de propósito: o **genérico** (decidir se
 * publica) fica aqui, o **peculiar** (como publicar) fica no canal
 * (`instagram.js`, futuramente `tiktok.js`). Nada de regra de Instagram no
 * app.js.
 */

export class CanalPublisher {
  /** @type {string} nome amigável (aparece no doctor e nos logs) */
  static nome = 'canal';
  /** @type {string[]} variáveis de ambiente obrigatórias */
  static credenciaisRequeridas = [];

  static credenciaisFaltantes() {
    return this.credenciaisRequeridas.filter((chave) => !process.env[chave]);
  }

  static estaConfigurado() {
    return this.credenciaisFaltantes().length === 0;
  }

  /**
   * @param {object} _dados
   * @returns {Promise<object>} resultado do canal (ex.: { mediaId })
   */
  // eslint-disable-next-line no-unused-vars
  async publicar(_dados) {
    throw new Error('publicar() não implementado');
  }
}

/** Motivos de descarte — strings estáveis, usadas em log e no `status`. */
export const MOTIVOS = {
  DESLIGADO: 'desligado',
  SEM_CREDENCIAL: 'sem-credencial',
  SEM_PRECO: 'sem-preco',
  DUPLICADO: 'ja-publicado',
  QUOTA: 'quota-esgotada',
  LIMITE: 'limite-diario',
};

/**
 * A decisão de publicar é PURA: recebe o estado, devolve o veredito.
 * Assim dá para provar as regras (kill switch, preço, quota, dedup, limite)
 * sem rede, sem token e sem tocar no Instagram.
 *
 * @returns {{publicar: boolean, motivo: string|null}}
 */
export function decidirPublicacao({
  killSwitch,
  temCredencial,
  preco,
  quotaUsada,
  quotaTotal,
  jaPublicado,
  publicadosHoje,
  limiteDia,
} = {}) {
  if (!killSwitch) return { publicar: false, motivo: MOTIVOS.DESLIGADO };

  // `undefined` = não checado (mantém compatível com quem não passa credencial).
  if (temCredencial === false) return { publicar: false, motivo: MOTIVOS.SEM_CREDENCIAL };

  if (!preco || !Number.isFinite(preco.atual) || preco.atual <= 0) {
    return { publicar: false, motivo: MOTIVOS.SEM_PRECO };
  }

  if (jaPublicado) return { publicar: false, motivo: MOTIVOS.DUPLICADO };

  if (
    Number.isFinite(quotaUsada) &&
    Number.isFinite(quotaTotal) &&
    quotaTotal > 0 &&
    quotaUsada >= quotaTotal
  ) {
    return { publicar: false, motivo: MOTIVOS.QUOTA };
  }

  if (
    Number.isFinite(publicadosHoje) &&
    Number.isFinite(limiteDia) &&
    limiteDia > 0 &&
    publicadosHoje >= limiteDia
  ) {
    return { publicar: false, motivo: MOTIVOS.LIMITE };
  }

  return { publicar: true, motivo: null };
}

/**
 * Publica sem deixar a falha do canal vazar para o resto do pipeline.
 * O WhatsApp não pode parar porque o Instagram recusou uma publicação.
 */
export async function tentarPublicar(canal, dados) {
  try {
    return { ok: true, resultado: await canal.publicar(dados) };
  } catch (erro) {
    return { ok: false, erro: erro?.message || String(erro) };
  }
}
