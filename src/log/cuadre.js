// Cuadre de cada sesión: lo que el equipo liquidó al cerrarla (driver_logout: importe y correlativos, por tarifa) contra
// los boletos que mandó a la central con esa sesión (tickets), que es lo que suma la plataforma, y contra lo que salió
// impreso ([VENTA] IMPRESA). Si no cuadra, explica con el log por qué: boletos vendidos después de armar la liquidación,
// boletos borrados de la base del equipo por un reinicio (el correlativo se vuelve a usar), correlativos que no se ven
// enviados, boletos de otra sesión dentro del rango, precios distintos o boletos sin ACK.
//
// Un boleto es correlativo + hora: tras un reinicio que pierde escrituras de SQLite el mismo correlativo vuelve a salir
// con otro boleto, y la central guarda los dos.
import { horaLog, parseStamp } from './leer.js'

/** driver_logout.event → quién cerró (CierreSesion del APK). */
export const CIERRE = { C: 'el conductor', T: 'llegada al terminal', D: 'despacho (remoto)', B: 'batería baja', S: 'soporte (remoto)', N: 'cierre nocturno', P: 'sesión de otro día' }
export const soles = c => (c == null ? '—' : `S/ ${(c / 100).toFixed(2)}`)
export const horaMs = ms => `${horaLog(ms)}.${String(((ms % 1000) + 1000) % 1000).padStart(3, '0')}`

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const suma = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0)
const MAX_RANGO = 20_000 // correlativos o números: más que esto es un dato roto, no un rango
const MISMO_BOLETO_MS = 3000 // [VENTA] IMPRESA (segundos) ↔ time del ticket enviado (ms)

function moda(xs) {
  const c = new Map()
  for (const x of xs) if (x != null) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const RE_KV = /(\w+)=(?:"([^"]*)"|(\S+))/g
/** "[VENTA] IMPRESA job=… boleto=7 nombre="…" tarifa=1.0 num=1951 correlativo=5580 …" → { ev, boleto, nombre, … } */
function venta(msg) {
  const m = /^(\w+)\s*(.*)$/s.exec(msg)
  if (!m) return null
  const kv = { ev: m[1] }
  for (const x of m[2].matchAll(RE_KV)) kv[x[1]] = x[2] ?? x[3]
  return kv
}

function liquidacion(e) {
  const d = e.data
  const resume = (d.resume ?? d.resumen ?? []).map(r => ({
    fare: num(r.fare ?? r.tarifa),
    desde: num(r.start ?? r.inicio),
    hasta: num(r.end ?? r.fin),
    cash: num(r.cash ?? r.efectivo) ?? 0,
    digital: num(r.digital) ?? 0,
  }))
  const cash = num(d.cash) ?? 0
  const digital = num(d.digital) ?? 0
  const porTarifas = suma(resume, r => r.cash + r.digital)
  return {
    t: e.t,
    i: e.i,
    sesion: num(d.session ?? d.sesion),
    fin: parseStamp(String(d.end_time ?? d.fin ?? '')) ?? e.t,
    evento: d.event ?? null,
    total: cash + digital || porTarifas,
    porTarifas,
    primero: num(d.first ?? d.primero),
    ultimo: num(d.last ?? d.ultimo),
    resume,
  }
}

