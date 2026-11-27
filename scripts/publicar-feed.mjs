#!/usr/bin/env node
/**
 * publicar-feed.mjs — publica UM post no feed a partir de uma foto + acervo.
 *
 * Uso:
 *   npm run publicar:feed -- <chave> --foto /caminho/foto.jpg [--formato post]
 *   npm run publicar:feed -- <chave> --foto foto.jpg --seco
 *
 * O que ele faz, em ordem: compõe o criativo 4:5 no template da marca, monta a
 * legenda (FEAT-014), confere a mídia pública (o preflight que faltava em 27/11),
 * publica o container e grava a publicação numa chave POR FORMATO (`<chave>:post`)
 * — é o que permite story e post do mesmo produto sem um bloquear o outro.
 *
 * Log no padrão do app (`[ig]` + `logs/app.log`), como o publicar de story.
 */
import fs from 'node:fs';
import path from 'node:path';

import config from '../src/config.js';
import { publicarFeed } from '../src/canais/instagram.js';
import { buscarNoAcervo, marcarPublicado, registrarNoAcervo } from '../src/midia/acervo.js';
import { comporFeed } from '../src/midia/feed.js';
import { dimensoesImagem } from '../src/imagem.js';
import { textosDoStory } from '../src/midia/compor.js';
import { legendaDoFeed, lojaDoLink } from '../src/midia/legenda.js';
import { preflight } from '../src/publicacao/automatica.js';

const PREFIXO = '[ig]';
const arquivoLog = path.join(config.caminhos.root, 'logs', 'app.log');

function registrar(mensagem, { erro = false } = {}) {
  (erro ? console.error : console.log)(mensagem);
  try {
    fs.mkdirSync(path.dirname(arquivoLog), { recursive: true });
    fs.appendFileSync(arquivoLog, `${new Date().toISOString()} [manual] ${mensagem}\n`);
  } catch {
    // terminal continua valendo
  }
}

const args = process.argv.slice(2);
const chave = args.find((a) => !a.startsWith('--'));
const posFoto = args.indexOf('--foto');
const foto = posFoto >= 0 ? args[posFoto + 1] : null;
const posFormato = args.indexOf('--formato');
const formato = posFormato >= 0 ? args[posFormato + 1] : 'post';
const seco = args.includes('--seco');

if (!chave || !foto) {
  registrar(
    `⚠️  ${PREFIXO} uso: npm run publicar:feed -- <chave> --foto <arquivo> [--formato post] [--seco]`,
    { erro: true },
  );
  process.exit(1);
}
if (!fs.existsSync(foto)) {
  registrar(`⛔ ${PREFIXO} foto não encontrada: ${foto}`, { erro: true });
  process.exit(1);
}

const midiaDir = config.publicacao.midiaDir;
const registro = buscarNoAcervo(midiaDir, chave);
if (!registro) {
  registrar(`⛔ ${PREFIXO} chave fora do acervo: ${chave}`, { erro: true });
  process.exit(2);
}
if (!config.instagram.publicarStories) {
  registrar(`🛑 ${PREFIXO} parado: PUBLICAR_STORIES=0`, { erro: true });
  process.exit(3);
}

// 1) criativo 4:5
const buffer = fs.readFileSync(foto);
const sufixo = path.basename(registro.arquivo || `${chave}.jpg`, path.extname(registro.arquivo || '.jpg'));
const nomeArquivo = `${sufixo}-post.jpg`;
const saida = path.join(midiaDir, nomeArquivo);

const textos = textosDoStory(
  { atual: registro.preco, antigo: null, desconto: null },
  config.publicacao.goDestino || 'oferta',
);
await comporFeed({
  foto,
  dimensoesFoto: dimensoesImagem(buffer),
  textos: { titulo: registro.titulo || '', ...textos },
  saida,
});
registrar(`🖼️  ${PREFIXO} criativo do feed: ${nomeArquivo}`);

// 2) legenda
const legenda = legendaDoFeed({
  titulo: registro.titulo,
  preco: { atual: registro.preco },
  loja: lojaDoLink(registro.link),
  goDestino: config.publicacao.goDestino,
  convite: config.whatsapp.meuGrupoLink,
  incluirConvite: config.whatsapp.feedConviteNaLegenda,
});

// 3) preflight (a Meta precisa baixar; sem isso é 9004)
const imagemUrl = `${config.publicacao.baseUrl}/midia/${nomeArquivo}`;
const checagem = await preflight({
  baseUrl: config.publicacao.baseUrl,
  arquivo: nomeArquivo,
});
if (!checagem.ok) {
  registrar(`⛔ ${PREFIXO} mídia inacessível (${checagem.detalhe || checagem.motivo}) — não publica`, {
    erro: true,
  });
  process.exit(4);
}
registrar(`🔎 ${PREFIXO} preflight ok · ${checagem.tipo} ${Math.round((checagem.bytes || 0) / 1024)}KB`);

if (seco) {
  registrar(`🧪 ${PREFIXO} --seco: pararia aqui.\n---\n${legenda}`);
  process.exit(0);
}

// 4) publica
const mediaId = await publicarFeed(
  config.instagram,
  { formato, imagens: [imagemUrl], legenda },
  { tentativas: 10, esperaMs: 6_000 },
);
registrar(`✅ ${PREFIXO} Publicado no feed · mediaId ${mediaId} · formato ${formato}`);

// 5) acervo: chave POR FORMATO (story e post do mesmo produto não se bloqueiam)
const chavePost = `${chave}:${formato}`;
registrarNoAcervo(midiaDir, chavePost, {
  arquivo: nomeArquivo,
  link: registro.link,
  preco: registro.preco,
  titulo: registro.titulo,
});
marcarPublicado(midiaDir, chavePost, { mediaId });
registrar(`🗂️  ${PREFIXO} acervo: ${chavePost} marcado como publicado`);
registrar(`   legenda: ${legenda.split('\n')[0]}`);
