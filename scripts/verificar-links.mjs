/**
 * verificar-links.mjs
 *
 * Responde a pergunta que nem `npm run check` nem `npm test` respondem:
 * "o link que publicamos abre o produto REAL e carrega o NOSSO id de afiliado?"
 *
 * O caminho exercitado é o mesmo do app (src/app.js → processarOferta):
 *   expandirLink → sanitizarUrl → chaveProduto → converterParaAfiliado
 * e, depois, o link final é aberto na rede para conferir status HTTP, se o
 * produto aparece no destino e se o rastreio está presente.
 *
 * Uso:
 *   npm run verify:links                       # usa test/fixtures/links-ouvidos.json
 *   npm run verify:links -- <url> [<url>…]     # URLs avulsas
 *   npm run verify:links -- --json             # saída para máquina
 *   npm run verify:links -- --falhar-placeholder  # exit 1 se sairia placeholder
 *
 * Além do link, reporta a IMAGEM que seria publicada (site:og-image, galeria,
 * loja:api-imagem ou PLACEHOLDER). Placeholder não reprova por padrão — a loja
 * pode estar bloqueando o HTML de forma transitória — mas o resumo mostra a
 * contagem, porque cartão genérico não converte em venda.
 *
 * Exit: 0 = nenhum FAIL (SKIP não é falha) · 1 = algum FAIL
 *       (ou placeholder, com --falhar-placeholder).
 *
 * Por que não é `node --test`: depende de rede (lojas externas). Teste unitário
 * não pode quebrar por um 503 do Mercado Livre; isto é verificação de
 * integração, rodada a pedido e pelo harness (`ai verify api`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

import {
  expandirLink,
  sanitizarUrl,
  desembrulharAfiliadoRedirecionador,
  desembrulharVerificacaoMeli,
  extrairImagemProduto,
  extrairImagemDaLoja,
  extrairImagemDeUrl,
} from '../src/linkResolver.js';
import {
  converterParaAfiliado,
  chaveProduto,
  ehPaginaNaoProduto,
  paramsRemoverPara,
  perfilDeUrl,
  resolverMergulhador,
} from '../src/affiliates/index.js';
import { imagemPelaApiDaLoja } from '../src/lojaApi.js';
import config from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'links-ouvidos.json');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Parâmetro de rastreio que cada loja aplica (fonte: src/affiliates/<loja>.js). */
const PARAM_ESPERADO = {
  Amazon: 'tag',
  MercadoLivre: 'matt_tool',
  Shopee: 'af_siteid', // fallback; o short link oficial não carrega query
  Shein: 'aff_id',
  TikTokShop: 'affiliate_id',
};

/** Nosso tracking pode estar na query OU embutido num short link oficial. */
const HOSTS_SHORT_DE_AFILIADO = [/^s\.shopee\.com\.br$/i, /^shope\.ee$/i];

/** Só dígitos/letras, para comparar "MLB-123-_JM" com "MLB123". */
const normalizar = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '');

/** Todos os IDs que identificam a NOSSA conta de afiliado. */
function nossosIds() {
  const a = config.afiliados;
  const ids = new Set();
  const add = (v) => v && ids.add(String(v));
  add(a.mercadolivre.affiliateId);
  add(a.amazon.tag);
  add(a.shopee.appId);
  add(a.shein.affiliateId);
  add(a.tiktokshop.affiliateId);
  add(a.magalu.loja);
  for (const g of a.genericos) add(g.valor);
  return ids;
}

/** O rastreio está no link final? */
function rastreioNoLink(link, loja, ids) {
  let host = '';
  try {
    const u = new URL(link);
    host = u.hostname;
    for (const [chave, valor] of u.searchParams) {
      if (ids.has(valor)) return { ok: true, detalhe: `${chave}=${valor}` };
    }
  } catch {
    return { ok: false, detalhe: 'link inválido' };
  }
  if (HOSTS_SHORT_DE_AFILIADO.some((r) => r.test(host))) {
    return { ok: true, detalhe: `short link (${host})` };
  }
  const esperado = PARAM_ESPERADO[loja];
  if (!esperado) return { ok: null, detalhe: `n/d (formato próprio de ${loja})` };
  return { ok: false, detalhe: `falta ${esperado} com o nosso id` };
}

/** Abre o link final seguindo redirects. */
async function abrir(link) {
  const res = await axios.get(link, {
    timeout: 25000,
    maxRedirects: 6,
    validateStatus: () => true,
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });
  const finalUrl = res?.request?.res?.responseUrl || link;
  return { status: res.status, finalUrl };
}

/** O produto da entrada aparece no destino? */
function produtoNoDestino(chave, urlEntrada, urlFinal) {
  const alvo = normalizar(urlFinal);
  const tokens = [];
  if (chave) tokens.push(chave.split(':').slice(1).join('')); // "meli:MLB123" → "MLB123"
  for (const run of String(urlEntrada).match(/\d{6,}/g) || []) tokens.push(run);
  return tokens.some((t) => t && alvo.includes(normalizar(t)));
}

