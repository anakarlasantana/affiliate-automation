/**
 * escolha.js — qual pendente publicar agora (FEAT-020).
 *
 * POR QUÊ existe: a escolha anterior dava prioridade absoluta ao story quando
 * havia um pendente. Com ofertas chegando o tempo todo, cada ciclo publicava o
 * story novo e o **post antigo nunca chegava a vez** — em 28/11 havia 2 posts
 * compostos e nenhum publicado no feed.
 *
 * A regra nova compara **há quanto tempo cada formato espera**:
 *
 *   1. o mais antigo da fila vence (seja story ou post);
 *   2. o interleave (`STORIES_POR_POST`) continua valendo para furar a fila:
 *      com N stories já publicados contra 0 posts, o post entra primeiro;
 *   3. tetos por formato são respeitados — quem está no teto sai da disputa.
 */

/**
 * @param {{
 *   pendentes?: Record<string, {chave?:string, criado?:string}|null>,
 *   doDia?: Record<string, number>,
 *   cfg?: {maxStoriesDia?:number, maxPostsDia?:number, maxReelsDia?:number, storiesPorPost?:number},
 * }} [opcoes]
 * @returns {{formato:string, alvo:object, motivo:string}|null}
 */
export function escolherDoCiclo({ pendentes = {}, doDia = {}, cfg = {} } = {}) {
  const limite = {
    story: cfg.maxStoriesDia ?? 0,
    post: cfg.maxPostsDia ?? 0,
    reel: cfg.maxReelsDia ?? 0,
  };
  const razao = cfg.storiesPorPost || 0;

  /** O formato tem vaga hoje E tem algo pendente? */
  const candidato = (formato) => {
    const alvo = pendentes[formato];
    if (!alvo) return null;
    const teto = Number(limite[formato]);
    if (teto > 0 && (doDia[formato] || 0) >= teto) return null;
    return alvo;
  };

  const story = candidato('story');
  const post = candidato('post');
  const reel = candidato('reel');

  // Interleave: com N stories publicados contra 0 posts, o post fura a fila.
  if (post && razao > 0) {
    const stories = doDia.story || 0;
    const posts = doDia.post || 0;
    if (stories >= (posts + 1) * razao) {
      return { formato: 'post', alvo: post, motivo: 'interleave' };
    }
  }

  // O mais antigo vence. `criado` ausente/inválido vai para o fim da fila.
  const quando = (alvo) => {
    const t = Date.parse(alvo?.criado || '');
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };

  // Story e post disputam por antiguidade; reel fica como último recurso
  // (formato mais caro e de menor frequência).
  const disputa = [
    story ? { formato: 'story', alvo: story } : null,
    post ? { formato: 'post', alvo: post } : null,
  ].filter(Boolean);

  if (disputa.length) {
    disputa.sort((a, b) => quando(a.alvo) - quando(b.alvo));
    return { ...disputa[0], motivo: 'mais-antigo' };
  }

  if (reel) return { formato: 'reel', alvo: reel, motivo: 'unico' };
  return null;
}
