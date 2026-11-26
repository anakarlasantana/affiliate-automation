/**
 * redirecionador.js — destino e contagem de clique do link curto.
 *
 * POR QUE existe: a API do Instagram não edita a bio e o story não aceita link.
 * O endereço curto no NOSSO domínio é o único ponto que dá para trocar sem tocar
 * no Instagram — e é também onde o clique passa a ser contado (o Instagram não
 * informa clique de story para fora).
 */

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
