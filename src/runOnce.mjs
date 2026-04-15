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
  const text = formatMessage(cfg, result, {
    nuevos,
    firstRun,
    estadoChanged,
  });
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
  const texto =
    fecha && estadoCodigo ? `${fecha} — ${estadoCodigo}` : '';

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

function formatMessage(cfg, result, ctx) {
  const nuevos = ctx?.nuevos ?? [];
  const firstRun = Boolean(ctx?.firstRun);
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

  let body = '';
  if (nuevos.length) {
    const bloque = nuevos.map((m) => `${m.fecha} — ${m.codigo}`).join('\n');
    if (estadoChanged && block?.estadoSegunExp) {
      body = `Estado según exp.: ${block.estadoSegunExp}\n---\n${bloque}`;
    } else {
      body = bloque;
    }
  } else if (firstRun) {
    body = fallback;
  } else if (estadoChanged && block?.estadoSegunExp) {
    body = `Estado según exp.: ${block.estadoSegunExp}`;
  } else {
    body = fallback;
  }

  return [
    'Migraciones — consulta automática',
    `Expediente: ${cfg.expediente}`,
    '---',
    body,
  ].join('\n');
}