/**
 * Cascata de imagem SEM a foto da mensagem (o fixture é só o link).
 * Mesma ordem de src/app.js: site (og:image) → galeria → API da loja →
 * placeholder. Devolve a origem e o tamanho: é o que diz se a publicação vai
 * mostrar o produto ou um cartão genérico que não converte.
 */
async function resolverImagem(urlProduto, loja, chave) {
  const medir = (r) => ({ origem: r.origem, kb: Math.round(r.base64.length / 1024) });
  try {
    const og = await extrairImagemProduto(urlProduto);
    if (og) return medir(og);
  } catch {
    /* segue a cascata */
  }
  try {
    const galeria = await extrairImagemDaLoja(urlProduto);
    if (galeria) return medir(galeria);
  } catch {
    /* segue a cascata */
  }
  try {
    const urlImagem = chave ? await imagemPelaApiDaLoja(loja, chave) : null;
    if (urlImagem) {
      const baixada = await extrairImagemDeUrl(urlImagem);
      if (baixada) return medir(baixada);
    }
  } catch {
    /* segue a cascata */
  }
  return { origem: 'PLACEHOLDER', kb: 0 };
}

/**
 * Um link: reproduz a MESMA ordem do pipeline de src/app.js (processarOferta)
 * e depois abre o link final na rede.
 */
async function verificar(item, ids) {
  const registro = { rotulo: item.rotulo || '', entrada: item.url };

  // 1) expandir → desembrulhar verificação do ML → desembrulhar rede de afiliado
  let expandida;
  try {
    expandida = desembrulharAfiliadoRedirecionador(
      desembrulharVerificacaoMeli(await expandirLink(item.url)),
    );
  } catch (erro) {
    return { ...registro, veredito: 'FAIL', motivo: `expansão falhou: ${erro.message}` };
  }
  let alvo = sanitizarUrl(expandida, paramsRemoverPara(expandida));
  registro.expandida = expandida;

  // 2) Loja conhecida sem credencial: descarta antes de baixar HTML.
  const perfil = perfilDeUrl(alvo);
  if (perfil && !perfil.ativa) {
    return { ...registro, loja: perfil.loja, veredito: 'SKIP', motivo: `falta ${perfil.faltantes.join(', ')} no .env` };
  }

  // 3) Página intermediária (perfil/vitrine/social) → mergulhar para achar o produto.
  const mergulhador = resolverMergulhador(alvo);
  if (mergulhador) {
    registro.mergulhador = mergulhador.nome;
    let urlProduto = null;
    try {
      urlProduto = await mergulhador.extrair(expandida);
    } catch (erro) {
      return { ...registro, veredito: 'FAIL', motivo: `mergulhador falhou: ${erro.message}` };
    }
    if (!urlProduto) {
      return { ...registro, veredito: 'SKIP', motivo: `produto não encontrado em ${mergulhador.nome}` };
    }
    alvo =
      expandida === urlProduto
        ? alvo
        : sanitizarUrl(urlProduto, paramsRemoverPara(urlProduto));
  }

  // 4) Não é produto (vitrine/landing/convite)?
  if (ehPaginaNaoProduto(alvo)) {
    return { ...registro, veredito: 'SKIP', motivo: 'não é página de produto' };
  }
  registro.produto = alvo;

  const chave = chaveProduto(alvo);
  registro.chave = chave || '(sem identidade)';

  // 5) Conversão
  const { meuLink, loja, motivo } = await converterParaAfiliado(alvo, expandida);
  registro.loja = loja;
  if (motivo === 'sem-credencial') {
    return { ...registro, veredito: 'SKIP', motivo: 'loja sem credencial no .env' };
  }
  if (!meuLink) {
    return { ...registro, veredito: 'FAIL', motivo: `conversão: ${motivo}` };
  }
  registro.nossoLink = meuLink;

  // 6) Validação pós-conversão (a mesma do app): mesmo produto, mesma loja.
  const lojaOriginal = perfilDeUrl(alvo)?.loja || null;
  const lojaGerada = perfilDeUrl(meuLink)?.loja || null;
  if (!lojaGerada || (lojaOriginal && lojaGerada !== lojaOriginal)) {
    return {
      ...registro,
      veredito: 'FAIL',
      motivo: `link gerado fora da loja original (${lojaOriginal || '?'} → ${lojaGerada || meuLink})`,
    };
  }
  if (chave) {
    let chaveGerada = chaveProduto(meuLink);
    if (!chaveGerada) {
      try {
        chaveGerada = chaveProduto(await expandirLink(meuLink));
      } catch {
        /* comparação fica só no domínio */
      }
    }
    registro.chaveGerada = chaveGerada || '(não confirmada)';
    if (chaveGerada && chaveGerada !== chave) {
      return {
        ...registro,
        veredito: 'FAIL',
        motivo: `produto divergente: entrada ${chave} x gerado ${chaveGerada}`,
      };
    }
  }

  // 6.5) Imagem: o que seria publicado — foto do produto ou placeholder?
  //      Sem isso, "publicou com sucesso" esconde o cartão genérico que não vende.
  const imagem = await resolverImagem(alvo, loja, chave);
  registro.imagem = imagem.origem;
  registro.imagemKb = imagem.kb;

  // 7) Rastreio no link final
  const rastreio = rastreioNoLink(meuLink, loja, ids);
  registro.rastreio = rastreio.detalhe;
  if (rastreio.ok === false) {
    return { ...registro, veredito: 'FAIL', motivo: rastreio.detalhe };
  }

  // 8) Rede: o link abre o produto?
  let http;
  try {
    http = await abrir(meuLink);
  } catch (erro) {
    return { ...registro, veredito: 'FAIL', motivo: `rede: ${erro.message}` };
  }
  registro.http = http.status;
  registro.destino = http.finalUrl;
  const produtoOk = produtoNoDestino(chave, alvo, http.finalUrl);
  registro.produtoNoDestino = produtoOk;

  if (http.status >= 400) {
    return { ...registro, veredito: 'FAIL', motivo: `HTTP ${http.status}` };
  }
  if (!produtoOk) {
    return { ...registro, veredito: 'FAIL', motivo: 'destino não contém o produto' };
  }
  return { ...registro, veredito: rastreio.ok === null ? 'SKIP' : 'PASS', motivo: '' };
}