/** Línea del log donde el boleto quedó vendido (la de [VENTA] IMPRESA si existe; si no, su primer envío). */
const lineaDe = b => b.venta?.i ?? b.i
const cerca = (a, b) => Math.abs(a - b) <= MISMO_BOLETO_MS
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/** Todo lo del log que sirve para cuadrar, una sola pasada. */
function fuentes(rep) {
  const f = {
    boletos: [],
    porCorr: new Map(),
    acks: [],
    impresos: [],
    imprimiendo: [],
    liqs: [],
    logins: [],
    confirmaciones: [],
    soltadas: [],
    solicitudes: [],
    terminales: [],
    remotos: [],
    forzados: [],
    vencidas: [],
    arranques: [],
    apagados: [],
    impresas: [],
    tarifas: new Map(),
    rawLiq: [],
  }
  const clave = new Map()
  for (const e of rep.eventos) {
    if (e.tipo === 'tx' && e.header === 'tickets') {
      for (const b of e.data.tickets ?? []) {
        const c = num(b.correlative ?? b.correlativo)
        if (c == null) continue
        const t = parseStamp(String(b.time ?? '')) ?? e.t
        const k = `${c}|${t}`
        const x = clave.get(k)
        if (x) {
          x.envios++
          continue
        }
        const nuevo = {
          correlativo: c,
          sesion: num(b.session ?? b.sesion),
          fare: num(b.fare ?? b.tarifa),
          numero: num(b.number ?? b.numero),
          precio: Math.round(Number(b.price ?? b.precio ?? 0)),
          sales: num(b.sales),
          pago: num(b.payment_method) ?? 1,
          t,
          i: e.i,
          envios: 1,
        }
        clave.set(k, nuevo)
        f.boletos.push(nuevo)
        f.porCorr.set(c, [...(f.porCorr.get(c) ?? []), nuevo])
      }
    } else if (e.tipo === 'rx' && e.header === 'tickets') {
      for (const b of e.data.tickets ?? []) if (num(b.correlative) != null) f.acks.push({ c: num(b.correlative), t: e.t, i: e.i })
    } else if (e.tipo === 'tx' && e.header === 'driver_logout') f.liqs.push(liquidacion(e))
    else if (e.tipo === 'rx' && e.header === 'driver_logout') f.confirmaciones.push({ t: e.t, i: e.i, sesion: num(e.data.id), error: e.data.error === true, titulo: e.data.title ?? '' })
    else if (e.tipo === 'rx' && e.header === 'driver_login' && !e.data.error) {
      const s = e.data.sessions?.[0]
      if (s?.id != null) f.logins.push({ t: e.t, i: e.i, sesion: Number(s.id), lado: s.direction === true, inicio: parseStamp(String(s.start_time ?? '')) ?? e.t, chofer: s.driver_code ?? null, mensaje: e.data.message ?? '' })
    } else if (e.tipo === 'logoutConfirmado') f.soltadas.push(e)
    else if (e.tipo === 'logoutSolicitado') f.solicitudes.push(e)
    else if (e.tipo === 'terminal') f.terminales.push(e)
    else if (e.tipo === 'remotoCierre') f.remotos.push(e)
    else if (e.tipo === 'forzado') f.forzados.push(e)
    else if (e.tipo === 'restauracion' && e.resultado === 'vencida') f.vencidas.push(e)
    else if (e.tipo === 'arranque' && e.t - (f.arranques.at(-1)?.t ?? -Infinity) > 60_000) f.arranques.push(e)
    else if (e.tipo === 'liquidacionImpresa') f.impresas.push(e)
  }
  for (const en of rep.entradas) {
    if (/PrintQueue$/.test(en.tag)) {
      const m = /^(?:✓ )?Raw job (encolado|completado): (\S+) \(liquidacion\)/.exec(en.msg) ?? /^Error raw job liquidacion: (.*)$/.exec(en.msg)
      if (m) f.rawLiq.push(m.length === 3 ? { i: en.i, t: en.t, fase: m[1], id: m[2] } : { i: en.i, t: en.t, fase: 'error', motivo: m[1] })
      continue
    }
    // "power event: O" se escribe en cada arranque de la app; F/R (apagado/reinicio ordenado) sí los avisa el sistema.
    if (en.tag === 'DeviceStatus' && /^⚡ power event: [FR]:/.test(en.msg)) {
      f.apagados.push({ t: en.t, i: en.i })
      continue
    }
    if (en.tag === 'SocketMessageDispatcher') {
      const m = /Operation logout-conductor → sesión (\d+)/.exec(en.msg)
      if (m) f.remotos.push({ t: en.t, i: en.i, sesion: +m[1], soporte: true })
      continue
    }
    if (en.tag !== 'VENTA') continue
    const v = venta(en.msg)
    const fare = num(v?.boleto)
    if (fare == null) continue
    if (v.nombre && !f.tarifas.has(fare)) f.tarifas.set(fare, { nombre: v.nombre, precio: v.tarifa != null ? Math.round(Number(v.tarifa) * 100) : null })
    const c = num(v.correlativo)
    if (c == null) continue
    // PrintQueue guarda el boleto en Room justo antes de "IMPRIMIENDO … correlativo=N"
    if (v.ev === 'IMPRIMIENDO') f.imprimiendo.push({ c, t: en.t, i: en.i })
    if (v.ev === 'IMPRESA')
      f.impresos.push({ c, t: en.t, i: en.i, fare, numero: num(v.num), precio: v.tarifa != null ? Math.round(Number(v.tarifa) * 100) : null, nombre: v.nombre, pago: v.pago })
  }

  // Cada impreso con su envío (mismo correlativo, misma hora), y cada boleto con su ACK (el primero después de enviarlo).
  for (const x of f.impresos) {
    x.boleto = (f.porCorr.get(x.c) ?? []).find(b => !b.venta && cerca(b.t, x.t)) ?? null
    if (x.boleto) x.boleto.venta = x
    x.enRoom = f.imprimiendo.filter(y => y.c === x.c && y.i <= x.i && x.t - y.t <= 60_000).at(-1)?.i ?? x.i
  }
  for (const b of f.boletos) {
    b.ack = f.acks.find(a => a.c === b.correlativo && a.i >= b.i)?.t ?? null
    b.enRoom = b.venta?.enRoom ?? lineaDe(b)
  }
  f.perdidas = perdidasPorReinicio(f)
  for (const r of f.perdidas) r.pausa = r.t - (rep.entradas[r.i - 1]?.t ?? r.t)
  for (const b of f.boletos) {
    const versiones = f.porCorr.get(b.correlativo)
    b.reemplazado = versiones.some(o => o !== b && o.t > b.t)
  }
  return f
}

