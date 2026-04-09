import express from 'express';
import { loadConfig } from './config.mjs';
import { executeCheck } from './runOnce.mjs';

const app = express();
const cfg = loadConfig();

if (!cfg.cronSecret) {
  console.warn(
    '[warn] CRON_SECRET is not set: /run will reject all requests. Set it in Railway Variables.',
  );
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'migraciones-consulta-bot' });
});

app.get('/run', async (req, res) => {
  const secret = req.query.secret ?? req.header('x-cron-secret');
  if (!cfg.cronSecret || secret !== cfg.cronSecret) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    const out = await executeCheck();
    const status = out.ok ? 200 : 502;
    res.status(status).json(out);
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
