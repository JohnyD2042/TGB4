import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const DEFAULT_URL =
  'https://www.migraciones.gob.ar/accesible/consultaTramitePrecaria/ConsultaUnificada.php';

export function loadConfig() {
  const fromEnv = {
    consultaUrl: process.env.CONSULTA_URL?.trim() || DEFAULT_URL,
    expediente: process.env.EXPEDIENTE?.trim(),
    fechaNacimiento: process.env.FECHA_NACIMIENTO?.trim(),
    cronSecret: process.env.CRON_SECRET,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    onlyNotifyOnChange: process.env.ONLY_NOTIFY_ON_CHANGE !== '0',
  };

  const configPath = process.env.CONFIG_PATH || resolve(root, 'config.local.json');
  if (existsSync(configPath)) {
    const file = JSON.parse(readFileSync(configPath, 'utf8'));
    return {
      consultaUrl: process.env.CONSULTA_URL?.trim() || file.consultaUrl || DEFAULT_URL,
      expediente: fromEnv.expediente || file.expediente?.toString().trim(),
      fechaNacimiento: fromEnv.fechaNacimiento || file.fechaNacimiento?.toString().trim(),
      cronSecret: fromEnv.cronSecret || file.cronSecret,
      telegramBotToken: fromEnv.telegramBotToken || file.telegramBotToken,
      telegramChatId: fromEnv.telegramChatId || file.telegramChatId,
      onlyNotifyOnChange:
        process.env.ONLY_NOTIFY_ON_CHANGE !== undefined
          ? process.env.ONLY_NOTIFY_ON_CHANGE !== '0'
          : file.onlyNotifyOnChange !== undefined
            ? Boolean(file.onlyNotifyOnChange)
            : true,
    };
  }

  return fromEnv;
}

export function validateConsultaConfig(cfg) {
  const missing = [];
  if (!cfg.expediente) missing.push('EXPEDIENTE (или expediente в config.local.json)');
  if (!cfg.fechaNacimiento) missing.push('FECHA_NACIMIENTO');
  return missing;
}