/**
 * Reinicios que borraron escrituras de la base del equipo: el primer boleto después del arranque reutiliza un
 * correlativo ya impreso antes (SQLite perdió lo último que tenía sin bajar a disco al apagarse el equipo).
 */
function perdidasPorReinicio(f) {
  const out = []
  for (const r of f.arranques) {
    const antes = f.impresos.filter(x => x.i < r.i)
    const despues = f.impresos.find(x => x.i > r.i)
    const ultimo = antes.at(-1)
    if (!ultimo || !despues || despues.c > ultimo.c) continue
    const ordenado = f.apagados.some(e => e.i < r.i && e.i > ultimo.i)
    const perdida = { t: r.t, i: r.i, desde: despues.c, hasta: ultimo.c, ultimoAntes: ultimo, primeroDespues: despues, ordenado }
    perdida.impresos = antes.filter(x => x.c >= despues.c && x.c <= ultimo.c && r.t - x.t < 6 * 3_600_000)
    for (const x of perdida.impresos) {
      x.perdidoEn = perdida
      if (x.boleto) x.boleto.perdidoEn = perdida
    }
    out.push(perdida)
  }
  return out
}

/** Boletos de la sesión que el equipo tenía en su base en la línea `linea` (la última versión de cada correlativo). */
function enRoomEn(f, id, linea) {
  const vivos = new Map()
  for (const b of f.boletos) {
    if (b.sesion !== id || b.enRoom >= linea || (b.perdidoEn && b.perdidoEn.i < linea)) continue
    const otro = vivos.get(b.correlativo)
    if (!otro || b.t > otro.t) vivos.set(b.correlativo, b)
  }
  // Una versión más nueva del mismo correlativo con otra sesión también la pisa.
  for (const [c, b] of vivos) if (f.porCorr.get(c).some(o => o !== b && o.sesion !== id && o.enRoom < linea && o.t > b.t)) vivos.delete(c)
  return [...vivos.values()].sort((a, b) => a.correlativo - b.correlativo)
}

// Códigos de pago tal como los suma TicketDao para la liquidación impresa (getTotalQr/Yape/Visa/CanjeBySession).
const PAGO_IMPRESO = { 1: 'efectivo', 2: 'qr', 3: 'yape', 4: 'visa', 5: 'canje' }

/**
 * Una sesión dentro de la liquidación impresa. LiquidacionPrinter no usa la foto del driver_logout: vuelve a sumar lo
 * que hay en Room al imprimir (por tarifa: primer y último correlativo, cantidad y producción; PASAJ = último −
 * primer correlativo + 1; TOTAL = producción − canje).
 */
function bloqueImpreso(id, f, linea) {
  const bs = enRoomEn(f, id, linea)
  const porFare = new Map()
  for (const b of bs) porFare.set(b.fare, [...(porFare.get(b.fare) ?? []), b])
  const filas = [...porFare]
    .sort((a, b) => a[0] - b[0])
    .map(([fare, xs]) => ({
      fare,
      nombre: f.tarifas.get(fare)?.nombre ?? `tarifa ${fare}`,
      precio: f.tarifas.get(fare)?.precio ?? moda(xs.map(b => b.precio)),
      corrDesde: xs[0].correlativo,
      corrHasta: xs.at(-1).correlativo,
      cant: xs.length,
      produccion: suma(xs, b => b.precio),
    }))
  const pagos = { efectivo: 0, qr: 0, yape: 0, visa: 0, canje: 0 }
  for (const b of bs) if (PAGO_IMPRESO[b.pago]) pagos[PAGO_IMPRESO[b.pago]] += b.precio
  const produccion = suma(bs, b => b.precio)
  const login = f.logins.find(l => l.sesion === id)
  return {
    sesion: id,
    lado: login?.lado ?? null,
    inicio: login?.inicio ?? null,
    fin: f.soltadas.find(x => x.sesion === id && x.i < linea)?.t ?? null,
    filas,
    pagos,
    produccion,
    total: produccion - pagos.canje,
    pasajeros: bs.length ? bs.at(-1).correlativo - bs[0].correlativo + 1 : 0,
    parcial: !login,
  }
}

/** Liquidaciones automáticas que se mandaron a imprimir: qué sesiones, si salió el papel y lo que traía. */
function impresiones(f) {
  return f.impresas
    .filter(e => e.resultado === 'encolada')
    .map(e => {
      const enc = f.rawLiq.filter(r => r.fase === 'encolado' && Math.abs(r.i - e.i) <= 40 && Math.abs(r.t - e.t) <= 3000).sort((a, b) => Math.abs(a.i - e.i) - Math.abs(b.i - e.i))[0] ?? null
      const fin = enc ? f.rawLiq.find(r => r.i > enc.i && ((r.fase === 'completado' && r.id === enc.id) || r.fase === 'error')) : null
      const linea = Math.min(enc?.i ?? e.i, e.i)
      // Una sesión con total 0 no sale, tampoco dentro de la vuelta.
      const bloques = e.sesiones.map(id => bloqueImpreso(id, f, linea)).filter(b => b.total > 0)
      return {
        t: e.t,
        i: e.i,
        modo: e.modo ?? null,
        texto: e.texto,
        sesiones: e.sesiones,
        estado: !enc ? 'sin rastro' : fin?.fase === 'completado' ? 'impresa' : fin?.fase === 'error' ? 'fallo' : 'sin confirmar',
        motivo: fin?.motivo ?? null,
        bloques,
        total: suma(bloques, b => b.total),
      }
    })
}

