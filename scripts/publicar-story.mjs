#!/usr/bin/env node
/**
 * publicar-story.mjs — publica UM story a partir do acervo, com guardas.
 *
 * Uso: npm run publicar -- <chave> [--preco 149.90]
 *
 * Não passa pelo WhatsApp: serve para testar o canal no Instagram de forma
 * controlada (1 story, resultado visível). Recusa quando a flag está desligada,
 * falta credencial, falta URL pública, falta preço ou a chave não está no acervo.
 *
 * Log no MESMO padrão do app — prefixo `[ig]` e espelho em `logs/app.log` — para
 * o caminho manual ser monitorável igual ao automático (FEAT-012 · CA-10).
 */
import fs from 'node:fs';
import path from 'node:path';

import config from '../src/config.js';
import { publicarDoAcervo } from '../src/canais/publicacao.js';

const PREFIXO = '[ig]';
const arquivoLog = path.join(config.caminhos.root, 'logs', 'app.log');

/**
 * Escreve no terminal E no espelho do app.
 * `appendFileSync` de propósito: o script chama `process.exit()` e o buffer de
 * um stream assíncrono se perderia.
 */
function registrar(mensagem, { erro = false } = {}) {
  const saida = erro ? console.error : console.log;
  saida(mensagem);
  try {
    fs.mkdirSync(path.dirname(arquivoLog), { recursive: true });
    fs.appendFileSync(
      arquivoLog,
      `${new Date().toISOString()} [manual] ${mensagem}\n`,
    );
  } catch {
    // sem arquivo de log o terminal continua valendo
  }
}

const args = process.argv.slice(2);
const chave = args.find((a) => !a.startsWith('--'));
const posicaoPreco = args.indexOf('--preco');
const preco = posicaoPreco >= 0 ? Number(args[posicaoPreco + 1]) : undefined;

if (!chave) {
  registrar(
    `⚠️  ${PREFIXO} uso: npm run publicar -- <chave> [--preco 149.90]\n` +
      '   as chaves ficam em data/midia/acervo.json (geradas por `npm run ensaiar`)',
    { erro: true },
  );
  process.exit(1);
}

const resultado = await publicarDoAcervo({ chave, preco });

if (!resultado.publicado) {
  registrar(`⛔ ${PREFIXO} Recusado: ${resultado.motivo} · story segue pendente`, {
    erro: true,
  });
  if (resultado.erro) registrar(`   ${resultado.erro}`, { erro: true });
  if (resultado.disponiveis?.length) {
    registrar(`   chaves no acervo: ${resultado.disponiveis.join(', ')}`, {
      erro: true,
    });
  }
  process.exit(2);
}

registrar(`✅ ${PREFIXO} Publicado · mediaId ${resultado.mediaId}`);
registrar(`   imagem : ${resultado.imagemUrl}`);
registrar(`   legenda: ${String(resultado.legenda).replace(/\n/g, ' / ')}`);
registrar(
  `   quota  : ${resultado.quota?.usada ?? '?'}/${resultado.quota?.total ?? '?'}`,
);

