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

/**
 * Reemplaza movimientos del parse por los leídos del DOM (misma metadata de expediente).
 * @param {object} base
 * @param {{ orden: string, fecha: string, codigo: string }[]} movimientos
 */
function withMovimientos(base, movimientos) {
  const sorted = [...movimientos].sort((a, b) => Number(a.orden) - Number(b.orden));
  const ultimo = sorted.length ? sorted[sorted.length - 1] : null;
  const lines = base.lines.filter((l) => !l.startsWith('Último movimiento (progreso):'));
  if (ultimo) {
    lines.push(`Último movimiento (progreso): ${ultimo.fecha} — ${ultimo.codigo}`);
  }
  const resumen = ultimo
    ? `Último paso del trámite: ${ultimo.fecha} — ${ultimo.codigo}`
    : base.resumen;
  const chronologySig = sorted.map(movimientoRowKey).join('||');
  const fingerprint =
    [base.estadoSegunExp, chronologySig].filter(Boolean).join(':::') || base.fingerprint;
  return {
    ...base,
    lines,
    movimientos: sorted,
    ultimoMovimiento: ultimo,
    resumen,
    fingerprint,
  };
}

function dedupeMovimientosByOrden(movs) {
  const map = new Map();
  for (const m of movs) {
    map.set(Number(m.orden), m);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, m]) => m);
}

/**
 * Valida dd/mm/aaaa (evita falsos positivos del regex sobre el texto global).
 * @param {string} fecha
 */
function fechaEsPlausible(fecha) {
  const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/**
 * Cronología: solo el primer <ul>/<ol> *después* del título "Datos del trámite",
 * solo <li> hijos directos (no menús ni listas anidadas del mismo panel).
 * Se ejecuta en el navegador para orden de documento fiable.
 */
async function extractMovimientosFromDom(page) {
  try {
    const rows = await page.evaluate(() => {
      function parseLiText(t) {
        if (!/\d{2}\/\d{2}\/\d{4}/.test(t)) return null;
        const raw = t
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const joined = raw.join(' ').replace(/\s+/g, ' ');
        let orden = '';
        let fecha = '';
        let codigo = '';
        let m = joined.match(
          /^(\d{1,4})\s+(\d{2}\/\d{2}\/\d{4})\s*[:\u2013\-]\s*(.+)$/i,
        );
        if (m) {
          [, orden, fecha, codigo] = m;
          codigo = codigo.trim();
        } else {
          m = joined.match(/^(\d{1,4})(\d{2}\/\d{2}\/\d{4})\s*:\s*(.+)$/);
          if (m) {
            [, orden, fecha, codigo] = m;
            codigo = codigo.trim();
          } else if (raw.length >= 2) {
            const ordL = raw[0].match(/^(\d{1,4})$/);
            const dateL = raw[1].match(/^(\d{2}\/\d{2}\/\d{4})\s*:\s*(.+)$/);
            if (ordL && dateL) {
              orden = ordL[1];
              fecha = dateL[1];
              codigo = dateL[2].trim();
            }
          }
        }
        if (!orden || !fecha || !codigo) return null;
        const n = Number(orden);
        if (!Number.isFinite(n) || n < 1 || n > 999) return null;
        return { orden: String(n), fecha, codigo };
      }

      const reTitulo = /Datos\s+del\s+tr[aá]mite/i;
      let h = [...document.querySelectorAll('h2, h3, h4, h5, h6')].find((el) =>
        reTitulo.test(el.textContent || ''),
      );
      if (!h) {
        h = [...document.querySelectorAll('[role="heading"]')].find((el) =>
          reTitulo.test(el.textContent || ''),
        );
      }
      if (!h) return null;

      const root = h.closest('section') || h.closest('[class*="panel"]') || document.body;
      const lists = [...root.querySelectorAll('ul, ol')].filter((candidate) => {
        return h.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING;
      });
      lists.sort((l1, l2) => {
        if (l1 === l2) return 0;
        return l1.compareDocumentPosition(l2) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      if (!lists.length) return null;

      for (const list of lists) {
        const items = [...list.querySelectorAll(':scope > li')];
        const out = [];
        for (const li of items) {
          const r = parseLiText(li.innerText || '');
          if (r) out.push(r);
        }
        if (out.length > 0) return out;
      }
      return null;
    });

    if (!rows?.length) {
      return extractMovimientosFromSectionTextFallback(page);
    }
    const valid = rows.filter((r) => fechaEsPlausible(r.fecha));
    if (!valid.length) {
      return extractMovimientosFromSectionTextFallback(page);
    }
    return dedupeMovimientosByOrden(valid);
  } catch {
    return null;
  }
}

/**
 * Último recurso: regex solo sobre el texto plano de la sección (sin body completo).
 * @param {import('playwright').Page} page
 */
async function extractMovimientosFromSectionTextFallback(page) {
  try {
    const heading = page.getByRole('heading', { name: /Datos del trámite/i });
    if (!(await heading.count())) return null;
    const section = heading
      .locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"panel")][1]')
      .first();
    if (!(await section.count())) return null;
    let st = (await section.innerText()).trim();
    const mx = st.indexOf('Más Información');
    if (mx > 0) st = st.slice(0, mx);
    const rawLines = st.split(/\r?\n/).map((l) => l.trim());
    const out = extractMovimientos(rawLines).filter((m) => fechaEsPlausible(m.fecha));
    if (!out.length) return null;
    return dedupeMovimientosByOrden(out);
  } catch {
    return null;
  }
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
  const domMovs = await extractMovimientosFromDom(page);
  let timeline = fromBody;
  if (domMovs?.length) {
    timeline = withMovimientos(fromBody, domMovs);
  }

  if (!rich) return timeline;
  const fromRich = parseDatosTramiteSection(rich);
  return {
    ...timeline,
    lines:
      timeline.lines.length >= fromRich.lines.length ? timeline.lines : fromRich.lines,
  };
}
