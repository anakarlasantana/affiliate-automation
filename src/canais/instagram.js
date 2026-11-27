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

/**
 * Envia a DM com o link (FEAT-005). Só funciona depois que a pessoa falou
 * primeiro — a janela de 24h é do Instagram, não nossa.
 */
export async function enviarMensagem(ig, { igsid, texto }, { http = axios } = {}) {
  if (!igsid) throw new Error('igsid obrigatório');
  if (!texto) throw new Error('texto obrigatório');

  const { data } = await http.post(
    urlGrafo(ig, `${ig.userId}/messages`),
    { recipient: { id: igsid }, message: { text: texto } },
    { params: { access_token: ig.token }, timeout: 20_000 },
  );

  return data?.message_id || null;
}


/* ================= Feed: post, carrossel e reels (FEAT-013) ================= */

/**
 * Cria o container de feed — um só ponto para os três formatos.
 *
 * POR QUÊ genérico: o `criarContainerStory` tinha `media_type` fixo em STORIES e
 * a Meta recusa 9:16 no feed. Aqui o tipo decide os parâmetros:
 *  - IMAGE    : `image_url` + legenda (sem media_type, é o padrão da API)
 *  - CAROUSEL : filhos (`is_carousel_item=true`) e depois o pai com `children`
 *  - REELS    : `video_url` + `share_to_feed` (aparece no feed E na aba Reels)
 *
 * @param {object} ig config.instagram
 * @param {{tipo?:'IMAGE'|'CAROUSEL'|'REELS', imagemUrl?:string, videoUrl?:string,
 *   legenda?:string, children?:string[], shareToFeed?:boolean,
 *   isCarouselItem?:boolean}} dados
 * @returns {Promise<string>} id do container
 */
export async function criarContainer(
  ig,
  {
    tipo = 'IMAGE',
    imagemUrl,
    videoUrl,
    legenda = '',
    children = [],
    shareToFeed = true,
    isCarouselItem = false,
  } = {},
  { http = axios } = {},
) {
  const params = { access_token: ig.token };

  if (tipo === 'REELS') {
    if (!videoUrl) throw new Error('reels exige videoUrl (a Meta baixa por URL)');
    params.media_type = 'REELS';
    params.video_url = videoUrl;
    params.caption = legenda;
    params.share_to_feed = shareToFeed ? 'true' : 'false';
  } else if (tipo === 'CAROUSEL') {
    if (!Array.isArray(children) || children.length < 2) {
      throw new Error('carrossel exige 2 ou mais filhos');
    }
    params.media_type = 'CAROUSEL';
    params.children = children.join(',');
    params.caption = legenda;
  } else {
    if (!imagemUrl) throw new Error('imagemUrl obrigatória (a Meta baixa por URL)');
    params.image_url = imagemUrl;
    if (isCarouselItem) {
      params.is_carousel_item = 'true';
    } else {
      params.caption = legenda;
    }
  }

  const { data } = await http.post(
    urlGrafo(ig, `${ig.userId}/media`),
    null,
    { params, timeout: 30_000 },
  );

  if (!data?.id) throw new Error('container sem id na resposta');
  return data.id;
}

/**
 * Publica no feed no formato pedido.
 *
 * O vídeo SEMPRE espera `FINISHED` antes do `media_publish` (a Meta processa em
 * minutos): publicar antes devolve erro e queima a chamada.
 *
 * @param {object} ig
 * @param {{formato?:'post'|'carrossel'|'reels', imagens?:string[], videoUrl?:string, legenda?:string}} dados
 * @returns {Promise<string>} mediaId publicado
 */
export async function publicarFeed(
  ig,
  { formato = 'post', imagens = [], videoUrl, legenda = '' } = {},
  deps = {},
) {
  if (formato === 'reels') {
    const container = await criarContainer(
      ig,
      { tipo: 'REELS', videoUrl, legenda },
      deps,
    );
    await aguardarContainer(ig, container, deps);
    return publicarContainer(ig, container, deps);
  }

  if (formato === 'carrossel') {
    const filhos = [];
    for (const url of imagens.slice(0, 10)) {
      filhos.push(
        await criarContainer(
          ig,
          { tipo: 'IMAGE', imagemUrl: url, isCarouselItem: true },
          deps,
        ),
      );
    }
    const pai = await criarContainer(
      ig,
      { tipo: 'CAROUSEL', children: filhos, legenda },
      deps,
    );
    await aguardarContainer(ig, pai, deps);
    return publicarContainer(ig, pai, deps);
  }

  if (!imagens[0]) throw new Error('post exige imagem');
  const container = await criarContainer(
    ig,
    { tipo: 'IMAGE', imagemUrl: imagens[0], legenda },
    deps,
  );
  await aguardarContainer(ig, container, deps);
  return publicarContainer(ig, container, deps);
}
