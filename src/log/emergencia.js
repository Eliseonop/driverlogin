// Emergencias del equipo: cuándo se activó y se apagó, qué la disparó y si la central recibió el report con el evento.
// El botón de la pantalla (tarjeta Soporte) no deja línea propia: si no hay botón físico, servidor, operation ni
// enlazado junto al send() de EmergencyRepository, fue la pantalla.
import { horaDato } from './leer.js'

const ANTES = 5_000 // el disparo va justo antes del send(); en el mismo segundo el orden de las líneas no vale
const DESPUES = 1_000
const ESPERA_REPORT = 10 * 60_000 // 1.1.5+: el evento va por la cola Room y reintenta hasta 10 min
const ESPERA_ACK = 15_000
const ID_EMERGENCIA = '7'
const LIMA = 5 * 3600_000

const TECLAS = { 24: 'vol+', 25: 'vol−', 27: 'cámara', 79: 'jack', 85: 'play/pausa', 87: 'siguiente', 88: 'anterior', 126: 'play', 127: 'pausa' }
const tecla = k => `${TECLAS[k] ?? 'tecla'} ${k}`

/** id de com_panic_button (ObjectId de Mongo en decimal) → hora de creación en el servidor, en hora de Lima como el log. */
export function creadoEnServidor(id) {
  try {
    const hex = BigInt(String(id)).toString(16).padStart(24, '0')
    return hex.length === 24 ? parseInt(hex.slice(0, 8), 16) * 1000 - LIMA : null
  } catch {
    return null
  }
}

function disparo({ tag, msg }) {
  let m
  if (tag === 'ShutterEmergencyHandler') {
    if ((m = /^Evento válido detectado \((\d+)\)/.exec(msg))) return { activa: true, clase: 'boton', texto: 'Botón físico', detalle: `una pulsación (${tecla(m[1])})` }
    if ((m = /^Doble pulsación \((\d+), (\d+) ms\)/.exec(msg))) return { activa: true, clase: 'boton', texto: 'Botón físico', detalle: `doble pulsación (${tecla(m[1])}, ${m[2]} ms entre las dos)` }
    if ((m = /^Pulsación sostenida \((\d+), (\d+) ms\)/.exec(msg))) return { activa: true, clase: 'boton', texto: 'Botón físico', detalle: `mantenido ${(m[2] / 1000).toFixed(1)} s (${tecla(m[1])})` }
    if ((m = /^Soltada tras (\d+) ms \((\d+)\).*atascado/.exec(msg))) return { aviso: true, texto: 'Botón físico atascado', detalle: `soltado tras ${(m[1] / 1000).toFixed(1)} s (${tecla(m[2])}): no activa` }
    if ((m = /^Tecla (\d+) apretada hace (\d+) ms sin soltar/.exec(msg))) return { aviso: true, texto: 'Botón físico atascado', detalle: `${tecla(m[1])} apretada hace ${(m[2] / 1000).toFixed(1)} s sin soltar` }
    return null
  }
  if (tag === 'SocketMessageDispatcher') {
    if ((m = /^🆘 com_panic_button \(PB\) recibido: id=(\d+), state=(true|false)(.*)$/.exec(msg))) {
      if (/ya aplicado/.test(m[3])) return null
      const creado = creadoEnServidor(m[1])
      return { activa: m[2] === 'true', clase: 'servidor', texto: 'Servidor (com_panic_button)', detalle: `id ${m[1]}`, id: m[1], creado }
    }
    if ((m = /^🚨 Operation emergencia=(\S*) → (activar|desactivar)/.exec(msg))) return { activa: m[2] === 'activar', clase: 'operation', texto: 'Operation remota', detalle: `emergencia=${m[1]}` }
    return null
  }
  if (tag === 'SoporteCardViewModel') {
    if ((m = /^Pantalla: botón (Emergencia|Llamada) → (activar|apagar)/.exec(msg)))
      return { activa: m[2] === 'activar', clase: 'pantalla', llamada: m[1] === 'Llamada', texto: 'Pantalla (tarjeta Soporte)', detalle: `botón ${m[1]}` }
    if ((m = /^Llamada contestada → (cierra el pedido de llamada|sin pedido de llamada)( · la emergencia sigue activa)?/.exec(msg)))
      return { activa: false, clase: 'llamada', contestada: true, cierraPedido: m[1].startsWith('cierra'), sigue: !!m[2], texto: 'Al contestar una llamada', detalle: m[2] ? 'la emergencia sigue activa (1.1.6+)' : '' }
    return null
  }
  // Hasta 1.1.5 contestar cualquier llamada apagaba la emergencia (SoporteCardViewModel.enviarEventoLlamadaRecibida).
  if (tag === 'CallRepository' && (m = /^New state: ACTIVE - Phone : '([^']*)'/.exec(msg))) return { activa: false, clase: 'llamada', texto: 'Al contestar una llamada', detalle: m[1] }
  return null
}

