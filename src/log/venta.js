// Cómo vendía el equipo: venta directa (un boleto a la vez: un toque mientras imprime se rechaza) o en cola (los
// toques esperan su turno hasta cola_max boletos contando el que imprime). Lo decide la impresora (si dice su estado,
// cola) salvo con cola_forzada. Sale de "🖨️ SDK de impresión: … · venta …" de PrinterService (1.1.2+), de quién lo
// cambió (operation, pantalla), del último volcado de salud y de las líneas [VENTA] de cada boleto.
import { venta } from './cuadre.js'

const TOPE_COLA = 10 // tope duro de PrintQueue; antes de cola_max (1.1.2) era el único
const CLAVES = ['modo_venta', 'cola_forzada', 'cola_max', 'tiempo_impresion', 'estado_impresora', 'confirma_papel', 'corte_aparte', 'avance_final', 'beep', 'beep_impresion', 'aviso_cancelado', 'multitoque', 'dos_dedos', 'sin_imagen']

/** "SDK Tcontur · venta en cola (con estado, cola_max=4)" · "… venta directa (sin estado)" → modo */
export function leerModo(msg) {
  const m = /^🖨️ SDK de impresión: (.*?) · venta (.*)$/.exec(msg)
  if (!m) return null
  if (m[2].startsWith('directa')) return { sdk: m[1], modo: 'directa', porQue: 'sin estado', colaMax: null }
  const c = /^en cola \(([^,)]+)(?:, cola_max=(\d+))?/.exec(m[2])
  return c && { sdk: m[1], modo: 'cola', porQue: c[1], colaMax: c[2] ? +c[2] : null }
}

export const textoModo = x =>
  x.modo == null
    ? 'Sin dato en el log'
    : x.modo === 'directa'
      ? 'Directa · un boleto a la vez'
      : `En cola · ${x.deducido ? 'cola_max sin dato en el log' : x.colaMax == null ? `hasta ${TOPE_COLA} (sin cola_max)` : x.colaMax === 1 ? 'uno por uno (cola_max=1)' : `hasta ${x.colaMax} boletos (cola_max=${x.colaMax})`}`

/** '1FC9:2016 "Printer USB Printer P" · DLE EOT=SI GS r=NO … → N3 (solo informa estado (papel/tapa)) · por confirmar: …' */
function leerImpresora(msg) {
  const m = /^([0-9A-F]{4}:[0-9A-F]{4}) "([^"]*)" · (.*?) → (N\d) \((.*)\)(?: · (.*))?$/.exec(msg)
  return m && { id: m[1], nombre: m[2].trim(), soporta: m[3], nivel: m[4], que: m[5], nota: m[6] ?? null }
}

/** Quién cambió la configuración de venta: operation de la central o la pantalla de impresora. */
function leerCambio(e) {
  let m
  if (e.tag === 'SocketMessageDispatcher' && (m = /^\S+ Operation (\w+)=(.*?) → (.*)$/.exec(e.msg)) && CLAVES.includes(m[1]))
    return { origen: 'operation', clave: m[1], valor: m[2], efecto: m[3] }
  if (e.tag === 'SdkImpresora' && (m = /^🖨️ Pantalla: (\w+) → (.*)$/.exec(e.msg))) return { origen: 'pantalla', clave: m[1], valor: m[2], efecto: null }
  return null
}

const motivoRechazo = m =>
  /OCUPADA|imprimiendo el anterior/.test(m) ? 'ocupada' : /cola llena/i.test(m) ? 'llena' : /CERRANDO/.test(m) ? 'cerrando' : 'otro'

const percentil = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null)

/** Tramos del modo en el tiempo + cambios, impresoras, último volcado de salud y cómo se usó la cola. */
export function informeVenta(rep) {
  const tramos = []
  const cambios = []
  const impresoras = []
  let salud = null
  const vistos = { toque: 0, resultado: {}, encoladas: [], rechazos: [], canceladas: 0, impresas: [], noImpresas: 0, min: new Set() }
  const flujo = modoPorJob(rep.entradas)
  for (const e of rep.entradas) {
    let x
    if (e.tag === 'PrinterService' && (x = leerModo(e.msg))) {
      const ult = tramos.at(-1)
      if (ult) ult.hasta = e.t
      tramos.push({ ...x, desde: e.t, hasta: rep.hasta, i: e.i, ...cifrasVacias() })
    } else if (e.tag === 'IMPRESORA' && (x = leerImpresora(e.msg))) {
      const ult = impresoras.findLast(p => p.id === x.id)
      if (ult && ult.nivel === x.nivel) Object.assign(ult, { hasta: e.t, veces: ult.veces + 1 })
      else impresoras.push({ ...x, desde: e.t, hasta: e.t, i: e.i, veces: 1 })
    } else if ((x = leerCambio(e))) cambios.push({ ...x, t: e.t, i: e.i })
    else if (e.tag === 'SocketMessageDispatcher' && (x = /^SALUD CONFIG (\w+)=(.*?) ← (.*)$/.exec(e.msg)) && CLAVES.includes(x[1])) {
      if (!salud || e.t - salud.t > 60_000) salud = { t: e.t, i: e.i, valores: {} }
      salud.valores[x[1]] = { valor: x[2], origen: x[3] }
    } else if (e.tag === 'VENTA' && (x = venta(e.msg))) anotar(vistos, x, e, tramoPara(tramos, e.t, flujo.get(x.job), rep))
  }
  const ocupaciones = vistos.encoladas.map(v => v.ocupacion)
  const ms = vistos.impresas.map(v => v.ms).filter(v => v != null)
  return {
    tramos,
    cambios,
    impresoras,
    salud,
    toques: vistos.toque,
    resultadoToque: vistos.resultado,
    tiempoImpresion: [...vistos.min],
    encoladas: vistos.encoladas,
    porOcupacion: contar(ocupaciones),
    maxOcupacion: ocupaciones.length ? Math.max(...ocupaciones) : null,
    rechazos: vistos.rechazos,
    canceladas: vistos.canceladas,
    impresas: vistos.impresas.length,
    noImpresas: vistos.noImpresas,
    ms: { mediana: percentil(ms, 0.5), p90: percentil(ms, 0.9), max: ms.length ? Math.max(...ms) : null },
    porConfirma: contar(vistos.impresas.map(v => v.confirma)),
  }
}

