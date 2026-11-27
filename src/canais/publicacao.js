/**
 * publicacao.js — publica o story de uma chave do acervo, com guardas.
 *
 * POR QUE separado do canal: `InstagramStory` sabe **como** publicar; aqui ficam
 * as regras de **poder** publicar (flag, credencial, URL pública, preço, acervo)
 * e a consulta de quota. Tudo com dependências injetáveis — o teste roda sem
 * rede e sem token.
 */
import config, { inicioDoDiaOperacional } from '../config.js';
import { carregarAcervo, contarPublicacoesDoDia, marcarPublicado } from '../midia/acervo.js';
import { precoCurto } from '../midia/compor.js';
import { quota } from './instagram.js';
import { InstagramStory } from './index.js';

export const MOTIVOS_PUBLICACAO = {
  SEM_ACERVO: 'sem-acervo',
  DESLIGADO: 'desligado',
  SEM_CREDENCIAL: 'sem-credencial',
  SEM_BASE_URL: 'sem-base-url',
  SEM_PRECO: 'sem-preco',
  JA_PUBLICADO: 'ja-publicado',
  LIMITE: 'limite-diario',
  QUOTA_INDISPONIVEL: 'quota-indisponivel',
};

/** Guardas puras: decidem se pode publicar, sem rede e sem token. */
export function conferirPublicacao({
  registro,
  killSwitch,
  credencialOk,
  baseUrl,
  preco,
  jaPublicado,
  publicadosHoje,
  limiteDia,
} = {}) {
  if (!registro) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_ACERVO };
  if (!killSwitch) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.DESLIGADO };
  if (!credencialOk) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_CREDENCIAL };
  if (!baseUrl) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_BASE_URL };

  const valor = Number(preco);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_PRECO };
  }

  if (jaPublicado) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.JA_PUBLICADO };

  if (Number.isFinite(Number(limiteDia)) && Number(limiteDia) > 0 && Number(publicadosHoje) >= Number(limiteDia)) {
    return { pronto: false, motivo: MOTIVOS_PUBLICACAO.LIMITE };
  }

  return { pronto: true, motivo: null };
}

/**
 * Legenda do story. O link não é clicável no story (limitação da API), então o
 * texto aponta para a bio — é o CTA que combina com o destino configurado.
 */
export function legendaDoStory({ titulo = '', preco } = {}) {
  const valor = Number(preco);
  const preçoTxt = Number.isFinite(valor) ? precoCurto(valor) : null;
  const cabeca = [String(titulo || '').trim(), preçoTxt].filter(Boolean).join(' — ');
  return `${cabeca || 'Oferta'}\n🔗 link na bio`;
}

/**
 * Fluxo do CLI: acervo → guardas → quota → canal.
 *
 * @returns {{pronto:boolean, motivo:string|null, mediaId?:string, disponiveis?:string[], imagemUrl?:string}}
 */
export async function publicarDoAcervo({ chave, preco, deps = {} } = {}) {
  const midiaDir = deps.midiaDir || config.publicacao.midiaDir;
  const acervo = carregarAcervo(midiaDir);
  const registro = acervo[chave] || null;

  const valor = Number(preco ?? registro?.preco);
  const killSwitch = deps.killSwitch ?? config.instagram.publicarStories;
  const credencialOk = deps.credencialOk ?? InstagramStory.estaConfigurado();
  const baseUrl = deps.baseUrl ?? config.publicacao.baseUrl;

  // Dedup e limite vêm do ACERVO (a quota da API ficou em 0 após publicar e não
  // serve de contador). Dia operacional respeita TZ_OPERACAO.
  const jaPublicado = Boolean(registro?.publicadoEm);
  const desde = deps.desde ?? inicioDoDiaOperacional();
  const publicadosHoje = deps.publicadosHoje ?? contarPublicacoesDoDia(midiaDir, desde);
  const limiteDia = config.publicacao.maxStoriesDia;

  const conferido = conferirPublicacao({
    registro,
    killSwitch,
    credencialOk,
    baseUrl,
    preco: valor,
    jaPublicado,
    publicadosHoje,
    limiteDia,
  });

  if (!conferido.pronto) {
    return { ...conferido, disponiveis: Object.keys(acervo) };
  }

  const base = String(baseUrl).replace(/\/+$/, '');
  const imagemUrl = `${base}/midia/${registro.arquivo}`;
  const legenda = legendaDoStory({ titulo: registro.titulo, preco: valor });

  // Quota ANTES de publicar. Sem consulta confiável, não publica.
  let quotaAtual = { usada: 0, total: 0 };
  const buscarQuota = deps.quota || (deps.canal ? null : () => quota(config.instagram));
  if (buscarQuota) {
    try {
      quotaAtual = await buscarQuota();
    } catch (erro) {
      return {
        pronto: false,
        motivo: MOTIVOS_PUBLICACAO.QUOTA_INDISPONIVEL,
        erro: erro?.message || String(erro),
      };
    }
  }

  const canal = deps.canal || new InstagramStory();
  const resultado = await canal.publicar(
    {
      imagemUrl,
      legenda,
      preco: { atual: valor },
      quotaUsada: quotaAtual.usada,
      quotaTotal: quotaAtual.total,
      jaPublicado,
      publicadosHoje,
    },
    deps.http ? { http: deps.http } : {},
  );

  // Publicou: marca no acervo (é o que alimenta dedup e limite diário).
  if (resultado.publicado) {
    marcarPublicado(midiaDir, chave, { mediaId: resultado.mediaId });
  }

  return { ...resultado, imagemUrl, legenda, quota: quotaAtual };
}
