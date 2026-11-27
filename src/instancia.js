/**
 * instancia.js — trava de instância única e regras de recuperação da conexão.
 *
 * POR QUÊ: o perfil do Chrome (`tokens/<sessao>`) é exclusivo. Dois processos no
 * mesmo `userDataDir` fazem o WhatsApp Web enxergar dois navegadores no mesmo
 * aparelho e DERRUBAR a sessão — foi a causa do ciclo "logado → QR de novo".
 *
 * A trava é um arquivo criado com `wx` (atômico). Só varrer `ps` não basta: dois
 * `npm start` disparados no mesmo instante passariam os dois pela checagem antes
 * de qualquer um abrir o navegador. A varredura continua como segunda camada,
 * para pegar um processo antigo que subiu sem a trava.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Nome do arquivo de trava dentro de `tokens/`. */
export const ARQUIVO_TRAVA = 'app.lock';

/**
 * Janela padrão do QR quando não há terminal (systemd, nohup, CI).
 *
 * POR QUÊ 300 e não 60: sem TTY não existe quem escaneie na hora; o QR só é lido
 * por quem abre `tokens/qr-ascii.txt`. Com 60s a janela fechava antes de dar
 * tempo, e no VPS o boot virava uma fila de tentativas perdidas.
 */
export const QR_HEADLESS_SEG_PADRAO = 300;

/** Status do wppconnect que indica que a página do WhatsApp foi fechada. */
export const STATUS_NAVEGADOR_FECHADO = 'browserClose';

/** Abaixo disso o QR expira antes de alguém conseguir escanear. */
const JANELA_MINIMA_SEG = 30;

/**
 * Janela de vida do QR em milissegundos.
 *
 * TTY usa `WPP_TIMEOUT_QR`; sem TTY usa `WPP_QR_HEADLESS_SEG`, com default de
 * 5 min. Valor inválido (vazio, "abc", negativo) cai no default em vez de
 * produzir `NaN` — que o wppconnect interpretaria como "fecha na hora".
 * @param {{ ehTTY?: boolean, timeoutQrMs?: number, headlessSeg?: string|number }} [opcoes]
 * @returns {number} milissegundos
 */
export function janelaQrMs({ ehTTY, timeoutQrMs, headlessSeg } = {}) {
  if (ehTTY) return timeoutQrMs;
  const segundos = Number.parseInt(String(headlessSeg ?? ''), 10);
  const valido =
    Number.isFinite(segundos) && segundos > 0
      ? segundos
      : QR_HEADLESS_SEG_PADRAO;
  return Math.max(JANELA_MINIMA_SEG, valido) * 1000;
}

/**
 * O processo existe? `kill(pid, 0)` não envia sinal, só testa a existência.
 * @param {number} pid
 * @returns {boolean}
 */
