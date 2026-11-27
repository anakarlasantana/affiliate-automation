/**
 * automatica.js — publica os stories do acervo sozinho (FEAT-012).
 *
 * POR QUÊ: o Instagram só operava por comando manual (`npm run publicar`). O
 * pedido é que ele comece a operar junto com o WhatsApp, ao subir o app.
 *
 * Duas defesas nasceram de falha real (27/11): a publicação foi recusada com
 * 9004/2207052 porque a Meta recebeu HTML no lugar do JPEG (servidor de mídia
 * parado). Por isso o PREFLIGHT confere `/health` e a própria mídia ANTES de
 * gastar chamada, e a recusa por mídia pausa o ciclo em vez de insistir.
 *
 * As guardas de kill switch, dedup, quota e limite diário continuam em
 * `publicarDoAcervo` (fonte única) — aqui é só o ritmo e a observabilidade.
 */
import config, { inicioDoDiaOperacional } from '../config.js';
import { carregarAcervo, contarPublicacoesDoDia } from '../midia/acervo.js';
import { publicarDoAcervo, publicarPostDoAcervo } from '../canais/publicacao.js';

/** Intervalo padrão entre stories (10 min): menos robótico que publicar em lote. */
export const INTERVALO_PADRAO_SEG = 600;

/** Prefixo de todo log do Instagram — filtra com `grep '\[ig\]'`. */
export const PREFIXO = '[ig]';

/**
 * Próximo story a publicar: pendente mais ANTIGO (ordem de criação).
 * Publicar em ordem evita que oferta nova fure a fila de oferta antiga.
 * @param {Record<string, {arquivo?:string, criado?:string, publicadoEm?:string}>} acervo
 * @returns {{chave:string, arquivo:string, preco:number, titulo:string}|null}
 */
export function proximoPendente(acervo = {}, formato = 'story') {
  const pendentes = Object.entries(acervo)
    .filter(
      ([, r]) =>
        r &&
        !r.publicadoEm &&
        r.arquivo &&
        (r.formato || 'story') === formato,
    )
    .map(([chave, r]) => ({
      chave,
      arquivo: r.arquivo,
      preco: r.preco,
      titulo: r.titulo || '',
      criado: r.criado || '',
    }))
    .sort((a, b) => Date.parse(a.criado || 0) - Date.parse(b.criado || 0));

  return pendentes[0] || null;
}

/** Busca HTTP mínima (isolada para o teste injetar uma falsa). */
async function buscarHttp(url) {
  const r = await fetch(url, { redirect: 'follow' });
  return {
    status: r.status,
    tipo: r.headers.get('content-type') || '',
    bytes: Number(r.headers.get('content-length') || 0),
  };
}

/**
 * Preflight: a Meta precisa BAIXAR a imagem, então a URL tem de responder
 * `200 image/jpeg` de fora. É o que faltou em 27/11 — sem isso a chamada é
 * gasta e volta 9004.
 * @param {{baseUrl?:string, arquivo?:string, buscar?:Function}} [opcoes]
 * @returns {Promise<{ok:boolean, motivo:string|null, detalhe?:string, bytes?:number, tipo?:string}>}
 */
export async function preflight({ baseUrl, arquivo, buscar = buscarHttp } = {}) {
  if (!baseUrl) return { ok: false, motivo: 'sem-base-url' };
  if (!arquivo) return { ok: false, motivo: 'sem-midia' };

  const saude = await buscar(`${baseUrl}/health`).catch(() => null);
  if (saude?.status !== 200) {
    return {
      ok: false,
      motivo: 'midia-inacessivel',
      detalhe: `health ${saude?.status ?? 'sem resposta'}`,
    };
  }

  const midia = await buscar(`${baseUrl}/midia/${arquivo}`).catch(() => null);
  if (midia?.status !== 200) {
    return {
      ok: false,
      motivo: 'midia-inacessivel',
      detalhe: `midia ${midia?.status ?? 'sem resposta'}`,
    };
  }
  if (!/^image\/jpe?g/i.test(String(midia.tipo || ''))) {
    // Página de aviso de túnel gratuito cai aqui: HTML onde deveria haver JPEG.
    return {
      ok: false,
      motivo: 'midia-inacessivel',
      detalhe: `tipo ${midia.tipo || 'desconhecido'}`,
    };
  }

  return { ok: true, motivo: null, bytes: midia.bytes, tipo: midia.tipo };
}

/**
 * Cria o publicador automático (injeção de tudo: acervo, preflight, publicação).
 *
 * @param {{cfg?:object, avisar?:(msg:string)=>void, deps?:object}} [opcoes]
 * @returns {{ciclo:Function, iniciar:Function, ultimaPublicacao:number|null}}
 */