const rango = (a, b) => (a != null && b != null && b >= a && b - a < MAX_RANGO ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [])

/** "n° 1947–1951 de URBAN/UNIV/ESC." agrupando por tarifa. */
export function describirBoletos(bs, tarifas) {
  const porFare = new Map()
  for (const b of bs) porFare.set(b.fare, [...(porFare.get(b.fare) ?? []), b])
  return [...porFare]
    .map(([fare, xs]) => {
      const ns = [...new Set(xs.map(b => b.numero))].sort((a, b) => a - b)
      const seguidos = ns.every((n, k) => !k || n === ns[k - 1] + 1)
      const nums = ns.length === 1 ? `n° ${ns[0]}` : seguidos ? `n° ${ns[0]}–${ns.at(-1)}` : `n° ${ns.join(', ')}`
      return `${nums} de ${tarifas.get(fare)?.nombre ?? `tarifa ${fare}`}`
    })
    .join(' · ')
}

function porTarifa(liq, boletos, tarifas, cubre) {
  const fares = [...new Set([...(liq?.resume.map(r => r.fare) ?? []), ...boletos.map(b => b.fare)])].filter(x => x != null).sort((a, b) => a - b)
  return fares.map(fare => {
    const r = liq?.resume.find(x => x.fare === fare) ?? null
    const bs = boletos.filter(b => b.fare === fare)
    const nLiq = r ? rango(r.desde, r.hasta).length : 0
    const montoLiq = r ? r.cash + r.digital : 0
    const montoEnv = suma(bs, b => b.precio)
    const nums = bs.map(b => b.numero).filter(x => x != null)
    const vistos = new Set(nums)
    const precio = moda(bs.map(b => b.precio)) ?? tarifas.get(fare)?.precio ?? (nLiq ? Math.round(montoLiq / nLiq) : null)
    return {
      fare,
      nombre: tarifas.get(fare)?.nombre ?? null,
      precio,
      liq: r ? { desde: r.desde, hasta: r.hasta, n: nLiq, monto: montoLiq } : null,
      env: { n: bs.length, monto: montoEnv, desde: nums.length ? Math.min(...nums) : null, hasta: nums.length ? Math.max(...nums) : null },
      dif: liq ? montoEnv - montoLiq : null,
      fuera: liq ? bs.filter(b => !r || b.numero < r.desde || b.numero > r.hasta) : [],
      faltan: r && cubre ? rango(r.desde, r.hasta).filter(n => !vistos.has(n)) : [],
      perdidos: bs.filter(b => b.perdidoEn || b.reemplazado),
      precioRaro: !!(r && nLiq && precio && nLiq * precio !== montoLiq),
    }
  })
}

/** Cómo se cerró: el event del driver_logout (1.1.x) o lo que el log deja ver; con el paradero si fue en un terminal. */
function comoCerro(id, liq, f) {
  if (!liq) return null
  const reciente = xs => xs.filter(e => e.sesion === id && e.i <= liq.i && liq.t - e.t <= 120_000).at(-1) ?? null
  const terminal = reciente(f.terminales)
  const remoto = reciente(f.remotos)
  const forzado = reciente(f.forzados)
  const vencida = reciente(f.vencidas)
  const codigo = liq.evento ?? (terminal ? 'T' : remoto ? (remoto.soporte ? 'S' : 'D') : forzado ? (forzado.motivo === 'NIGHT' ? 'N' : 'B') : vencida ? 'P' : null)
  const texto = {
    T: `llegada al terminal${terminal?.paradero ? ` ${terminal.paradero}` : ''}`,
    C: 'el conductor (Terminar venta)',
    D: 'remoto: la central (operation sesion)',
    S: 'remoto: soporte (logout-conductor)',
    B: `batería baja${forzado ? ` (${forzado.motivo})` : ''}`,
    N: 'cierre nocturno',
    P: 'al arrancar: sesión de un día anterior',
  }[codigo]
  return { codigo, texto: texto ?? (codigo ? CIERRE[codigo] ?? codigo : 'no se sabe (el log no lo dice)'), deducido: !liq.evento && codigo != null }
}

/** Sesión del equipo en el instante t (para los impresos que no se llegaron a enviar). */
function sesionEn(rep, t) {
  return rep.equipo.find(s => s.desde <= t && t < s.hasta)?.sesion ?? null
}

