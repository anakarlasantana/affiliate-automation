/**
 * instagram.js — cliente mínimo da Graph API para publicar Story.
 *
 * POR QUE dois passos: a API cria um "container" e só depois publica
 * (`media_publish`). Container expira em 24 h e, para vídeo, é preciso esperar
 * `status_code=FINISHED` antes de publicar.
 *
 * `http` é injetável: os testes rodam sem rede e sem token.
 */
import axios from 'axios';

const BASE = 'https://graph.facebook.com';

export function urlGrafo(ig, caminho) {
  const versao = ig?.graphVersion || 'v21.0';
  return `${BASE}/${versao}/${caminho}`;
}

/** Quanto já foi publicado nas últimas 24 h e qual o teto da conta. */
export async function quota(ig, { http = axios } = {}) {
  const { data } = await http.get(urlGrafo(ig, `${ig.userId}/content_publishing_limit`), {
    params: { fields: 'quota_usage,config', access_token: ig.token },
    timeout: 15_000,
  });

  const item = data?.data?.[0] || {};
  const total = item.config?.quota_total ?? 0;
  const usada = item.quota_usage ?? 0;

  return { usada, total, livre: Math.max(0, total - usada) };
}

/** Passo 1: cria o container do story (a Meta baixa a imagem pela URL). */
export async function criarContainerStory(ig, { imagemUrl, legenda = '' }, { http = axios } = {}) {
  if (!imagemUrl) throw new Error('imagemUrl obrigatória (a Meta baixa por URL)');

  const { data } = await http.post(
    urlGrafo(ig, `${ig.userId}/media`),
    null,
    {
      params: {
        media_type: 'STORIES',
        image_url: imagemUrl,
        caption: legenda,
        access_token: ig.token,
      },
      timeout: 30_000,
    },
  );

  if (!data?.id) throw new Error('container sem id na resposta');
  return data.id;
}

/** Passo 2: estado do container (EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED). */
export async function statusContainer(ig, containerId, { http = axios } = {}) {
  const { data } = await http.get(urlGrafo(ig, containerId), {
    params: { fields: 'status_code', access_token: ig.token },
    timeout: 15_000,
  });
  return data?.status_code || null;
}

/** Espera o container ficar FINISHED (a doc recomenda 1x/min, máx 5 min). */
export async function aguardarContainer(
  ig,
  containerId,
  { http = axios, tentativas = 5, esperaMs = 3_000, dormir = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  for (let i = 0; i < tentativas; i++) {
    const estado = await statusContainer(ig, containerId, { http });
    if (estado === 'FINISHED' || estado === 'PUBLISHED') return estado;
    if (estado === 'ERROR' || estado === 'EXPIRED') {
      throw new Error(`container ${estado}`);
    }
    if (i < tentativas - 1) await dormir(esperaMs);
  }
  throw new Error('container não ficou pronto a tempo');
}

/** Passo 3: publica o container. Devolve o id da mídia publicada. */
export async function publicarContainer(ig, containerId, { http = axios } = {}) {
  const { data } = await http.post(
    urlGrafo(ig, `${ig.userId}/media_publish`),
    null,
    { params: { creation_id: containerId, access_token: ig.token }, timeout: 30_000 },
  );

  if (!data?.id) throw new Error('media_publish sem id na resposta');
  return data.id;
}

/** Fluxo completo do story. */
export async function publicarStory(ig, dados, deps = {}) {
  const containerId = await criarContainerStory(ig, dados, deps);
  await aguardarContainer(ig, containerId, deps);
  return publicarContainer(ig, containerId, deps);
}
