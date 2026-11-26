/**
 * redirecionador.js — destino e contagem de clique do link curto.
 *
 * POR QUE existe: a API do Instagram não edita a bio e o story não aceita link.
 * O endereço curto no NOSSO domínio é o único ponto que dá para trocar sem tocar
 * no Instagram — e é também onde o clique passa a ser contado (o Instagram não
 * informa clique de story para fora).
 */
import fs from 'node:fs';
import path from 'node:path';

/** Extrai a chave de `/go/<chave>`; devolve null para qualquer outra rota. */
export function chaveDoCaminho(caminho) {
  const m = /^\/go\/([A-Za-z0-9_-]{1,64})\/?$/.exec(String(caminho || ''));
  return m ? m[1] : null;
}

/**
 * Destino de uma chave. Só https: um `javascript:` ou `http:` aqui viraria
 * open redirect/execução — o link de afiliado é sempre https.
 */
export function montarDestino(chave, destinos) {
  if (!chave || !destinos) return null;
  const destino = destinos[chave];
  if (typeof destino !== 'string' || !/^https:\/\//i.test(destino)) return null;
  return destino;
}

/** Incrementa o clique da chave sem mutar o objeto recebido. */
export function registrarClique(cliques, chave) {
  const base = { ...(cliques || {}) };
  const total = (base[chave] || 0) + 1;
  base[chave] = total;
  return { cliques: base, total };
}

/** Fallback quando a chave não existe: grupo, oferta do momento ou 404. */
export function destinoPadrao(modo, { grupo, oferta } = {}) {
  if (modo === 'grupo' && grupo) return grupo;
  if (modo === 'oferta' && oferta) return oferta;
  return null;
}

/* ================= mapa chave → link (disco) ================= */

/**
 * POR QUE arquivo e não banco: o redirecionador precisa responder mesmo num
 * ambiente sem SQLite compilado, e o conteúdo é minúsculo (uma linha por
 * oferta). O arquivo vive em `data/`, que já é ignorado pelo git.
 */
export function carregarDestinos(arquivo) {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  } catch {
    return {};
  }
}

export function salvarDestinos(arquivo, destinos) {
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, `${JSON.stringify(destinos, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Registra (ou atualiza) o destino de uma chave. Devolve o mapa resultante. */
export function registrarDestino(arquivo, chave, url) {
  const mapa = carregarDestinos(arquivo);
  if (chave && typeof url === 'string' && /^https:\/\//i.test(url)) {
    mapa[chave] = url;
    salvarDestinos(arquivo, mapa);
  }
  return mapa;
}