export function processoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM = o processo existe, mas é de outro usuário: segue ocupando o perfil.
    return erro?.code === 'EPERM';
  }
}
/** Executa `ps` e devolve a saída crua (isolado para permitir injeção no teste). */
function executarPs() {
  return execFileSync('ps', ['-eo', 'pid=,args='], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

/** Argumento que é o app de verdade (`src/app.js`), não um texto que o cita. */
const ARGUMENTO_APP = /(^|\/)src\/app\.js$/;

/**
 * PIDs de outros processos do app (`src/app.js`), sem o próprio.
 *
 * ARMADILHA (bug encontrado em produção local): procurar a string `src/app.js`
 * na linha inteira do `ps` casa com `grep`, `pgrep` e com qualquer shell cujo
 * comando CITE o caminho — o app barrava a si mesmo. Só conta quando o
 * executável é `node`/`nodejs` e `src/app.js` é um argumento dele.
 *
 * Não filtra por `--diag-midia`: o perfil do Chrome é exclusivo em QUALQUER
 * modo, então um diagnóstico aberto também impede o pipeline de subir.
 * @param {{ executar?: () => string }} [opcoes]
 * @returns {number[]}
 */
export function processosDoApp({ executar = executarPs } = {}) {
  try {
    return String(executar())
      .split('\n')
      .map((linha) => linha.trim())
      .filter(Boolean)
      .map((linha) => {
        const [pidTexto, ...args] = linha.split(/\s+/);
        return { pid: Number.parseInt(pidTexto, 10), args };
      })
      .filter(
        ({ pid }) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
      )
      .filter(({ args }) => {
        const executavel = path.basename(args[0] || '');
        if (executavel !== 'node' && executavel !== 'nodejs') return false;
        // `node --test` roda a suíte, não abre navegador nem toca no perfil.
        if (args.includes('--test')) return false;
        return args.slice(1).some((arg) => ARGUMENTO_APP.test(arg));
      })
      .map(({ pid }) => pid);
  } catch {
    return [];
  }
}

/** PID gravado no arquivo de trava (null quando ausente/ilegível). */
function lerDono(arquivo) {
  try {
    const pid = Number.parseInt(
      String(fs.readFileSync(arquivo, 'utf8')).split('\n')[0],
      10,
    );
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Remove a trava — somente se ela for deste processo.
 * @param {{ diretorio: string, pid?: number }} opcoes
 * @returns {boolean} true quando removeu
 */
export function liberarTrava({ diretorio, pid = process.pid } = {}) {
  const arquivo = path.join(diretorio, ARQUIVO_TRAVA);
  const dono = lerDono(arquivo);
  if (dono === null || dono !== pid) return false;
  try {
    fs.unlinkSync(arquivo);
    return true;
  } catch {
    return false;
  }
}
/**
 * Adquire a exclusividade do perfil do Chrome.
 * @param {{
 *   diretorio: string,
 *   pid?: number,
 *   estaVivo?: (pid: number) => boolean,
 *   processos?: () => number[],
 * }} opcoes
 * @returns {{ ok: true, arquivo: string, liberar: () => boolean }
 *   | { ok: false, motivo: 'trava-ocupada'|'instancia-ativa', pidDono: number|null, arquivo: string, pids?: number[] }}
 */
export function adquirirTrava({
  diretorio,
  pid = process.pid,
  estaVivo = processoVivo,
  processos = processosDoApp,
} = {}) {
  fs.mkdirSync(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, ARQUIVO_TRAVA);

  const donoAnterior = lerDono(arquivo);
  if (donoAnterior === pid) {
    // Reentrância: o mesmo processo já é dono (chamada repetida não deve falhar).
    return { ok: true, arquivo, liberar: () => liberarTrava({ diretorio, pid }) };
  }
  if (donoAnterior !== null && estaVivo(donoAnterior)) {
    return { ok: false, motivo: 'trava-ocupada', pidDono: donoAnterior, arquivo };
  }
  if (donoAnterior !== null) {
    // Trava órfã (dono morreu sem limpar): reaproveita em vez de bloquear o boot.
    try {
      fs.unlinkSync(arquivo);
    } catch {
      // corrida com outro processo limpando o mesmo arquivo: segue para o wx
    }
  }

  try {
    const fd = fs.openSync(arquivo, 'wx');
    fs.writeSync(fd, `${pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (erro) {
    if (erro?.code === 'EEXIST') {
      return {
        ok: false,
        motivo: 'trava-ocupada',
        pidDono: lerDono(arquivo),
        arquivo,
      };
    }
    throw erro;
  }

  // Segunda camada: processo antigo rodando sem a trava (versão anterior, pm2).
  const outros = processos();
  if (outros.length) {
    liberarTrava({ diretorio, pid });
    return {
      ok: false,
      motivo: 'instancia-ativa',
      pidDono: outros[0],
      pids: outros,
      arquivo,
    };
  }

  return { ok: true, arquivo, liberar: () => liberarTrava({ diretorio, pid }) };
}

/**
 * Depois de conectado, fechar o navegador é estado terminal.
 *
 * POR QUÊ encerrar em vez de seguir: sem a página do WhatsApp o app continua
 * vivo, falha em toda chamada e trava o supervisor (systemd/pm2 fica `active`
 * e nunca religa). Sair com código ≠ 0 devolve a decisão para o supervisor.
 * Antes de conectar, a queda é do ciclo normal de tentativas — não encerra.
 * @param {{ status?: string, jaConectou?: boolean }} [evento]
 * @returns {{ encerrar: true, motivo: string } | null}
 */
export function deveEncerrarPorStatus({ status, jaConectou } = {}) {
  if (status !== STATUS_NAVEGADOR_FECHADO || !jaConectou) return null;
  return { encerrar: true, motivo: 'navegador-fechado' };
}


