/**
 * sendQueue.js — Fila de envio anti-ban com ritmo por horario e PERSISTENCIA.
 *
 * - Processa UM envio por vez (nunca dispara tudo junto);
 * - Delay dinamico conforme a faixa do dia:
 *     quente  (12-14h, 19-22h) -> 5-15s    (pico de compra, envia rapido)
 *     normal  (demais horas)   -> 45-120s
 *     silencio (madrugada)     -> 3-7 min  (quase congela)
 * - Respeita limite diario de envios (MAX_ENVIOS_DIA);
 * - Cada item e gravado no SQLite (tabela fila_envio): se o app reiniciar,
 *   os envios pendentes sao retomados;
 * - Mantem data/fila-status.json atualizado para consulta externa
 *   (npm run status).
 */
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import config from './config.js';
import {
  contarEnviosHoje,
  enfileirarDb,
  listarFilaDb,
  removerDaFilaDb,
} from './database.js';

const STATUS_PATH = 'data/fila-status.json';

function dentroDaJanela(hora, janelas) {
  return janelas.some(({ inicio, fim }) => hora >= inicio && hora < fim);
}

/** Escolhe a faixa de delay (segundos) conforme o horario atual. */
function faixaAtual() {
  const hora = new Date().getHours();
  const { antiban } = config;
  if (dentroDaJanela(hora, antiban.horasSilencio)) return { delay: antiban.delayFrio, rotulo: 'madrugada 🌙' };
  if (dentroDaJanela(hora, antiban.horasQuentes)) return { delay: antiban.delayQuente, rotulo: 'pico 🔥' };
  return { delay: antiban.delayNormal, rotulo: 'normal' };
}

function aleatorioEntre(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export class SendQueue {
  /**
   * @param {Function} enviador funcao async (item) => void
   */
  constructor(enviador) {
    this.enviador = enviador;
    this.fila = [];
    this.processando = false;
  }

  /**
   * Coloca um item na fila (nao bloqueia quem chamou).
   * Se o item ja existir no banco (dbId), nao duplica o registro.
   */
  enqueue(item) {
    if (!item.dbId) {
      item.dbId = enfileirarDb(item);
    }
    this.fila.push(item);
    console.log(`📥 Enfileirado (posicao ${this.fila.length}): [${item.loja || '?'}] ${item.titulo || ''}`);
    this.gravarStatus();
    void this.processar();
  }

  /**
   * Restaura do banco os envios pendentes de execucoes anteriores.
   * Chamar no boot, apos o WhatsApp conectar.
   */
  restaurarPendentes() {
    const pendentes = listarFilaDb();
    for (const row of pendentes) {
      this.enqueue({
        dbId: row.id,
        loja: row.loja,
        titulo: row.titulo,
        mensagemFinal: row.mensagem,
        urlLimpa: row.url_limpa,
        chaveFinal: row.chave_final,
        imagemBase64: row.imagem_base64,
      });
    }
    if (pendentes.length) {
      console.log(`♻️  Fila restaurada do banco: ${pendentes.length} envio(s) pendente(s) retomado(s).`);
    }
  }

  tamanho() {
    return this.fila.length;
  }

  /** Atualiza data/fila-status.json para consulta externa (npm run status). */
  gravarStatus(extra = {}) {
    try {
      const status = {
        atualizadoEm: new Date().toLocaleString('pt-BR'),
        enviadasHoje: contarEnviosHoje(),
        pendentes: this.fila.map((item, i) => ({
          posicao: i + 1,
          loja: item.loja || '?',
          titulo: item.titulo || '',
          enfileiradoEm: item.dbId ? 'banco' : 'memoria',
        })),
        ...extra,
      };
      fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
    } catch {
      // status e apenas informativo; nunca derruba a fila
    }
  }

  async processar() {
    if (this.processando) return;
    this.processando = true;

    while (this.fila.length > 0) {
      const item = this.fila[0];

      // Limite diario
      const limite = config.antiban.maxEnviosDia;
      if (limite > 0 && contarEnviosHoje() >= limite) {
        console.warn(`⛔ Limite diario de ${limite} envios atingido. Fila pausada (pendentes ficam salvos no banco).`);
        this.gravarStatus({ pausada: 'limite diario atingido' });
        break;
      }

      const { delay: faixa, rotulo } = faixaAtual();
      const esperaSeg = aleatorioEntre(faixa.min, faixa.max);
      console.log(`⏳ [${rotulo}] Enviando em ~${esperaSeg}s (${this.fila.length} na fila): [${item.loja || '?'}] ${(item.titulo || '').slice(0, 60)}`);
      this.gravarStatus({ proximoEnvioSegundos: esperaSeg });
      await delay(esperaSeg * 1000);

      try {
        await this.enviador(item);
        this.fila.shift();
        if (item.dbId) removerDaFilaDb(item.dbId);
        this.gravarStatus();
      } catch (erro) {
        console.error(`❌ Falha no envio, movendo para o fim da fila: ${erro.message}`);
        this.fila.push(this.fila.shift());
        // Backoff para nao martelar em caso de erro recorrente
        await delay(aleatorioEntre(30, 90) * 1000);
      }
    }

    this.processando = false;
  }
}