const cifrasVacias = () => ({ impresas: 0, encoladas: 0, detras: 0, maxOcupacion: 0, rechazadas: 0 })
const tramoDe = (tramos, t) => tramos.findLast(x => x.desde <= t) ?? null

/** "F2/9 COLA [job=89f48a71 …] encolada 1/10 · venta directa · SDK …" → job → modo de ese boleto. */
function modoPorJob(entradas) {
  const out = new Map()
  for (const e of entradas) {
    const m = e.tag === 'FLUJO' && /^F2\/\d+ COLA \[job=(\w+)[^\]]*\] encolada \d+\/\d+ · venta (directa|en cola)/.exec(e.msg)
    if (m) out.set(m[1], m[2] === 'directa' ? 'directa' : 'cola')
  }
  return out
}

// Sin "SDK de impresión" (el log empieza con la app ya andando) el modo sale de cada boleto; cola_max no se sabe.
function tramoPara(tramos, t, modo, rep) {
  const ult = tramos.at(-1)
  if (ult && !ult.deducido) return ult
  if (ult && ult.modo == null && modo) ult.modo = modo
  if (ult && (modo == null || modo === ult.modo)) return ult
  if (ult) ult.hasta = t
  const nuevo = { sdk: null, modo: modo ?? null, porQue: null, colaMax: null, deducido: true, desde: ult ? t : rep.desde, hasta: rep.hasta, i: null, ...cifrasVacias() }
  tramos.push(nuevo)
  return nuevo
}
const contar = xs => xs.reduce((c, x) => ((c[x] = (c[x] ?? 0) + 1), c), {})

// "cola=N/10" cuenta los que esperan contando el nuevo; el que imprime va aparte (detras_de=…). Ocupación = los dos.
function anotar(v, x, e, tramo) {
  if (x.ev === 'TOQUE') {
    v.toque++
    v.resultado[x.resultado ?? '?'] = (v.resultado[x.resultado ?? '?'] ?? 0) + 1
    if (x.min) v.min.add(+x.min)
  } else if (x.ev === 'ENCOLADA') {
    const espera = +(/^(\d+)\//.exec(x.cola ?? '')?.[1] ?? 1)
    const ocupacion = espera + (x.detras_de ? 1 : 0)
    v.encoladas.push({ t: e.t, i: e.i, ocupacion, nombre: x.nombre, num: +x.num, pago: x.pago, colaMax: tramo?.colaMax ?? null, modo: tramo?.modo ?? null })
    if (tramo) {
      tramo.encoladas++
      if (ocupacion > 1) tramo.detras++
      tramo.maxOcupacion = Math.max(tramo.maxOcupacion, ocupacion)
    }
  } else if (x.ev === 'RECHAZADA') {
    v.rechazos.push({ t: e.t, i: e.i, nombre: x.nombre, motivo: x.motivo ?? '', tipo: motivoRechazo(x.motivo ?? '') })
    if (tramo) tramo.rechazadas++
  } else if (x.ev === 'CANCELADA') v.canceladas++
  else if (x.ev === 'IMPRESA') {
    v.impresas.push({ t: e.t, ms: x.ms != null ? +x.ms : null, confirma: tipoConfirma(e.msg) })
    if (tramo) tramo.impresas++
  } else if (x.ev === 'NO_IMPRESA') v.noImpresas++
}

/** "confirma=TCONTUR(GS ( H T02U 827ms)" → "papel afuera (GS ( H)"; "ESTADO(N1)" / "NO(N4)" / "NO(BT)" tal cual. */
function tipoConfirma(msg) {
  const c = /confirma=(.*)$/.exec(msg)?.[1]
  if (!c) return 'sin dato'
  const t = /^TCONTUR\((.+?) \d+ms(, corte aparte[^)]*)?\)$/.exec(c)
  return t ? `papel afuera (${t[1].replace(/^(GS \( H) \w{4}$/, '$1')}${t[2] ? ', corte aparte' : ''})` : c
}

/** Modo de venta en el instante t. */
export const modoEn = (inf, t) => tramoDe(inf.tramos, t)