export function criarPublicadorAutomatico({ cfg = config, avisar = () => {}, deps = {} } = {}) {
  const midiaDir = deps.midiaDir || cfg.publicacao.midiaDir;
  const carregar = deps.carregar || carregarAcervo;
  const confere = deps.preflight || preflight;
  const publicar = deps.publicar || publicarDoAcervo;
  const publicarPost = deps.publicarPost || publicarPostDoAcervo;
  const agora = deps.agora || (() => Date.now());
  const intervaloMs =
    Math.max(
      120,
      Number(deps.intervaloSeg || cfg.publicacao.intervaloStorySeg || INTERVALO_PADRAO_SEG),
    ) * 1000;

  let ultimaPublicacao = deps.ultimaPublicacao ?? null;
  let avisouDesligado = false;

  /** Um ciclo: escolhe 1 story, confere e publica. Devolve o que aconteceu. */
  async function ciclo() {
    // CA-3: kill switch é terminal — avisa UMA vez e não insiste.
    if (cfg.instagram?.publicarStories === false) {
      if (!avisouDesligado) {
        avisar(`🛑 ${PREFIXO} Ciclo parado: PUBLICAR_STORIES=0`);
        avisouDesligado = true;
      }
      return { motivo: 'desligado' };
    }

    const acervo = carregar(midiaDir);
    const desde = inicioDoDiaOperacional();
    const doDia = {
      story: contarPublicacoesDoDia(midiaDir, desde, 'story'),
      post: contarPublicacoesDoDia(midiaDir, desde, 'post'),
    };
    const pendentes = {
      story: proximoPendente(acervo, 'story'),
      post: cfg.publicacao.feedAtivo ? proximoPendente(acervo, 'post') : null,
    };
    avisar(
      `📸 ${PREFIXO} Acervo: story ${doDia.story}/${cfg.publicacao.maxStoriesDia} · ` +
        `post ${doDia.post}/${cfg.publicacao.maxPostsDia} hoje`,
    );

    // Story tem prioridade (é efêmero, some em 24 h); quando ele está no teto ou
    // sem pendente, entra o post do feed. Cada formato respeita o SEU teto.
    const escolhido =
      pendentes.story && doDia.story < cfg.publicacao.maxStoriesDia
        ? { formato: 'story', alvo: pendentes.story }
        : pendentes.post && doDia.post < cfg.publicacao.maxPostsDia
          ? { formato: 'post', alvo: pendentes.post }
          : null;

    if (!escolhido) {
      avisar(`📊 ${PREFIXO} Ciclo: nada a publicar (teto atingido ou fila vazia)`);
      return { motivo: 'vazio' };
    }
    const alvo = escolhido.alvo;
    const prontos = (pendentes.story ? 1 : 0) + (pendentes.post ? 1 : 0);

    // CA-2: intervalo entre stories (o limite diário e a quota ficam no
    // `publicarDoAcervo`, que é a fonte única dessas guardas).
    if (ultimaPublicacao && agora() - ultimaPublicacao < intervaloMs) {
      const faltam = Math.ceil((intervaloMs - (agora() - ultimaPublicacao)) / 60000);
      avisar(`⏳ ${PREFIXO} Próximo em ~${faltam}min · ${prontos} pendentes`);
      return { motivo: 'intervalo', faltamMin: faltam };
    }

    // CA-4: sem mídia acessível não se gasta chamada na Meta.
    const checagem = await confere({
      baseUrl: cfg.publicacao.baseUrl,
      arquivo: alvo.arquivo,
    });
    if (!checagem.ok) {
      avisar(
        `⛔ ${PREFIXO} Adiado: ${checagem.motivo} (${checagem.detalhe || 'sem detalhe'}) · story segue pendente`,
      );
      return { motivo: checagem.motivo, detalhe: checagem.detalhe };
    }
    const kb = Math.round((checagem.bytes || 0) / 1024);
    avisar(`🔎 ${PREFIXO} Preflight ok · health 200 · mídia 200 ${checagem.tipo} ${kb}KB`);

    const preco = Number.isFinite(alvo.preco) ? ` · R$ ${alvo.preco}` : '';
    avisar(`🆔 ${PREFIXO} Publicando [${escolhido.formato}] ${alvo.chave}${preco}`);

    const resultado =
      escolhido.formato === 'post'
        ? await publicarPost({ chavePost: alvo.chave })
        : await publicar({ chave: alvo.chave });

    if (resultado?.mediaId) {
      ultimaPublicacao = agora();
      const storyHoje = doDia.story + (escolhido.formato === 'story' ? 1 : 0);
      const postHoje = doDia.post + (escolhido.formato === 'post' ? 1 : 0);
      avisar(
        `✅ ${PREFIXO} Publicado [${escolhido.formato}] · mediaId ${resultado.mediaId} · ` +
          `story ${storyHoje}/${cfg.publicacao.maxStoriesDia} · post ${postHoje}/${cfg.publicacao.maxPostsDia}`,
      );
      return {
        motivo: null,
        formato: escolhido.formato,
        publicado: alvo.chave,
        mediaId: resultado.mediaId,
      };
    }

    const motivo = resultado?.motivo || 'desconhecido';
    const erro = resultado?.erro || '';
    avisar(
      `⛔ ${PREFIXO} Recusado: ${motivo}${erro ? ` (${erro})` : ''} · story segue pendente`,
    );

    // CA-5: mídia recusada pela Meta não melhora insistindo no mesmo ciclo.
    const pausar = /9004|2207052|midia/i.test(`${motivo} ${erro}`);
    if (pausar) avisar(`📊 ${PREFIXO} Ciclo pausado: mídia recusada pela Meta`);
    return { motivo, detalhe: erro, pausar };
  }

  /** Agenda os ciclos; devolve a função que para tudo. */
  function iniciar({ intervalo = intervaloMs, agendar = setTimeout } = {}) {
    let vivo = true;
    const passo = async () => {
      if (!vivo) return;
      try {
        await ciclo();
      } catch (erro) {
        avisar(`⚠️  ${PREFIXO} falha no ciclo: ${erro.message}`);
      }
      if (vivo) agendar(passo, intervalo);
    };
    passo();
    return () => {
      vivo = false;
    };
  }

  return {
    ciclo,
    iniciar,
    get ultimaPublicacao() {
      return ultimaPublicacao;
    },
  };
}