function sesion(id, f, rep, impresas) {
  const login = f.logins.find(l => l.sesion === id) ?? null
  const liqs = f.liqs.filter(l => l.sesion === id)
  const liq = liqs.at(-1) ?? null
  const conf = liqs.length ? f.confirmaciones.find(c => c.sesion === id && c.i > liqs[0].i) ?? null : null
  const soltada = f.soltadas.find(s => s.sesion === id && (!liq || s.i > liqs[0].i)) ?? null
  const solicitud = liq ? f.solicitudes.filter(s => s.sesion === id && s.i <= liq.i).at(-1) ?? null : null
  const cerro = comoCerro(id, liq, f)
  const cierre = cerro?.codigo ?? null
  const boletos = f.boletos.filter(b => b.sesion === id).sort((a, b) => a.correlativo - b.correlativo || a.t - b.t)
  for (const b of boletos) {
    b.respecto = !liq || liq.primero == null ? null : b.correlativo > liq.ultimo ? 'despues' : b.correlativo < liq.primero ? 'antes' : 'dentro'
  }
  const inicio = login?.inicio ?? boletos[0]?.t ?? liq?.t ?? null
  const cubre = login != null
  const tarifas = porTarifa(liq, boletos, f.tarifas, cubre)
  const montoEnv = suma(boletos, b => b.precio)
  const dif = liq ? montoEnv - liq.total : null
  const ultimoSales = boletos.filter(b => !b.perdidoEn && !b.reemplazado).findLast(b => b.sales != null)?.sales ?? null

  // Lo que salió en papel (desde 1.0.72 cada boleto deja [VENTA] IMPRESA): los enviados con esta sesión y los que no
  // llegaron a enviarse mientras la sesión estaba activa.
  const finVenta = liq?.i ?? Infinity
  const impresos = f.impresos.filter(x => (x.boleto ? x.boleto.sesion === id : x.i <= finVenta && sesionEn(rep, x.t) === id))
  const sinEnvio = impresos.filter(x => !x.boleto)
  const room = liq ? enRoomEn(f, id, liq.i) : null
  const perdidos = [...boletos.filter(b => b.perdidoEn || b.reemplazado), ...sinEnvio.filter(x => x.perdidoEn)]

  const enRango = liq ? rango(liq.primero, liq.ultimo) : []
  const ultimaVersion = c => (f.porCorr.get(c) ?? []).filter(b => b.enRoom < finVenta).at(-1)
  const otraSesion = enRango.map(ultimaVersion).filter(b => b && b.sesion !== id)
  const noVistos = enRango.filter(c => !f.porCorr.has(c) && !sinEnvio.some(x => x.c === c))
  const despues = boletos.filter(b => b.respecto === 'despues')
  const antes = boletos.filter(b => b.respecto === 'antes')
  const sinAck = boletos.filter(b => !b.ack)

  const impresion = impresas.filter(x => x.sesiones.includes(id)).at(-1) ?? null
  const papel = impresion?.bloques.find(b => b.sesion === id) ?? null

  const motivos = []
  for (const r of f.perdidas.filter(r => perdidos.some(p => p.perdidoEn === r))) {
    const deEsta = r.impresos.filter(x => (x.boleto ? x.boleto.sesion === id : sesionEn(rep, x.t) === id))
    const enviados = deEsta.filter(x => x.boleto)
    const reimpresos = deEsta.filter(x => f.impresos.some(y => y.i > r.i && y.fare === x.fare && y.numero === x.numero))
    const detalle = [
      `${horaLog(r.ultimoAntes.t)}: imprime ${describirBoletos([r.ultimoAntes], f.tarifas)} (corr. ${r.ultimoAntes.c}) y el log se corta sin error de la app; vuelve a arrancar ${Math.round(r.pausa / 1000)} s después (${horaLog(r.t)})${r.ordenado ? ', con apagado avisado por el sistema' : ', sin apagado avisado por el sistema'}.${r.pausa >= 30_000 && r.pausa <= 120_000 ? ' Esa pausa es lo que tarda el teléfono en volver a encender.' : ''}`,
      'Que SQLite pierda filas ya guardadas no pasa si solo se cierra la app: indica que se cortó el equipo entero (apagado de golpe, batería o cuelgue del sistema) antes de bajar a disco lo último escrito.',
      `Al volver, la base del equipo ya no tenía lo vendido desde el corr. ${r.desde}: el siguiente boleto (${horaLog(r.primeroDespues.t)}) reutilizó el correlativo ${r.primeroDespues.c} y los contadores de número volvieron atrás.`,
      `Se ${deEsta.length === 1 ? 'borró' : 'borraron'} ${plural(deEsta.length, 'boleto impreso', 'boletos impresos')} de la #${id} (${soles(suma(deEsta, x => x.precio))}): ${describirBoletos(deEsta.map(x => ({ fare: x.fare, numero: x.numero })), f.tarifas)}.`,
      [
        enviados.length ? `${plural(enviados.length, 'había', 'habían')} llegado a la central (${soles(suma(enviados, x => x.precio))}): la plataforma ${enviados.length === 1 ? 'lo' : 'los'} cuenta.` : '',
        deEsta.length > enviados.length ? `${plural(deEsta.length - enviados.length, 'se imprimió y no se llegó', 'se imprimieron y no se llegaron')} a enviar (${soles(suma(deEsta.filter(x => !x.boleto), x => x.precio))}): nadie ${deEsta.length - enviados.length === 1 ? 'lo' : 'los'} cuenta.` : '',
      ].filter(Boolean).join(' '),
      'La liquidación se arma con la base del equipo: no cuenta ninguno.',
    ]
    if (reimpresos.length) detalle.push(`Números que salieron dos veces en papel: ${describirBoletos(reimpresos.map(x => ({ fare: x.fare, numero: x.numero })), f.tarifas)}.`)
    motivos.push({ tipo: `reinicio-${r.i}`, nivel: 'error', titulo: `El reinicio de las ${horaLog(r.t)} borró ${plural(deEsta.length, 'boleto', 'boletos')} de la base del equipo`, monto: suma(deEsta, x => x.precio), detalle, boletos: deEsta.filter(x => x.boleto).map(x => x.boleto) })
  }
  if (despues.length) {
    const m = suma(despues, b => b.precio)
    const orden = [...despues].sort((a, b) => lineaDe(a) - lineaDe(b))
    const antesConf = conf ? despues.filter(b => lineaDe(b) < conf.i).length : 0
    const trasSoltar = soltada ? despues.filter(b => lineaDe(b) > soltada.i).length : 0
    const conAck = despues.filter(b => b.ack).length
    const enOtra = despues.filter(b => f.liqs.some(l => l.sesion !== id && l.primero <= b.correlativo && b.correlativo <= l.ultimo)).length
    const detalle = [
      `La liquidación salió a las ${horaMs(liq.fin)}${cerro ? ` (cierre por ${cerro.texto})` : ''} con el corte en el correlativo ${liq.ultimo}: ${soles(liq.total)}.`,
      `Después se vendieron ${despues.length} boletos con la sesión #${id} (${describirBoletos(orden, f.tarifas)}), entre ${horaMs(orden[0].t)} y ${horaMs(orden.at(-1).t)}.`,
    ]
    if (conf) detalle.push(`La central confirmó el cierre a las ${horaLog(conf.t)}${antesConf ? `, con ${antesConf} de esos boletos ya vendidos` : ''}.`)
    if (soltada) detalle.push(`La app soltó la sesión recién a las ${horaLog(soltada.t)} ("Logout confirmado")${trasSoltar ? `, y ${trasSoltar} se vendieron incluso después` : ''}: mientras esperaba la respuesta del cierre la pantalla siguió vendiendo con la sesión que ya había liquidado.`)
    detalle.push(`${conAck === despues.length ? 'La central recibió todos (ACK)' : `La central confirmó ${conAck} de ${despues.length}`}: la plataforma los suma a la #${id}${enOtra ? '' : ', pero ninguna liquidación enviada los incluye'}.`)
    if (papel && papel.total !== liq.total)
      detalle.push(`La liquidación impresa a las ${horaLog(impresion.t)} sí los incluye: el papel dice ${soles(papel.total)} para la #${id} porque se suma de nuevo al imprimir; a la central le llegó ${soles(liq.total)}.`)
    motivos.push({ tipo: 'despues', nivel: 'error', titulo: `${despues.length} boleto${despues.length === 1 ? '' : 's'} vendido${despues.length === 1 ? '' : 's'} después de armar la liquidación`, monto: m, detalle, boletos: orden })
  }
  if (antes.length)
    motivos.push({ tipo: 'antes', nivel: 'error', titulo: `${antes.length} boletos con correlativo anterior al primero de la liquidación (${liq.primero})`, monto: suma(antes, b => b.precio), detalle: [describirBoletos(antes, f.tarifas)], boletos: antes })
  if (otraSesion.length) {
    const ses = [...new Set(otraSesion.map(b => b.sesion))].map(s => `#${s}`).join(', ')
    motivos.push({ tipo: 'otra', nivel: 'error', titulo: `${otraSesion.length} boletos del rango de la liquidación se enviaron con otra sesión (${ses})`, monto: suma(otraSesion, b => b.precio), detalle: [`La liquidación los cuenta en la #${id} y la plataforma en ${ses}.`, describirBoletos(otraSesion, f.tarifas)], boletos: otraSesion })
  }
  if (noVistos.length)
    motivos.push({
      tipo: 'noVistos',
      nivel: cubre ? 'aviso' : 'info',
      titulo: `${noVistos.length} correlativos de la liquidación no aparecen enviados en el log`,
      detalle: [
        noVistos.length <= 12 ? `Correlativos ${noVistos.join(', ')}.` : `Del ${noVistos[0]} al ${noVistos.at(-1)} (con huecos).`,
        cubre ? 'El log cubre toda la sesión: se vendieron (entran en la liquidación) pero el log no muestra su envío a la central.' : `El log empieza a las ${horaLog(rep.desde)}, después de la apertura de la sesión: lo más probable es que se enviaran antes.`,
      ],
    })
  if (room && liq && cubre && suma(room, b => b.precio) !== liq.total && !perdidos.length && !noVistos.length)
    motivos.push({ tipo: 'room', nivel: 'aviso', titulo: `La liquidación (${soles(liq.total)}) no es lo que el log muestra en la base del equipo al cierre (${soles(suma(room, b => b.precio))})`, detalle: [] })
  for (const x of tarifas.filter(x => x.precioRaro))
    motivos.push({ tipo: 'precio', nivel: 'aviso', titulo: `${x.nombre ?? `Tarifa ${x.fare}`}: la liquidación cobra ${soles(x.liq.monto)} por ${x.liq.n} boletos`, detalle: [`A ${soles(x.precio)} cada uno serían ${soles(x.liq.n * x.precio)}.`] })
  if (liq && liq.porTarifas !== liq.total && liq.resume.length)
    motivos.push({ tipo: 'resumen', nivel: 'aviso', titulo: `El total de la liquidación (${soles(liq.total)}) no es la suma de sus tarifas (${soles(liq.porTarifas)})`, detalle: [] })
  if (liqs.length > 1 && new Set(liqs.map(l => `${l.total}/${l.ultimo}`)).size > 1)
    motivos.push({ tipo: 'varias', nivel: 'aviso', titulo: `Se mandaron ${liqs.length} liquidaciones distintas`, detalle: liqs.map(l => `${horaLog(l.t)}: ${soles(l.total)} · corr. ${l.primero}–${l.ultimo}`) })
  if (papel && liq && papel.total !== liq.total && !despues.length)
    motivos.push({ tipo: 'papel', nivel: 'aviso', titulo: `La liquidación impresa dice ${soles(papel.total)} y la enviada a la central ${soles(liq.total)}`, detalle: [`Impresa a las ${horaLog(impresion.t)}: se suma de nuevo desde los boletos del equipo al imprimir.`] })
  if (impresion?.estado === 'fallo')
    motivos.push({ tipo: 'papelFallo', nivel: 'aviso', titulo: 'La liquidación no salió impresa', detalle: [impresion.motivo ?? 'error de la impresora'] })
  if (liq && !conf) motivos.push({ tipo: 'sinRespuesta', nivel: 'aviso', titulo: 'La central no respondió el cierre en el log', detalle: ['Ver la pestaña Sesión: el cierre pudo no llegar.'] })
  const sinEnvioVivos = sinEnvio.filter(x => !x.perdidoEn)
  if (sinEnvioVivos.length)
    motivos.push({ tipo: 'sinEnvio', nivel: 'aviso', titulo: `${sinEnvioVivos.length} boletos impresos sin envío en el log`, monto: suma(sinEnvioVivos, x => x.precio), detalle: [describirBoletos(sinEnvioVivos.map(x => ({ fare: x.fare, numero: x.numero })), f.tarifas)] })
  if (sinAck.length)
    motivos.push({ tipo: 'sinAck', nivel: 'aviso', titulo: `${sinAck.length} boletos sin ACK de la central`, monto: suma(sinAck, b => b.precio), detalle: [describirBoletos(sinAck.slice(0, 30), f.tarifas) + (sinAck.length > 30 ? ' …' : '')], boletos: sinAck })
  if (liq && ultimoSales != null && ultimoSales !== liq.total && !despues.length)
    motivos.push({ tipo: 'sales', nivel: 'info', titulo: `El contador del equipo en el último boleto (sales) dice ${soles(ultimoSales)}`, detalle: [`La liquidación dice ${soles(liq.total)}.`] })

  const limpio = !despues.length && !antes.length && !otraSesion.length && !perdidos.length
  const estado = !liq ? 'abierta' : dif === 0 && limpio && !noVistos.length ? 'cuadra' : !cubre && limpio && dif < 0 ? 'parcial' : 'no-cuadra'

  return {
    id,
    lado: login?.lado ?? null,
    chofer: login?.chofer ?? null,
    login,
    inicio,
    fin: liq?.fin ?? null,
    cierre,
    cerro,
    liq,
    liqs,
    conf,
    soltada,
    solicitud,
    boletos,
    tarifas,
    montoEnv,
    dif,
    ultimoSales,
    cubre,
    impresos: f.impresos.length ? { n: impresos.length, monto: suma(impresos, x => x.precio), sinEnvio } : null,
    room: room && { n: room.length, monto: suma(room, b => b.precio) },
    perdidos,
    motivos,
    estado,
    impresas: f.impresas.filter(x => x.sesiones.includes(id)),
    impresion,
    papel,
    momento: momentoCierre(id, { liq, liqs, conf, soltada, solicitud, boletos }, f, cerro),
  }
}