const ENLAZADO = /^🆘 Evento (\d+)=(\d+) desde el enlazado (\S+) → servidor/
const SEND = /^send\(deactivate=(true|false)\) (called|ignorado)(.*)$/

function eventosReport(eventos) {
  const vistos = new Set()
  const out = []
  for (const e of eventos) {
    if (e.tipo !== 'tx' || e.header !== 'report' || !Array.isArray(e.data?.events) || !e.data.events.length) continue
    const p = e.data.positions?.[0] ?? {}
    for (const ev of e.data.events) {
      const clave = `${ev.id}|${ev.value}|${p.time}`
      if (vistos.has(clave)) continue
      vistos.add(clave)
      out.push({ t: e.t, i: e.i, id: String(ev.id), value: Number(ev.value), trip: e.data.trip, lat: p.lat, lng: p.lng, vel: p.speed, hora: horaDato(p.time, e) })
    }
  }
  return out
}

/** Nombre de quien llama, del anuncio de CallViewModel cerca de t. */
function quienLlama(entradas, t) {
  for (const e of entradas) {
    if (e.t < t - 30_000 || e.t > t + 5_000 || e.tag !== 'CallViewModel') continue
    const m = /(?:Llamada conectada con|Recibiendo llamada de) (.+)$/.exec(e.msg)
    if (m) return m[1].trim()
  }
  return null
}

function finLlamada(entradas, t) {
  return entradas.find(e => e.t > t && e.tag === 'CallRepository' && /^New state: (ENDED|DISCONNECTED)/.test(e.msg))?.t ?? null
}

/**
 * Cada activación y apagado de la emergencia (y los pedidos ignorados por ya estar en ese estado), con su origen,
 * el report que llevó el evento a la central y su ACK. También los pedidos de llamada de la tarjeta Soporte.
 */
