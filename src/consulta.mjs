import { chromium } from 'playwright';

const NAV_TIMEOUT_MS = 90_000;

/**
 * @param {object} opts
 * @param {string} opts.consultaUrl
 * @param {string} opts.expediente
 * @param {string} opts.fechaNacimiento - DD/MM/YYYY
 */
export async function runConsulta({ consultaUrl, expediente, fechaNacimiento }) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'es-AR',
    });
    const page = await context.newPage();

    await page.goto(consultaUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    const expedienteBox = page.getByLabel(/nro\.?\s*expediente/i).or(page.locator('#numeroDoc'));
    const fechaBox = page.getByLabel(/fecha nacimiento/i).or(page.locator("input[name*='fecha' i]"));

    const expCount = await expedienteBox.count();
    const fechaCount = await fechaBox.count();
    if (expCount === 0 || fechaCount === 0) {
      const altExp = page.locator('input[type="text"]').first();
      const altFecha = page.locator('input[type="text"]').nth(1);
      if ((await altExp.count()) && (await altFecha.count())) {
        await altExp.fill(expediente, { timeout: 15_000 });
        await altFecha.fill(fechaNacimiento, { timeout: 15_000 });
      } else {
        throw new Error(
          `No se encontraron campos del formulario (expediente=${expCount}, fecha=${fechaCount}). La página puede haber cambiado.`,
        );
      }
    } else {
      await expedienteBox.first().fill(expediente, { timeout: 15_000 });
      await fechaBox.first().fill(fechaNacimiento, { timeout: 15_000 });
    }

    const buscar = page.getByRole('button', { name: /buscar/i });
    await buscar.click({ timeout: 15_000 });

    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const bodyText = await page.locator('body').innerText();
    const block = await extractTramiteBlock(page, bodyText);

    await context.close();
    return { ok: true, block, rawSnippet: bodyText.slice(0, 8000) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      block: null,
      rawSnippet: '',
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function extractTramiteBlock(page, bodyText) {
  let rich = '';
  try {
    const heading = page.getByRole('heading', { name: /Datos del trámite/i });
    if (await heading.count()) {
      const section = heading.locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"panel")][1] | ..').first();
      if (await section.count()) rich = (await section.innerText()).trim();
    }
  } catch {
    /* ignore */
  }

  const estado = await readLabeledField(page, bodyText, /estado\s+según\s+exp/i);
  const delegacion = await readLabeledField(page, bodyText, /delegación/i);
  const disposicion = await readLabeledField(page, bodyText, /disposición/i);
  const fechaMov = await readLabeledField(page, bodyText, /fecha movimiento/i);
  const vencPrecaria = await readLabeledField(page, bodyText, /fecha vencimiento\s+precaria/i);
  const apellidos = await readLabeledField(page, bodyText, /apellidos/i);
  const nombres = await readLabeledField(page, bodyText, /\bnombres\b/i);

  const lines = [
    estado && `Estado: ${estado}`,
    delegacion && `Delegación: ${delegacion}`,
    disposicion && `Disposición: ${disposicion}`,
    fechaMov && `Fecha movimiento: ${fechaMov}`,
    vencPrecaria && `Venc. Precaria: ${vencPrecaria}`,
    apellidos && `Apellidos: ${apellidos}`,
    nombres && `Nombres: ${nombres}`,
  ].filter(Boolean);

  const fingerprint =
    lines.join('\n') ||
    (rich && rich.slice(0, 2000)) ||
    bodyText.slice(0, 2000);
  return {
    lines,
    fingerprint,
    fullTextSample: (rich || bodyText).slice(0, 4000),
  };
}

async function readLabeledField(page, bodyText, labelRe) {
  try {
    const row = page
      .locator('td, th, label, div, li, span, p, strong')
      .filter({ hasText: labelRe })
      .first();
    if (await row.count()) {
      const t = (await row.innerText()).replace(/\s+/g, ' ').trim();
      const parts = t.split(/[:：]/);
      if (parts.length > 1) return parts.slice(1).join(':').trim();
      const next = row.locator('xpath=following::*[1]').first();
      if (await next.count()) {
        const n = (await next.innerText()).trim();
        if (n && n.length < 500) return n;
      }
    }
  } catch {
    /* fall through */
  }
  return '';
}
