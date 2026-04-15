import { chromium } from 'playwright';

const NAV_TIMEOUT_MS = 90_000;

/**
 * Clave estable por fila de la cronología (para comparar con el estado guardado).
 * @param {{ orden: string, fecha: string, codigo: string }} m
 */
export function movimientoRowKey(m) {
  const c = m.codigo.replace(/\s+/g, ' ').trim();
  return `${String(m.orden)}|${m.fecha}|${c}`;
}

/**
 * Una línea "16DD/MM/YYYY: código" o dos líneas "16" + "DD/MM/YYYY: código".
 * @param {string[]} rawLines
 */
function extractMovimientos(rawLines) {
  const progresoRe = /^(\d+)(\d{2}\/\d{2}\/\d{4}):(.+)$/;
  const soloFechaCodigo = /^(\d{2}\/\d{2}\/\d{4}):(.+)$/;
  /** @type {{ orden: string, fecha: string, codigo: string }[]} */
  const out = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const m = line.match(progresoRe);
    if (m) {
      out.push({ orden: m[1], fecha: m[2], codigo: m[3].trim() });
      continue;
    }
    if (/^\d{1,5}$/.test(line) && i + 1 < rawLines.length) {
      const dm = rawLines[i + 1].match(soloFechaCodigo);
      if (dm) {
        out.push({ orden: line, fecha: dm[1], codigo: dm[2].trim() });
        i++;
      }
    }
  }
  return out;
}

function pickRicherTramiteBlock(a, b) {
  if (b.movimientos.length > a.movimientos.length) return b;
  if (a.movimientos.length > b.movimientos.length) return a;
  return b.lines.length > a.lines.length ? b : a;
}

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

/**
 * Corta el texto al bloque "Datos del trámite" y extrae líneas de progreso
 * (formato fila: índice + dd/mm/yyyy + código), sin depender de DOM frágil.
 * @param {string} text
 */
function parseDatosTramiteSection(text) {
  const start = text.indexOf('Datos del trámite');
  const from = start >= 0 ? start : 0;
  const másIdx = text.indexOf('Más Información', from);
  const slice =
    másIdx > from ? text.slice(from, másIdx) : start >= 0 ? text.slice(from) : text;

  const rawLines = slice.split(/\r?\n/).map((l) => l.trim());

  let movimientos = extractMovimientos(rawLines);
  movimientos.sort((a, b) => Number(a.orden) - Number(b.orden));
  const ultimoMovimiento = movimientos.length ? movimientos[movimientos.length - 1] : null;

  let apellidos = '';
  let nombres = '';
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i] === 'Apellidos') {
      const v = rawLines[i + 1];
      if (v && !/^nombres$/i.test(v) && !v.includes('Estado')) apellidos = v;
    }
    if (rawLines[i] === 'Nombres') {
      const v = rawLines[i + 1];
      if (v && !/^estado/i.test(v)) nombres = v;
    }
  }

  let estadoSegunExp = '';
  const estadoIdx = rawLines.findIndex((l) => /estado\s+según\s+exp/i.test(l));
  if (estadoIdx >= 0) {
    const line = rawLines[estadoIdx];
    const afterColon = line.split(':').slice(1).join(':').trim();
    if (afterColon) estadoSegunExp = afterColon;
    else {
      const next = rawLines[estadoIdx + 1];
      if (next && !next.includes('Delegación') && !/^\d+\d{2}\/\d{2}\/\d{4}:/.test(next))
        estadoSegunExp = next;
    }
  }

  let delegacion = '';
  let disposicion = '';
  let fechaMovimiento = '';
  for (let i = 0; i < rawLines.length; i++) {
    if (/^delegación:\s*(.+)$/i.test(rawLines[i])) delegacion = rawLines[i].replace(/^delegación:\s*/i, '');
    if (/^disposición:\s*(.+)$/i.test(rawLines[i])) disposicion = rawLines[i].replace(/^disposición:\s*/i, '');
    if (/^fecha movimiento:\s*(.+)$/i.test(rawLines[i]))
      fechaMovimiento = rawLines[i].replace(/^fecha movimiento:\s*/i, '');
  }

  const linesOut = [];
  if (apellidos) linesOut.push(`Apellidos: ${apellidos}`);
  if (nombres) linesOut.push(`Nombres: ${nombres}`);
  if (estadoSegunExp) linesOut.push(`Estado según exp.: ${estadoSegunExp}`);
  if (delegacion) linesOut.push(`Delegación: ${delegacion}`);
  if (disposicion) linesOut.push(`Disposición: ${disposicion}`);
  if (fechaMovimiento) linesOut.push(`Fecha movimiento: ${fechaMovimiento}`);
  if (ultimoMovimiento) {
    linesOut.push(`Último movimiento (progreso): ${ultimoMovimiento.fecha} — ${ultimoMovimiento.codigo}`);
  }

  const resumen = ultimoMovimiento
    ? `Último paso del trámite: ${ultimoMovimiento.fecha} — ${ultimoMovimiento.codigo}`
    : estadoSegunExp
      ? `Estado según expediente: ${estadoSegunExp}`
      : '';

  const chronologySig = movimientos.map(movimientoRowKey).join('||');
  const fingerprint =
    [estadoSegunExp, chronologySig].filter(Boolean).join(':::') || slice.slice(0, 800).trim();

  return {
    lines: linesOut,
    fingerprint,
    fullTextSample: slice.slice(0, 4000),
    movimientos,
    ultimoMovimiento,
    resumen,
    estadoSegunExp,
  };
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

  const fromBody = parseDatosTramiteSection(bodyText);
  if (!rich) return fromBody;
  const fromRich = parseDatosTramiteSection(rich);
  const base = pickRicherTramiteBlock(fromBody, fromRich);
  const other = base === fromBody ? fromRich : fromBody;
  return {
    ...base,
    lines: base.lines.length >= other.lines.length ? base.lines : other.lines,
  };
}
