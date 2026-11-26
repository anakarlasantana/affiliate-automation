/**
 * publicacao.js — publica o story de uma chave do acervo, com guardas.
 *
 * POR QUE separado do canal: `InstagramStory` sabe **como** publicar; aqui ficam
 * as regras de **poder** publicar (flag, credencial, URL pública, preço, acervo)
 * e a consulta de quota. Tudo com dependências injetáveis — o teste roda sem
 * rede e sem token.
 */
import config from '../config.js';
import { carregarAcervo } from '../midia/acervo.js';
import { precoCurto } from '../midia/compor.js';
import { quota } from './instagram.js';
import { InstagramStory } from './index.js';

export const MOTIVOS_PUBLICACAO = {
  SEM_ACERVO: 'sem-acervo',
  DESLIGADO: 'desligado',
  SEM_CREDENCIAL: 'sem-credencial',
  SEM_BASE_URL: 'sem-base-url',
  SEM_PRECO: 'sem-preco',
  QUOTA_INDISPONIVEL: 'quota-indisponivel',
};

/** Guardas puras: decidem se pode publicar, sem rede e sem token. */
export function conferirPublicacao({ registro, killSwitch, credencialOk, baseUrl, preco } = {}) {
  if (!registro) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_ACERVO };
  if (!killSwitch) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.DESLIGADO };
  if (!credencialOk) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_CREDENCIAL };
  if (!baseUrl) return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_BASE_URL };

  const valor = Number(preco);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { pronto: false, motivo: MOTIVOS_PUBLICACAO.SEM_PRECO };
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

  const conferido = conferirPublicacao({ registro, killSwitch, credencialOk, baseUrl, preco: valor });
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
    },
    deps.http ? { http: deps.http } : {},
  );

  return { ...resultado, imagemUrl, legenda, quota: quotaAtual };
}