export function emergencias(rep) {
  const { entradas, eventos } = rep
  const disparos = []
  const sends = []
  const enlazados = []
  for (const e of entradas) {
    let m
    if (e.tag === 'EmergencyRepository' && (m = SEND.exec(e.msg))) sends.push({ t: e.t, i: e.i, activa: m[1] === 'false', ignorado: m[2] === 'ignorado', reenvio: /se reenvía/.test(m[3]) })
    else if (e.tag === 'EspejoServidor' && (m = ENLAZADO.exec(e.msg))) enlazados.push({ t: e.t, i: e.i, id: m[1], value: +m[2], serial: m[3] })
    else {
      const d = disparo(e)
      if (d) disparos.push({ ...d, t: e.t, i: e.i })
    }
  }
  const reports = eventosReport(eventos)
  const usados = new Set()
  const tomar = (t, value, id) => {
    const r = reports.find(x => !usados.has(x) && x.value === value && (id == null || x.id === id) && x.t >= t - DESPUES && x.t - t <= ESPERA_REPORT)
    if (r) usados.add(r)
    return r ?? null
  }
  const ack = r => (r ? eventos.find(e => e.tipo === 'rx' && e.header === 'report' && e.i > r.i && e.t - r.t <= ESPERA_ACK)?.t ?? null : null)

  const out = []
  const usadosDisparo = new Set()
  const cerca = (t, filtro) =>
    disparos
      .filter(x => !usadosDisparo.has(x) && filtro(x) && x.t >= t - ANTES && x.t <= t + DESPUES)
      .sort((a, b) => (a.clase === 'llamada') - (b.clase === 'llamada') || Math.abs(a.t - t) - Math.abs(b.t - t))[0]
  for (const s of sends) {
    const d = cerca(s.t, x => !x.aviso && !x.llamada && !x.contestada && x.activa === s.activa)
    if (d) usadosDisparo.add(d)
    const origen = d
      ? { ...d, deducido: false }
      : { clase: 'pantalla', texto: 'Pantalla (tarjeta Soporte)', detalle: s.activa ? 'botón Emergencia: sin botón físico ni orden remota junto al envío' : 'botón Emergencia otra vez: sin llamada ni orden remota junto al envío', deducido: true }
    if (origen.clase === 'llamada') {
      origen.quien = quienLlama(entradas, d.t)
      origen.fin = finLlamada(entradas, d.t)
    }
    const report = s.ignorado ? null : tomar(s.t, s.activa ? 1 : 0, null)
    out.push({ tipo: 'emergencia', t: s.t, i: s.i, activa: s.activa, ignorado: s.ignorado, reenvio: s.reenvio, origen, report, ack: ack(report) })
  }
  const idEmergencia = masVisto(out.filter(x => x.report).map(x => x.report.id)) ?? enlazados[0]?.id ?? ID_EMERGENCIA
  for (const x of out)
    if (x.report && x.report.id !== idEmergencia) {
      usados.delete(x.report)
      x.report = x.ack = null
    }
  for (const en of enlazados) {
    const report = tomar(en.t, en.value, en.id)
    const tipo = en.id === idEmergencia ? 'emergencia' : 'evento'
    out.push({ tipo, t: en.t, i: en.i, activa: en.value === 1, ignorado: false, origen: { clase: 'enlazado', texto: 'Equipo enlazado', detalle: `${en.serial} mandó el evento ${en.id}=${en.value}`, deducido: false }, report, ack: ack(report) })
  }
  for (const r of reports) {
    if (usados.has(r)) continue
    const emergencia = r.id === idEmergencia
    const d = emergencia ? null : cerca(r.t, x => (x.llamada && x.activa === (r.value === 1)) || (x.cierraPedido && r.value === 0))
    if (d) usadosDisparo.add(d)
    const origen = emergencia
      ? { clase: 'desconocido', texto: 'Sin origen en el log', detalle: 'report con el evento sin el send() de EmergencyRepository', deducido: true }
      : d?.contestada
        ? { ...d, quien: quienLlama(entradas, d.t), detalle: `cierra el pedido de llamada (evento ${r.id}=0)`, deducido: false }
        : { clase: 'pantalla', texto: 'Pantalla (tarjeta Soporte)', detalle: `botón Llamada (evento ${r.id}=${r.value}, no es la emergencia ${idEmergencia})`, i: d?.i, deducido: !d }
    out.push({ tipo: emergencia ? 'emergencia' : 'llamada', t: r.t, i: r.i, activa: r.value === 1, ignorado: false, origen, report: r, ack: ack(r) })
  }
  for (const d of disparos) {
    if (d.aviso) out.push({ tipo: 'atascado', t: d.t, i: d.i, activa: false, ignorado: true, origen: { ...d, clase: 'boton', deducido: false }, report: null, ack: null })
    else if (d.contestada && d.sigue) out.push({ tipo: 'contestada', t: d.t, i: d.i, activa: true, ignorado: true, origen: { ...d, quien: quienLlama(entradas, d.t), fin: finLlamada(entradas, d.t), deducido: false }, report: null, ack: null })
  }
  out.sort((a, b) => a.t - b.t || a.i - b.i)
  return { eventos: out, tramos: tramos(out, rep.hasta), idEmergencia }
}

function masVisto(ids) {
  const n = new Map()
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Activa → apagada: cuánto duró cada emergencia (sin apagado en el log = sigue activa al final). */
function tramos(evs, fin) {
  const out = []
  let abierto = null
  for (const e of evs) {
    if (e.tipo !== 'emergencia' || e.ignorado) continue
    if (e.activa && !abierto) abierto = { desde: e, hasta: null }
    else if (!e.activa && abierto) {
      abierto.hasta = e
      out.push(abierto)
      abierto = null
    }
  }
  if (abierto) out.push(abierto)
  for (const x of out) x.dura = (x.hasta?.t ?? fin) - x.desde.t
  return out
}
