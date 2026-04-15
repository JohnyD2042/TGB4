import { loadConfig, validateConsultaConfig } from './config.mjs';
import { movimientoRowKey, runConsulta } from './consulta.mjs';
import { sendTelegram } from './notify.mjs';
import { readTramiteState, writeTramiteState } from './state.mjs';

/**
 * @param {{ verbose?: boolean }} opts – verbose=true devuelve result completo (debug)
 */
export async function executeCheck(opts = {}) {
  const verbose = Boolean(opts.verbose);
  const cfg = loadConfig();
  const missing = validateConsultaConfig(cfg);
  if (missing.length) {
    return {
      ok: false,
      error: `Faltan variables: ${missing.join(', ')}`,
      notified: false,
    };
  }

  const result = await runConsulta({
    consultaUrl: cfg.consultaUrl,
    expediente: cfg.expediente,
    fechaNacimiento: cfg.fechaNacimiento,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      notified: false,
      ...(verbose ? { result } : {}),
    };
  }

  const block = result.block;
  const estado = block?.estadoSegunExp ?? '';
  const movs = block?.movimientos ?? [];
  const keysNow = movs.map(movimientoRowKey);

  const prevState = readTramiteState();
  const prevSet = new Set(prevState?.rows ?? []);
  const nuevos = movs.filter((m) => !prevSet.has(movimientoRowKey(m)));
  nuevos.sort((a, b) => Number(a.orden) - Number(b.orden));

  const firstRun = !prevState;
  const estadoChanged =
    Boolean(prevState) && estado !== (prevState.estadoSegunExp ?? '');
  const tieneNuevos = nuevos.length > 0;
  const changed = firstRun || tieneNuevos || estadoChanged;

  const fp = block?.fingerprint || '';
  writeTramiteState({ rows: keysNow, estadoSegunExp: estado });

  let notified = false;
  const text = formatMessage(cfg, result, { estadoChanged });
  const shouldNotify =
    cfg.telegramBotToken &&
    cfg.telegramChatId &&
    (!cfg.onlyNotifyOnChange || changed);

  let telegramError = null;
  if (shouldNotify) {
    try {
      await sendTelegram(cfg.telegramBotToken, cfg.telegramChatId, text);
      notified = true;
    } catch (e) {
      telegramError = e instanceof Error ? e.message : String(e);
      console.error('[telegram]', telegramError);
    }
  }

  /** Por qué no hubo Telegram pese a ok (para logs y JSON). */
  let notifySkipReason = null;
  if (!shouldNotify && cfg.telegramBotToken && cfg.telegramChatId) {
    if (cfg.onlyNotifyOnChange && !changed) {
      notifySkipReason = 'only_notify_on_change_unchanged';
    }
  } else if (!shouldNotify && (!cfg.telegramBotToken || !cfg.telegramChatId)) {
    notifySkipReason = 'telegram_not_configured';
  }

  const u = block?.ultimoMovimiento;
  const fecha = u?.fecha ?? '';
  const estadoCodigo = u?.codigo ?? '';
  const ventana3 = lastTimelineWindow(movs, 3);
  const texto = ventana3.length
    ? ventana3.map((m) => `${m.fecha} — ${m.codigo}`).join(' | ')
    : fecha && estadoCodigo
      ? `${fecha} — ${estadoCodigo}`
      : '';

  if (verbose) {
    return {
      ok: true,
      changed,
      notified,
      notifySkipReason,
      telegramError,
      fecha,
      estado: estadoCodigo,
      texto,
      fingerprint: fp,
      resumen: block?.resumen ?? '',
      ultimoMovimiento: u ?? null,
      nuevos,
      ultimosTres: ventana3,
      estadoSegunExp: estado,
      lines: block?.lines ?? [],
      result,
    };
  }

  return {
    ok: true,
    changed,
    notified,
    notifySkipReason,
    telegramError,
    fecha,
    estado: estadoCodigo,
    texto,
  };
}

/**
 * Últimos k pasos del timeline (números en círculos), ordenados por `orden`.
 * Si hay 18 pasos y k=3 → devuelve los movimientos #16, #17, #18.
 * @param {{ orden: string, fecha: string, codigo: string }[]} movimientos
 * @param {number} k
 */
function lastTimelineWindow(movimientos, k) {
  if (!movimientos?.length || k < 1) return [];
  const sorted = [...movimientos].sort((a, b) => Number(a.orden) - Number(b.orden));
  return sorted.slice(-k);
}

function formatMessage(cfg, result, ctx) {
  const estadoChanged = Boolean(ctx?.estadoChanged);

  const block = result.block;
  const u = block?.ultimoMovimiento;
  const fallback =
    u && u.fecha && u.codigo
      ? `${u.fecha} — ${u.codigo}`
      : block?.resumen ||
        (block?.lines?.length ? block.lines.join('\n') : '') ||
        block?.fullTextSample ||
        result.rawSnippet;

  const ventana = lastTimelineWindow(block?.movimientos, 3);
  let body = '';
  if (ventana.length) {
    body = ventana.map((m) => `#${m.orden} ${m.fecha} — ${m.codigo}`).join('\n');
  } else {
    body = fallback;
  }

  if (estadoChanged && block?.estadoSegunExp) {
    body = `Estado según exp.: ${block.estadoSegunExp}\n---\n${body}`;
  }

  return [
    'Migraciones — consulta automática',
    `Expediente: ${cfg.expediente}`,
    '---',
    body,
  ].join('\n');
}
