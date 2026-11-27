/**
 * recompor-acervo.mjs — regera os stories do acervo com as regras ATUAIS.
 *
 * POR QUÊ: a FEAT-011 mudou preço (cupom não é preço), título (og:title) e CTA
 * ("LINK NA BIO"). O que já foi composto tem as regras ANTIGAS desenhadas no
 * JPEG — corrigir o código não reescreve arquivo existente.
 *
 * Fonte: `fila_envio` guarda `imagem_base64` e `meu_link` de cada oferta
 * pendente, então dá para recompor sem baixar mídia de novo. Oferta já enviada
 * sai da fila e não tem mais a foto original — essas não são recomponíveis.
 *
 * O nome do arquivo é o hash da FOTO (`nomeDaMidia`), então recompor sobrescreve
 * o story anterior: não sobra lixo em `data/midia/`.
 *
 *   npm run recompor             # aplica
 *   npm run recompor -- --seco   # só relata
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import config from '../src/config.js';
import { precoPelaApiDaLoja } from '../src/lojaApi.js';
import { chaveProduto } from '../src/affiliates/index.js';
import { resolverPreco } from '../src/midia/preco.js';
import { caminhoAcervo, carregarAcervo } from '../src/midia/acervo.js';
import { chaveSegura, registrarOferta } from '../src/oferta.js';

const seco = process.argv.includes('--seco');

const db = new Database(`${config.caminhos.data}/ofertas.db`, { readonly: true });
const linhas = db
  .prepare(
    'SELECT id, loja, titulo, mensagem, url_limpa, imagem_base64, meu_link FROM fila_envio ORDER BY id',
  )
  .all();
db.close();

const acervoAntes = carregarAcervo(config.publicacao.midiaDir);
console.log(
  `🔄 recompor-acervo · ${linhas.length} oferta(s) na fila · acervo com ${Object.keys(acervoAntes).length} story(s)` +
    `${seco ? ' · MODO SECO (nada será gravado)' : ''}\n`,
);

const contagem = { refeito: 0, semPreco: 0, semChave: 0, semFoto: 0, erro: 0 };
const refeitas = [];

for (const linha of linhas) {
  const chave = chaveProduto(linha.url_limpa) || chaveProduto(linha.meu_link || '');
  if (!chave) {
    contagem.semChave += 1;
    console.log(`   ↷ #${linha.id} sem identidade de produto — pulando`);
    continue;
  }
  if (!linha.imagem_base64) {
    contagem.semFoto += 1;
    console.log(`   ↷ #${linha.id} sem foto guardada — pulando`);
    continue;
  }

  const preco = resolverPreco({
    texto: linha.mensagem,
    daApi: await precoPelaApiDaLoja(linha.loja, chave),
  });
  if (!preco) {
    contagem.semPreco += 1;
    console.log(`   ↷ #${linha.id} ${chaveSegura(chave)} sem preço confiável — sem story`);
    continue;
  }

  if (seco) {
    contagem.refeito += 1;
    refeitas.push({ chave: chaveSegura(chave), preco: preco.atual });
    console.log(`   ✓ #${linha.id} ${chaveSegura(chave)} R$ ${preco.atual} (seco)`);
    continue;
  }

  try {
    const r = await registrarOferta({
      chave,
      link: linha.meu_link,
      preco: preco.atual,
      titulo: linha.titulo || '',
      imagemBase64: linha.imagem_base64,
    });
    if (r.acervo) {
      contagem.refeito += 1;
      refeitas.push({ chave: r.chave, preco: preco.atual, arquivo: r.arquivo });
      console.log(`   ✓ #${linha.id} ${r.chave} R$ ${preco.atual} → ${r.arquivo}`);
    } else {
      contagem[r.motivo === 'sem-foto' ? 'semFoto' : 'semPreco'] += 1;
      console.log(`   ↷ #${linha.id} ${r.chave} não virou story (${r.motivo})`);
    }
  } catch (erro) {
    contagem.erro += 1;
    console.warn(`   ⚠️  #${linha.id} falhou: ${erro.message}`);
  }
}

console.log(
  `\n📊 recompostos: ${contagem.refeito} · sem preço: ${contagem.semPreco} · ` +
    `sem chave: ${contagem.semChave} · sem foto: ${contagem.semFoto} · erros: ${contagem.erro}`,
);

if (!seco) {
  const acervo = carregarAcervo(config.publicacao.midiaDir);
  const legado = Object.keys(acervo).filter(
    (chave) => !refeitas.some((r) => r.chave === chave),
  );
  if (legado.length) {
    console.log(
      `\n⚠️  ${legado.length} story(s) NÃO recompostos (sem foto na fila — já enviados).` +
        '\n   Estes mantêm preço/CTA antigos; evite publicá-los:',
    );
    for (const chave of legado) {
      console.log(`     ${chave} · R$ ${acervo[chave].preco} · ${acervo[chave].titulo || '-'}`);
    }

    // Quarentena: tira do acervo ATIVO (é o que a publicação automática lê) sem
    // perder nada — o arquivo com as entradas antigas fica em `acervo-legado.json`.
    if (process.argv.includes('--quarentena')) {
      const ativo = { ...acervo };
      const quarentena = {};
      for (const chave of legado) {
        quarentena[chave] = ativo[chave];
        delete ativo[chave];
      }
      fs.writeFileSync(
        path.join(config.publicacao.midiaDir, 'acervo-legado.json'),
        `${JSON.stringify(quarentena, null, 2)}\n`,
      );
      fs.writeFileSync(
        caminhoAcervo(config.publicacao.midiaDir),
        `${JSON.stringify(ativo, null, 2)}\n`,
      );
      console.log(
        `\n🧹 ${legado.length} story(s) movidos para acervo-legado.json — fora da fila de publicação.`,
      );
    } else {
      console.log('\n   (use --quarentena para tirá-los do acervo ativo)');
    }
  }
}
