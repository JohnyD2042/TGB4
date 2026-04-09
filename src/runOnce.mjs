import { loadConfig, validateConsultaConfig } from './config.mjs';
import { runConsulta } from './consulta.mjs';
import { sendTelegram } from './notify.mjs';
import { readLastFingerprint, writeLastFingerprint } from './state.mjs';

export async function executeCheck() {
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
    return { ok: false, error: result.error, notified: false, result };
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

  if (shouldNotify) {
    await sendTelegram(cfg.telegramBotToken, cfg.telegramChatId, text);
    notified = true;
  }

  return {
    ok: true,
    changed,
    notified,
    resumen: result.block?.resumen ?? '',
    ultimoMovimiento: result.block?.ultimoMovimiento ?? null,
    fingerprint: fp,
    lines: result.block?.lines ?? [],
    result,
  };
}

function formatMessage(cfg, result) {
  const block = result.block;
  const core = block?.resumen
    ? block.resumen
    : block?.lines?.length
      ? block.lines.join('\n')
      : block?.fullTextSample || result.rawSnippet;
  return [
    'Migraciones — consulta automática',
    `Expediente: ${cfg.expediente}`,
    '---',
    core,
  ].join('\n');
}