/** Lo que pasó alrededor del cierre, en el orden de las líneas del log (dentro del mismo segundo es lo único fiable). */
function momentoCierre(id, s, f, cerro) {
  const { liq, conf, soltada, solicitud, boletos } = s
  if (!liq) return []
  const despues = boletos.filter(b => b.respecto === 'despues')
  const hasta = Math.max(liq.i, conf?.i ?? 0, soltada?.i ?? 0, ...despues.map(lineaDe))
  const previos = boletos.filter(b => lineaDe(b) < liq.i).sort((a, b) => lineaDe(a) - lineaDe(b)).slice(-3)
  const entre = boletos.filter(b => lineaDe(b) > liq.i && lineaDe(b) <= hasta)
  const items = [...previos, ...entre].map(b => ({ tipo: 'boleto', i: lineaDe(b), t: b.t, b }))
  const terminal = f.terminales.filter(e => e.sesion === id && e.i <= liq.i && liq.t - e.t <= 60_000).at(-1)
  if (terminal) items.push({ tipo: 'terminal', i: terminal.i, t: terminal.t, texto: `Llega al terminal${terminal.paradero ? ` ${terminal.paradero}` : ''}` })
  const remoto = f.remotos.filter(e => e.sesion === id && e.i <= liq.i && liq.t - e.t <= 60_000).at(-1)
  if (remoto) items.push({ tipo: 'solicitud', i: remoto.i, t: remoto.t, texto: remoto.soporte ? 'Soporte pide cerrar (logout-conductor)' : 'La central pide cerrar (operation sesion)' })
  if (solicitud) items.push({ tipo: 'solicitud', i: solicitud.i, t: solicitud.t, texto: `Pide cerrar la sesión${cerro ? ` (${cerro.texto})` : ''}` })
  items.push({ tipo: 'liquidacion', i: liq.i, t: liq.fin, texto: `driver_logout: liquida ${soles(liq.total)} · correlativos ${liq.primero ?? '?'}–${liq.ultimo ?? '?'}` })
  if (conf) items.push({ tipo: 'central', i: conf.i, t: conf.t, texto: `Central: ${conf.titulo || (conf.error ? 'error' : 'cerrada')}` })
  if (soltada) items.push({ tipo: 'soltada', i: soltada.i, t: soltada.t, texto: 'Logout confirmado: la app suelta la sesión' })
  for (const x of f.impresas.filter(x => x.sesiones.includes(id) && x.i > liq.i && x.t - liq.t <= 120_000))
    items.push({ tipo: 'impresa', i: x.i, t: x.t, texto: x.diferida ? 'Liquidación: se imprime al cerrar la vuelta' : `Liquidación ${x.texto} ${x.resultado === 'encolada' ? 'mandada a imprimir' : x.resultado}` })
  return items.sort((a, b) => a.i - b.i)
}

