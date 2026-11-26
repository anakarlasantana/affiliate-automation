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

/** Registra (ou atualiza) a mídia de uma chave. Devolve o mapa resultante. */
export function registrarNoAcervo(midiaDir, chave, registro = {}) {
  if (!chave) throw new Error('chave obrigatória');
  if (!registro.arquivo) throw new Error('arquivo obrigatório');

  const mapa = carregarAcervo(midiaDir);
  mapa[chave] = {
    arquivo: String(registro.arquivo),
    link: registro.link || null,
    preco: Number.isFinite(Number(registro.preco)) ? Number(registro.preco) : null,
    titulo: registro.titulo || '',
    criado: registro.criado || new Date().toISOString(),
  };

  fs.mkdirSync(midiaDir, { recursive: true });
  fs.writeFileSync(caminhoAcervo(midiaDir), `${JSON.stringify(mapa, null, 2)}\n`);
  return mapa;
}
