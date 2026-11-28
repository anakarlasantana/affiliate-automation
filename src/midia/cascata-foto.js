/**
 * cascata-foto.js — qual foto vai na oferta (FEAT-017).
 *
 * POR QUÊ existe: em 28/11 a produção baixou uma foto 1218×1218 da mensagem e
 * enviou **placeholder**. A cascata vivia dentro de `processarOferta` (1.900
 * linhas), sem plano B: quando `FONTES_FOTO_SOMENTE_SITE` pedia o site e o
 * Mercado Livre devolvia **captcha** (HTTP 200 sem `og:image`), a foto boa que
 * já estava na mão era descartada e caía no genérico de emergência.
 *
 * A regra nova é simples: **foto real sempre vence o placeholder**, e a foto da
 * mensagem é o plano B — nunca a primeira escolha quando a fonte pedida é o site.
 *
 * Tudo aqui é função pura com dependências injetáveis (padrão do repositório):
 * o teste roda sem rede, sem ffmpeg e sem WhatsApp.
 */
import fs from 'node:fs';
import path from 'node:path';

/** O placeholder que a operação escolheu (assets do projeto). */
export const PLACEHOLDER_RELATIVO = path.join(
  'assets',
  'placeholder-confira-produto.png',
);

/**
 * Um HTML é página de produto, captcha ou página vazia?
 *
 * POR QUÊ: a página de bloqueio do Mercado Livre responde **HTTP 200** com ~43 KB
 * e sem `og:image`. Tratá-la como "página válida sem foto" esconde a causa — e
 * foi assim que o log passou a mentir por horas.
 *
 * @param {string} html
 * @returns {'produto'|'captcha'|'vazia'}
 */