function carregarEntradas(argv) {
  const urls = argv.filter((a) => !a.startsWith('--'));
  if (urls.length) return urls.map((url) => ({ rotulo: '', url }));
  if (!fs.existsSync(FIXTURE)) {
    console.error(`Fixture não encontrado: ${FIXTURE}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

async function principal() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  if (json) {
    // As libs (linkResolver, providers) logam no console. Em --json a saída
    // tem de ser JSON puro: o exit code continua sinalizando o resultado.
    console.log = () => {};
    console.warn = () => {};
  }
  const entradas = carregarEntradas(argv);
  const ids = nossosIds();

  if (!ids.size) {
    console.error('Nenhum id de afiliado no .env — o teste não teria o que verificar.');
    process.exit(1);
  }

  const resultados = [];
  for (let i = 0; i < entradas.length; i++) {
    if (!json) console.log(`\n[${i + 1}/${entradas.length}] ${entradas[i].url}`);
    const r = await verificar(entradas[i], ids);
    resultados.push(r);
    if (json) continue;
    if (r.mergulhador) console.log(`   mergulhou : ${r.mergulhador}`);
    console.log(`   loja      : ${r.loja || '?'} · ${r.chave || '?'}`);
    if (r.expandida && r.expandida !== r.produto) {
      console.log(`   expandida : ${r.expandida.slice(0, 110)}`);
    }
    if (r.produto) console.log(`   produto   : ${r.produto.slice(0, 110)}`);
    if (r.nossoLink) console.log(`   nosso link: ${r.nossoLink.slice(0, 110)}`);
    if (r.chaveGerada) console.log(`   chave ger.: ${r.chaveGerada}`);
    if (r.imagem) {
      const comoPublica =
        r.imagem === 'PLACEHOLDER'
          ? 'PLACEHOLDER (cartão genérico — não converte)'
          : `${r.imagem} (${r.imagemKb} KB)`;
      console.log(`   imagem    : ${comoPublica}`);
    }
    if (r.http) {
      console.log(
        `   http      : ${r.http} · produto no destino: ${r.produtoNoDestino ? 'sim' : 'NAO'}`,
      );
    }
    if (r.rastreio) console.log(`   rastreio  : ${r.rastreio}`);
    console.log(`   → ${r.veredito}${r.motivo ? ` — ${r.motivo}` : ''}`);
  }

  const conta = (v) => resultados.filter((r) => r.veredito === v).length;
  const semImagem = resultados.filter((r) => r.imagem === 'PLACEHOLDER').length;
  const comFoto = resultados.filter((r) => r.imagem && r.imagem !== 'PLACEHOLDER').length;
  const resumo = {
    total: resultados.length,
    pass: conta('PASS'),
    fail: conta('FAIL'),
    skip: conta('SKIP'),
    imagensDoProduto: comFoto,
    placeholders: semImagem,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify({ resumo, resultados }, null, 2)}\n`);
  } else {
    console.log(
      `\nIMAGENS: ${comFoto} com foto do produto · ${semImagem} placeholder${
        semImagem ? '  ← cartão genérico não converte' : ''
      }`,
    );
    console.log(
      `RESULTADO: ${resumo.pass} PASS · ${resumo.fail} FAIL · ${resumo.skip} SKIP (de ${resumo.total})`,
    );
  }
  const falharPlaceholder = argv.includes('--falhar-placeholder');
  process.exit(resumo.fail > 0 || (falharPlaceholder && semImagem > 0) ? 1 : 0);
}

principal().catch((erro) => {
  console.error(`💥 Verificação falhou: ${erro.message}`);
  process.exit(1);
});

