import { loadConfig, validateConsultaConfig } from './config.mjs';
import { runConsulta } from './consulta.mjs';
import { sendTelegram } from './notify.mjs';
import { readLastFingerprint, writeLastFingerprint } from './state.mjs';

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

  const fp = result.block?.fingerprint || '';
  const prev = readLastFingerprint();
  const changed = prev !== fp;
  writeLastFingerprint(fp);

  let notified = false;
  const text = formatMessage(cfg, result);
  const shouldNotify =
    cfg.telegramBotToken &&
    cfg.telegramChatId &&
    (!cfg.onlyNotifyOnChange || changed || !prev);

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
    if (cfg.onlyNotifyOnChange && prev && !changed) {
      notifySkipReason = 'only_notify_on_change_unchanged';
    }
  } else if (!shouldNotify && (!cfg.telegramBotToken || !cfg.telegramChatId)) {
    notifySkipReason = 'telegram_not_configured';
  }

  const u = result.block?.ultimoMovimiento;
  const fecha = u?.fecha ?? '';
  const estado = u?.codigo ?? '';
  const texto = fecha && estado ? `${fecha} — ${estado}` : '';

  if (verbose) {
    return {
      ok: true,
      changed,
      notified,
      notifySkipReason,
      telegramError,
      fecha,
      estado,
      texto,
      fingerprint: fp,
      resumen: result.block?.resumen ?? '',
      ultimoMovimiento: u ?? null,
      lines: result.block?.lines ?? [],
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
    estado,
    texto,
  };
}

function formatMessage(cfg, result) {
  const u = result.block?.ultimoMovimiento;
  const line =
    u && u.fecha && u.codigo
      ? `${u.fecha} — ${u.codigo}`
      : result.block?.resumen ||
        (result.block?.lines?.length ? result.block.lines.join('\n') : '') ||
        result.block?.fullTextSample ||
        result.rawSnippet;
  return [
    'Migraciones — consulta automática',
    `Expediente: ${cfg.expediente}`,
    '---',
    line,
  ].join('\n');
}