export function classificarPagina(html) {
  const bruto = String(html || '');
  if (!bruto.trim()) return 'vazia';

  const temOgImage = /property=["']og:image["']/i.test(bruto);
  const bloqueio =
    /captcha|not a robot|robot check|verify you are human|Verifique que voc|acesso negado/i.test(
      bruto,
    );
  const titulo = (bruto.match(/<title[^>]*>([^<]{0,60})<\/title>/i) || [])[1] || '';
  const tituloGenerico = /^(mercado ?livre|mercado libre)$/i.test(titulo.trim());

  if (temOgImage && !bloqueio) return 'produto';
  if (bloqueio || (tituloGenerico && !temOgImage)) return 'captcha';
  return 'vazia';
}

/**
 * Resolve o arquivo do placeholder: caminho configurado **se existir**, senão o
 * padrão relativo à raiz do projeto.
 *
 * POR QUÊ: o `.env` da VPS trouxe `PLACEHOLDER_IMAGEM=/home/sn-387116/…` (do
 * notebook). O arquivo existia no servidor, no caminho certo — só o ponteiro
 * estava errado. Aqui um caminho inválido nunca deixa a oferta sem imagem.
 *
 * @param {{raiz?:string, caminhoConfigurado?:string, existe?:Function}} [opcoes]
 * @returns {{arquivo:string|null, motivo:string}}
 */
export function caminhoDoPlaceholder({
  raiz = process.cwd(),
  caminhoConfigurado = '',
  existe = fs.existsSync,
} = {}) {
  const configurado = String(caminhoConfigurado || '').trim();
  if (configurado && existe(configurado)) {
    return { arquivo: configurado, motivo: 'configurado' };
  }

  const padrao = path.join(raiz, PLACEHOLDER_RELATIVO);
  if (existe(padrao)) {
    return {
      arquivo: padrao,
      motivo: configurado ? 'configurado-invalido-usando-padrao' : 'padrao',
    };
  }
  return { arquivo: null, motivo: 'ausente' };
}
/** Base64 de um arquivo (data-URL), ou null. */
function arquivoParaDataUrl(arquivo) {
  try {
    const buf = fs.readFileSync(arquivo);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * A cascata: devolve a melhor foto possível e **prova** por onde passou.
 *
 * Ordem (CA-4): site → API → **foto da mensagem (plano B)** → placeholder.
 * Quando a fonte pedida é a mensagem (fora de `FONTES_FOTO_SOMENTE_SITE`), ela
 * já é a primeira da fila.
 *
 * @param {{
 *   fotoMensagem?: string|null,
 *   origemMensagem?: string,
 *   preferirSite?: boolean,
 *   buscarNoSite?: () => Promise<{base64?:string, origem?:string}|null>,
 *   buscarNaApi?: () => Promise<{base64?:string, origem?:string}|null>,
 *   placeholder?: {arquivo:string|null, motivo:string},
 *   dimensoes?: (base64:string) => {largura:number, altura:number}|null,
 *   avisar?: (msg:string) => void,
 * }} [opcoes]
 * @returns {Promise<{base64:string|null, origem:string, motivo:string, tentativas:object[]}>}
 */
export async function resolverFotoDaOferta({
  fotoMensagem = null,
  origemMensagem = 'mensagem:download',
  preferirSite = false,
  /**
   * FEAT-021: quando `preferirSite` e verdadeiro (grupo em FONTES_FOTO_SOMENTE_SITE),
   * o chamador pode desligar o plano B. Nesses grupos a foto da mensagem e o
   * CARD DA MARCA -- manda-la ao feed e pior que usar o placeholder.
   */
  permitirPlanoB = true,
  buscarNoSite = async () => null,
  buscarNaApi = async () => null,
  placeholder = { arquivo: null, motivo: 'nao-informado' },
  dimensoes = () => null,
  avisar = () => {},
} = {}) {
  const tentativas = [];
  const registrar = (fonte, resultado, motivo) => {
    tentativas.push({ fonte, ok: Boolean(resultado), motivo });
  };

  const daMensagem = fotoMensagem
    ? { base64: fotoMensagem, origem: origemMensagem }
    : null;

  // A foto da mensagem entra no começo ou como PLANO B, conforme a regra.
  const fontes = [];
  if (!preferirSite && daMensagem) fontes.push(['mensagem', async () => daMensagem]);
  if (preferirSite) fontes.push(['site', buscarNoSite]);
  else fontes.push(['site', buscarNoSite]);
  fontes.push(['api', buscarNaApi]);
  if (preferirSite && daMensagem && permitirPlanoB) {
    fontes.push(['mensagem', async () => daMensagem]);
  }

  for (const [nome, buscar] of fontes) {
    let achado = null;
    try {
      achado = await buscar();
    } catch (erro) {
      registrar(nome, null, `erro: ${erro.message}`);
      avisar(`   ↷ foto: ${nome} falhou (${erro.message}) — tentando a próxima`);
      continue;
    }
    if (achado?.base64) {
      const dim = dimensoes(achado.base64);
      registrar(nome, achado, dim ? `${dim.largura}x${dim.altura}` : 'ok');
      return {
        base64: achado.base64,
        origem: achado.origem || nome,
        motivo: null,
        tentativas,
      };
    }
    registrar(nome, null, 'sem-foto');
    avisar(`   ↷ foto: ${nome} não entregou imagem — tentando a próxima`);
  }

  // CA-6: nenhuma fonte entregou — usa o placeholder DA APLICAÇÃO e mantém a oferta.
  const base64 = placeholder?.arquivo ? arquivoParaDataUrl(placeholder.arquivo) : null;
  registrar('placeholder', base64 ? { base64 } : null, placeholder?.motivo || 'ausente');

  return {
    base64,
    origem: 'placeholder',
    motivo: base64 ? null : 'sem-placeholder',
    tentativas,
  };
}

/**
 * Linha única de log por oferta (CA-8).
 * @param {{origem?:string, origemFoto?:string, base64?:string|null}} resultado
 * @param {(base64:string)=>{largura:number,altura:number}|null} [dimensoes]
 * @param {(base64:string)=>{kb:number}} [tamanho]
 */
export function linhaDaFoto(resultado = {}, dimensoes = () => null, tamanho = () => ({ kb: 0 })) {
  const origem = resultado.origem || resultado.origemFoto || '?';
  if (!resultado.base64) return `📸 foto=ausente · fonte=${origem} · oferta mantida sem imagem`;
  const dim = dimensoes(resultado.base64);
  const { kb } = tamanho(resultado.base64) || { kb: 0 };
  const medida = dim ? `${dim.largura}x${dim.altura}` : 'dimensao-desconhecida';
  return `📸 foto=${medida} · fonte=${origem} · ${kb}KB`;
}

