/**
 * status.js — Mostra a fila de envio atual.
 * Uso: npm run status
 */
import fs from 'node:fs';

const caminho = 'data/fila-status.json';
if (!fs.existsSync(caminho)) {
  console.log('Sem dados de status ainda (o app precisa rodar ao menos uma vez).');
  process.exit(0);
}

const s = JSON.parse(fs.readFileSync(caminho, 'utf8'));
console.log(`\n📦 FILA DE ENVIO — atualizado em ${s.atualizadoEm}`);
console.log(`   Enviadas hoje: ${s.enviadasHoje}`);
if (s.pausada) console.log(`   ⛔ Pausada: ${s.pausada}`);
if (s.proximoEnvioSegundos) console.log(`   Proximo envio em ~${s.proximoEnvioSegundos}s`);

if (!s.pendentes || s.pendentes.length === 0) {
  console.log('   Fila vazia. Nada aguardando envio.\n');
} else {
  console.log(`   ${s.pendentes.length} oferta(s) aguardando:`);
  for (const p of s.pendentes) {
    console.log(`     ${p.posicao}. [${p.loja}] ${p.titulo}`);
  }
  console.log('');
}
