/**
 * canais/index.js — registry dos canais de publicação.
 *
 * Espelha src/affiliates/index.js: o genérico (decidir publicar) está em
 * `base.js`; cada canal implementa `publicar()`. Hoje só existe o story do
 * Instagram — Reels e Direct entram nas FEAT-005/006.
 */
import config from '../config.js';
import {
  CanalPublisher,
  MOTIVOS,
  decidirPublicacao,
  tentarPublicar,
} from './base.js';
import { publicarStory } from './instagram.js';

export class InstagramStory extends CanalPublisher {
  static nome = 'InstagramStory';
  static credenciaisRequeridas = ['IG_USER_ID', 'IG_ACCESS_TOKEN'];

  /**
   * Publica o story respeitando kill switch, preço, quota, dedup e limite.
   * Devolve `{ publicado, motivo, mediaId? }` — nunca lança por regra de negócio.
   */
  async publicar(dados = {}, deps = {}) {
    const decisao = decidirPublicacao({
      killSwitch: config.instagram.publicarStories,
      preco: dados.preco,
      quotaUsada: dados.quotaUsada,
      quotaTotal: dados.quotaTotal,
      jaPublicado: dados.jaPublicado,
      publicadosHoje: dados.publicadosHoje,
      limiteDia: config.publicacao.maxStoriesDia,
    });

    if (!decisao.publicar) return { publicado: false, motivo: decisao.motivo };

    if (!this.constructor.estaConfigurado()) {
      return { publicado: false, motivo: MOTIVOS.DESLIGADO, faltantes: this.constructor.credenciaisFaltantes() };
    }

    const mediaId = await publicarStory(config.instagram, dados, deps);
    return { publicado: true, motivo: null, mediaId };
  }
}

export const CANAIS = [InstagramStory];

/** Panorama para o `doctor`: quem está configurado e o que falta. */
export function resumoCanais() {
  return CANAIS.map((Canal) => ({
    canal: Canal.nome,
    ativo: Canal.estaConfigurado(),
    faltantes: Canal.credenciaisFaltantes(),
  }));
}

export { CanalPublisher, MOTIVOS, decidirPublicacao, tentarPublicar };
