import cron from 'node-cron';
import { executeCheck } from './runOnce.mjs';

const TZ = 'America/Argentina/Buenos_Aires';

/** Evita solapar dos Playwright si uno tarda más de lo previsto. */
let running = false;

async function runSlot(label) {
  if (running) {
    console.warn(`[scheduler] ${label}: omitido, ejecución anterior en curso`);
    return;
  }
  running = true;
  try {
    console.log(`[scheduler] ${label}: inicio`);
    const out = await executeCheck({ verbose: false });
    if (out.ok) {
      console.log(
        `[scheduler] ${label}: ok notified=${out.notified} texto=${out.texto || '(vacío)'}`,
      );
    } else {
      console.error(`[scheduler] ${label}: falló`, out.error);
    }
  } catch (e) {
    console.error(`[scheduler] ${label}: excepción`, e);
  } finally {
    running = false;
  }
}

/**
 * Dos corridas diarias: 10:00 y 17:00 hora de Buenos Aires.
 * Desactivar: variable DISABLE_INTERNAL_CRON=1
 */
export function startInternalCron() {
  if (process.env.DISABLE_INTERNAL_CRON === '1') {
    console.log('[scheduler] Desactivado (DISABLE_INTERNAL_CRON=1)');
    return;
  }

  // minuto hora día-mes mes día-semana — hora local de TZ
  cron.schedule('0 10 * * *', () => runSlot('10:00 BA'), { timezone: TZ });
  cron.schedule('0 17 * * *', () => runSlot('17:00 BA'), { timezone: TZ });

  console.log(
    `[scheduler] Activo: 10:00 y 17:00 (${TZ}). Railway Cron externo no hace falta.`,
  );
}