export function cuadrar(rep) {
  const f = fuentes(rep)
  const ids = new Set([...f.logins.map(l => l.sesion), ...f.liqs.map(l => l.sesion), ...f.boletos.map(b => b.sesion)].filter(x => x != null))
  const impresas = impresiones(f)
  const sesiones = [...ids].map(id => sesion(id, f, rep, impresas)).sort((a, b) => (a.inicio ?? 0) - (b.inicio ?? 0))
  return { sesiones, impresiones: impresas, perdidas: f.perdidas, tarifas: f.tarifas, sinSesion: f.boletos.filter(b => b.sesion == null) }
}

/** Hallazgos para el panel lateral: reinicios que borraron boletos y sesiones que no cuadran (abren la pestaña Cuadre). */
export function hallazgosCuadre(cuadre) {
  const reinicios = cuadre.perdidas.map(r => ({
    nivel: 'error',
    t: r.t,
    i: r.i,
    vista: 'cuadre',
    sesion: cuadre.sesiones.find(s => s.perdidos.some(p => p.perdidoEn === r))?.id ?? null,
    titulo: `Reinicio ${horaLog(r.t)}: se ${r.impresos.length === 1 ? 'borró' : 'borraron'} ${plural(r.impresos.length, 'boleto', 'boletos')} de la base del equipo (corr. ${r.desde === r.hasta ? r.desde : `${r.desde}–${r.hasta}`}, ${soles(suma(r.impresos, x => x.precio))})`,
    detalle: ['Al volver se reutilizaron esos correlativos y los números: la liquidación no los cuenta, la central sí los que ya había recibido.'],
  }))
  const sesiones = cuadre.sesiones
    .filter(s => s.estado === 'no-cuadra')
    .map(s => ({
      nivel: 'error',
      t: s.liq.t,
      i: s.liq.i,
      vista: 'cuadre',
      sesion: s.id,
      titulo: `Sesión #${s.id} no cuadra: liquidó ${soles(s.liq.total)} y la plataforma suma ${soles(s.montoEnv)}`,
      detalle: s.motivos.filter(m => m.nivel !== 'info').map(m => `${m.titulo}${m.monto != null ? ` (${soles(m.monto)})` : ''}.`),
    }))
  return [...reinicios, ...sesiones]
}
