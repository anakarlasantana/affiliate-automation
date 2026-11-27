/**
 * acervo.js — índice `chave → mídia composta` (arquivo, link, preço).
 *
 * POR QUE existe: o JPEG do story é nomeado pelo hash do conteúdo (exigência do
 * FEAT-003), então o nome do arquivo NÃO diz de qual oferta ele é. Sem este
 * índice, o CLI de publicação não sabe qual imagem mandar para a Meta nem com
 * que preço.
 *
 * Vive em `data/midia/acervo.json`, ao lado da mídia — `data/` é ignorado.
 */
import fs from 'node:fs';
import path from 'node:path';

export const NOME_ACERVO = 'acervo.json';

export function caminhoAcervo(midiaDir) {
  if (!midiaDir) throw new Error('midiaDir obrigatório');
  return path.join(midiaDir, NOME_ACERVO);
}

/** Mapa completo; arquivo ausente ou corrompido = mapa vazio. */
export function carregarAcervo(midiaDir) {
  try {
    const bruto = JSON.parse(fs.readFileSync(caminhoAcervo(midiaDir), 'utf8'));
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  } catch {
    return {};
  }
}

export function buscarNoAcervo(midiaDir, chave) {
  if (!chave) return null;
  return carregarAcervo(midiaDir)[chave] || null;
}

export function listarChavesDoAcervo(midiaDir) {
  return Object.keys(carregarAcervo(midiaDir));
}

/** Salva o mapa inteiro (usado por registrar e marcar). */
function salvarAcervo(midiaDir, mapa) {
  fs.mkdirSync(midiaDir, { recursive: true });
  fs.writeFileSync(caminhoAcervo(midiaDir), `${JSON.stringify(mapa, null, 2)}\n`);
  return mapa;
}

/** Registra (ou atualiza) a mídia de uma chave. Devolve o mapa resultante. */
export function registrarNoAcervo(midiaDir, chave, registro = {}) {
  if (!chave) throw new Error('chave obrigatória');
  if (!registro.arquivo) throw new Error('arquivo obrigatório');

  const mapa = carregarAcervo(midiaDir);
  const anterior = mapa[chave] || {};

  mapa[chave] = {
    arquivo: String(registro.arquivo),
    link: registro.link || null,
    preco: Number.isFinite(Number(registro.preco)) ? Number(registro.preco) : null,
    titulo: registro.titulo || '',
    criado: registro.criado || new Date().toISOString(),
    // Re-registrar a mídia NÃO pode apagar o histórico de publicação.
    ...(anterior.publicadoEm ? { publicadoEm: anterior.publicadoEm } : {}),
    ...(anterior.mediaId ? { mediaId: anterior.mediaId } : {}),
  };

  return salvarAcervo(midiaDir, mapa);
}

/**
 * Marca a chave como publicada no Instagram (dedup e limite diário leem daqui).
 * Só marca chave existente — publicar algo fora do acervo é erro de fluxo.
 */
export function marcarPublicado(midiaDir, chave, { mediaId = null, quando } = {}) {
  const mapa = carregarAcervo(midiaDir);
  if (!mapa[chave]) return null;

  mapa[chave] = {
    ...mapa[chave],
    publicadoEm: quando || new Date().toISOString(),
    ...(mediaId ? { mediaId } : {}),
  };

  salvarAcervo(midiaDir, mapa);
  return mapa[chave];
}

/**
 * Quantas chaves do acervo foram publicadas desde `desde`.
 * `desde` aceita ISO ou o formato do SQLite ('YYYY-MM-DD HH:MM:SS', em UTC).
 */
export function contarPublicacoesDoDia(midiaDir, desde) {
  let base = Number(desde);
  if (!Number.isFinite(base)) {
    base = Date.parse(`${String(desde || '').replace(' ', 'T')}Z`);
  }
  if (!Number.isFinite(base)) return 0;

  return Object.values(carregarAcervo(midiaDir)).filter((registro) => {
    const t = Date.parse(registro.publicadoEm || '');
    return Number.isFinite(t) && t >= base;
  }).length;
}

/**
 * Chave do story publicado mais recentemente — é para ela que o link da bio
 * (`GET /go`) aponta.
 *
 * Só considera `publicadoEm`: apontar para um story composto mas NÃO publicado
 * levaria o seguidor a um produto que ele nunca viu. Sem nenhum publicado,
 * devolve null e o servidor responde 404 (nunca cai no grupo por engano).
 */
export function chavePublicadaRecente(midiaDir) {
  let melhor = null;
  let melhorQuando = -Infinity;

  for (const [chave, registro] of Object.entries(carregarAcervo(midiaDir))) {
    const t = Date.parse(registro?.publicadoEm || '');
    if (!Number.isFinite(t)) continue;
    if (t > melhorQuando) {
      melhorQuando = t;
      melhor = chave;
    }
  }

  return melhor;
}
