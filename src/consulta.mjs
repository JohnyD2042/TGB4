import { chromium } from 'playwright';

const NAV_TIMEOUT_MS = 90_000;

/**
 * Migraciones: bloque #fecha_nac es un <div> con tres <input> (día, mes, año); no usar fill en el div.
 * Evita <input type="hidden" id="info_fecha_nacimiento">.
 * @param {import('playwright').Page} page
 * @param {string} fechaNacimiento DD/MM/YYYY
 */
async function fillFechaNacimiento(page, fechaNacimiento) {
  const parsed = fechaNacimiento.trim().match(/^(\d{1,2})[/.-\s](\d{1,2})[/.-\s](\d{4})$/);
  if (!parsed) {
    throw new Error('FECHA_NACIMIENTO debe ser DD/MM/YYYY');
  }
  const [, dd, mm, yyyy] = parsed;
  const ddStr = dd.padStart(2, '0');
  const mmStr = mm.padStart(2, '0');

  async function fillThreeInOrder(scope) {
    const inputs = scope.locator('input:not([type="hidden"])');
    const n = await inputs.count();
    if (n >= 3) {
      await inputs.nth(0).fill(ddStr, { timeout: 15_000 });
      await inputs.nth(1).fill(mmStr, { timeout: 15_000 });
      await inputs.nth(2).fill(yyyy, { timeout: 15_000 });
      return true;
    }
    return false;
  }

  const rowFechaNac = page.locator('#fecha_nac');
  if (await rowFechaNac.count()) {
    if (await fillThreeInOrder(rowFechaNac.first())) return;
  }

  const singleInput = page.locator('input#fecha_nacimiento:not([type="hidden"])');
  if (await singleInput.count()) {
    await singleInput.first().fill(fechaNacimiento, { timeout: 15_000 });
    return;
  }

  const byName = page.locator(
    'input:not([type="hidden"])[name*="fecha" i]:not(#info_fecha_nacimiento)',
  );
  const nameCount = await byName.count();
  if (nameCount === 1) {
    await byName.first().fill(fechaNacimiento, { timeout: 15_000 });
    return;
  }
  if (nameCount >= 3) {
    await byName.nth(0).fill(ddStr, { timeout: 15_000 });
    await byName.nth(1).fill(mmStr, { timeout: 15_000 });
    await byName.nth(2).fill(yyyy, { timeout: 15_000 });
    return;
  }

  const dia = page.locator('input[name*="dia" i]:not([type="hidden"])').first();
  const mes = page.locator('input[name*="mes" i]:not([type="hidden"])').first();
  const anio = page
    .locator(
      'input[name*="anio" i]:not([type="hidden"]), input[name*="año" i]:not([type="hidden"])',
    )
    .first();
  if ((await dia.count()) && (await mes.count()) && (await anio.count())) {
    await dia.fill(ddStr, { timeout: 15_000 });
    await mes.fill(mmStr, { timeout: 15_000 });
    await anio.fill(yyyy, { timeout: 15_000 });
    return;
  }

  const fechaLabel = page.locator('label').filter({ hasText: /fecha\s+nacimiento/i }).first();
  if (await fechaLabel.count()) {
    const fid = await fechaLabel.getAttribute('for');
    if (fid && /^[a-zA-Z_][\w.-]*$/.test(fid) && !/info_fecha/i.test(fid)) {
      const byFor = page.locator(`#${fid}`);
      if (await byFor.count()) {
        const tag = (await byFor.first().evaluate((el) => el.tagName)).toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          const t = await byFor.first().getAttribute('type');
          if (t !== 'hidden') {
            await byFor.first().fill(fechaNacimiento, { timeout: 15_000 });
            return;
          }
        }
        if (await fillThreeInOrder(byFor.first())) return;
      }
    }
  }

  throw new Error(
    'No se encontraron tres campos de fecha de nacimiento (día/mes/año) visibles.',
  );
}

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
    const expCount = await expedienteBox.count();
    if (expCount === 0) {
      const altExp = page.locator('input[type="text"]').first();
      if (!(await altExp.count())) {
        throw new Error(
          'No se encontró el campo expediente. La página puede haber cambiado.',
        );
      }
      await altExp.fill(expediente, { timeout: 15_000 });
    } else {
      await expedienteBox.first().fill(expediente, { timeout: 15_000 });
    }

    await fillFechaNacimiento(page, fechaNacimiento);

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
