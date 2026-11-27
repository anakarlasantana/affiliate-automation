/**
 * oferta.js — o único ponto que liga o pipeline ao acervo e ao link curto.
 *
 * POR QUE existe: até a FEAT-008 apenas o ENSAIO gravava `go-destinos.json` e o
 * acervo. No servidor, `/go/<chave>` responderia 404 e `npm run publicar` não
 * teria chave nenhuma. Aqui o `app.js` registra a oferta do jeito que o resto do
 * sistema espera: destino sempre, mídia composta quando há foto real.
 *
 * Falha aqui NUNCA pode derrubar o WhatsApp — quem chama envolve em try/catch.
 */
import fs from 'node:fs';
import path from 'node:path';

import config from './config.js';
import { dimensoesImagem } from './imagem.js';
import { registrarNoAcervo } from './midia/acervo.js';
import { comporStory, textosDoStory } from './midia/compor.js';
import { nomeDaMidia } from './midia/quadro.js';
import { carregarLayout, comporComTemplate } from './midia/layout.js';
import { registrarDestino } from './redirecionador.js';

/** Chave segura para URL: `meli:MLB123` → `meli-MLB123`. */
export function chaveSegura(chave) {
  return String(chave || '').replace(/[^A-Za-z0-9_-]/g, '-');
}

/** Composição padrão: template quando existir, senão o layout embutido. */
async function comporPadrao(opcoes = {}) {
  if (opcoes.base) return comporComTemplate(opcoes);
  return comporStory({ entrada: opcoes.foto, saida: opcoes.saida, textos: opcoes.textos });
}

/**
 * Registra a oferta convertida.
 *
 * @returns {{chave:string, destino:boolean, acervo:boolean, arquivo?:string, motivo:string|null}}
 */
export async function registrarOferta({
  chave,
  link,
  preco,
  titulo = '',
  imagemBase64 = null,
  placeholder = false,
  config: cfg = config,
  deps = {},
} = {}) {
  if (!chave) throw new Error('chave obrigatória');

  const midiaDir = deps.midiaDir || cfg.publicacao.midiaDir;
  const dataDir = deps.dataDir || cfg.caminhos.data;
  const chaveUrl = chaveSegura(chave);

  // 1) Link curto: vale mesmo sem foto (o produto existe e o `/go` tem destino).
  const arquivoDestinos = path.join(dataDir, 'go-destinos.json');
  if (link) registrarDestino(arquivoDestinos, chaveUrl, link);

  // 2) Mídia: só com foto REAL do produto (placeholder não vira story).
  if (!imagemBase64 || placeholder) {
    return { chave: chaveUrl, destino: Boolean(link), acervo: false, motivo: 'sem-foto' };
  }

  // Preço inválido não gera story (e Number(null) = 0, então o guard é explícito).
  const valorPreco = Number(preco);
  if (!Number.isFinite(valorPreco) || valorPreco <= 0) {
    return { chave: chaveUrl, destino: Boolean(link), acervo: false, motivo: 'sem-preco' };
  }

  const textos = textosDoStory(
    { atual: valorPreco, antigo: null, desconto: null },
    cfg.publicacao.goDestino || 'grupo',
  );
  if (!textos) {
    return { chave: chaveUrl, destino: Boolean(link), acervo: false, motivo: 'sem-preco' };
  }

  const compor = deps.compor || comporPadrao;
  const buffer = Buffer.from(String(imagemBase64).split(',')[1] || '', 'base64');
  const nomeArquivo = nomeDaMidia(buffer);
  const saida = path.join(midiaDir, nomeArquivo);
  fs.mkdirSync(midiaDir, { recursive: true });

  const layout = carregarLayout(path.join(cfg.caminhos.root, 'assets/template/story.json'));
  const base = path.join(cfg.caminhos.root, 'assets/template/story-base.png');
  const temTemplate = Boolean(layout) && fs.existsSync(base);

  const fotoTemporaria = path.join(midiaDir, `.tmp-${process.pid}-${Date.now()}.jpg`);
  fs.writeFileSync(fotoTemporaria, buffer);

  try {
    await compor({
      base: temTemplate ? base : null,
      foto: fotoTemporaria,
      dimensoesFoto: dimensoesImagem(buffer),
      layout,
      textos: { titulo, preco: textos.preco, de: textos.de, principal: textos.principal },
      saida,
    });
  } finally {
    fs.rmSync(fotoTemporaria, { force: true });
  }

  registrarNoAcervo(midiaDir, chaveUrl, { arquivo: nomeArquivo, link, preco, titulo });

  return { chave: chaveUrl, arquivo: nomeArquivo, destino: Boolean(link), acervo: true, motivo: null };
}
