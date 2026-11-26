#!/usr/bin/env node
/**
 * publicar-story.mjs — publica UM story a partir do acervo, com guardas.
 *
 * Uso: npm run publicar -- <chave> [--preco 149.90]
 *
 * Não passa pelo WhatsApp: serve para testar o canal no Instagram de forma
 * controlada (1 story, resultado visível). Recusa quando a flag está desligada,
 * falta credencial, falta URL pública, falta preço ou a chave não está no acervo.
 */
import { publicarDoAcervo } from '../src/canais/publicacao.js';

const args = process.argv.slice(2);
const chave = args.find((a) => !a.startsWith('--'));
const posicaoPreco = args.indexOf('--preco');
const preco = posicaoPreco >= 0 ? Number(args[posicaoPreco + 1]) : undefined;

if (!chave) {
  console.error('uso: npm run publicar -- <chave> [--preco 149.90]');
  console.error('   as chaves ficam em data/midia/acervo.json (geradas por `npm run ensaiar`)');
  process.exit(1);
}

const resultado = await publicarDoAcervo({ chave, preco });

if (!resultado.publicado) {
  console.error(`⛔ recusado: ${resultado.motivo}`);
  if (resultado.erro) console.error(`   ${resultado.erro}`);
  if (resultado.disponiveis?.length) {
    console.error(`   chaves no acervo: ${resultado.disponiveis.join(', ')}`);
  }
  process.exit(2);
}

console.log(`✅ story publicado · mediaId ${resultado.mediaId}`);
console.log(`   imagem : ${resultado.imagemUrl}`);
console.log(`   legenda: ${String(resultado.legenda).replace(/\n/g, ' / ')}`);
console.log(`   quota  : ${resultado.quota?.usada ?? '?'}/${resultado.quota?.total ?? '?'}`);
