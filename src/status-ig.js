/**
 * status-ig.js — seção do Instagram do `npm run status` (FEAT-012 · CA-9).
 *
 * POR QUÊ em módulo próprio: `status.js` é um SCRIPT (lê arquivo, imprime e pode
 * chamar `process.exit` no import). Deixar a montagem das linhas aqui permite
 * testá-la sem executar o script.
 */

/**
 * @param {{acervo?:object, quota?:object|null, limiteDia?:number, bloqueio?:object|null, desde?:string}} [dados]
 * @returns {string[]} linhas prontas para imprimir
 */
export function secaoInstagram({
  acervo = {},
  quota = null,
  limiteDia = 0,
  bloqueio = null,
  desde = null,
} = {}) {
  const registros = Object.entries(acervo).filter(
    ([, r]) => r && typeof r === 'object',
  );
  const publicados = registros
    .filter(([, r]) => r.publicadoEm)
    .sort((a, b) => Date.parse(b[1].publicadoEm) - Date.parse(a[1].publicadoEm));
  const pendentes = registros
    .filter(([, r]) => !r.publicadoEm && r.arquivo)
    .sort((a, b) => Date.parse(a[1].criado || 0) - Date.parse(b[1].criado || 0));

  const marco = desde ? Date.parse(desde) : null;
  const hoje = Number.isFinite(marco)
    ? publicados.filter(([, r]) => Date.parse(r.publicadoEm) >= marco).length
    : publicados.length;

  const q =
    quota && Number.isFinite(quota.usada) && Number.isFinite(quota.total)
      ? ` · quota ${quota.usada}/${quota.total}`
      : ' · quota indisponível';

  const linhas = [`\n📸 INSTAGRAM — ${hoje}/${limiteDia || '?'} hoje${q}`];

  if (publicados.length) {
    const [chave, r] = publicados[0];
    linhas.push(
      `   Último    : ${chave} · mediaId ${r.mediaId || '-'} · ${r.publicadoEm}`,
    );
  } else {
    linhas.push('   Último    : nenhum story publicado ainda');
  }

  linhas.push(
    pendentes.length
      ? `   Pendentes : ${pendentes.length} (mais antigo: ${pendentes[0][0]})`
      : '   Pendentes : nenhum',
  );

  if (bloqueio?.motivo) {
    linhas.push(
      `   Bloqueio  : ${bloqueio.motivo}${bloqueio.quando ? ` em ${bloqueio.quando}` : ''}`,
    );
  }

  return linhas;
}
