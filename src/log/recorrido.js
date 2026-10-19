// Recorrido del bus y marcas de geocerca: lo que vio el equipo (ENTERING/EXITING) contra lo que estampó
// la central (header "mark"). El equipo no marca: manda posiciones con events=[] y la central calcula la marca.
import { parseStamp } from './leer.js'

const OK_MAX = 60_000 // diferencia tolerada entre la entrada del equipo y la hora de la central
const HUECO = 120_000 // sin posiciones por más de esto = hueco GPS
const DETENIDO = 60_000 // velocidad ≤ 2 km/h por más de esto = detención
const ADELANTO = 5_000 // hora de la posición posterior a su envío por más de esto = salió con hora adelantada

const adelanto = p => p.t - p.enviada
export const adelantada = p => adelanto(p) > ADELANTO

/** Índice de la posición más cercana a t (dentro de max ms) o -1. */
export function posicionEn(pos, t, max = HUECO) {
  let lo = 0
  let hi = pos.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pos[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const k = lo > 0 && Math.abs(pos[lo - 1].t - t) <= Math.abs(pos[lo].t - t) ? lo - 1 : lo
  return Math.abs(pos[k].t - t) <= max ? k : -1
}

function posiciones(eventos) {
  const vistas = new Set()
  const out = []
  for (const e of eventos) {
    if (e.tipo !== 'tx' || !Array.isArray(e.data?.positions)) continue
    for (const p of e.data.positions) {
      const t = parseStamp(p.time)
      if (t == null || vistas.has(p.time)) continue
      vistas.add(p.time)
      out.push({ t, enviada: e.t, lat: p.lat, lng: p.lng, vel: p.speed, acc: p.accuracy, ang: p.angle, trip: e.data.trip, estado: e.data.state })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

function geocercasEquipo(entradas) {
  const entra = []
  const sale = []
  const casi = []
  const radios = {}
  let m
  for (const e of entradas) {
    if (e.tag !== 'GeofenceManager') continue
    if ((m = /^ENTERING geofence: (.+?) acc:([\d.]+)m/.exec(e.msg))) entra.push({ t: e.t, i: e.i, nombre: m[1], acc: +m[2] })
    else if ((m = /^EXITING geofence: (.+?) acc:([\d.]+)m/.exec(e.msg))) sale.push({ t: e.t, nombre: m[1] })
    else if ((m = /CASI marca: (.+?) dist:(\d+)m radio:(\d+)m/.exec(e.msg))) casi.push({ t: e.t, nombre: m[1], dist: +m[2], radio: +m[3] })
    else if ((m = /Geocerca cercana: (.+?) dist:\d+m radio:(\d+)m/.exec(e.msg))) radios[m[1]] = +m[2]
  }
  for (const g of entra) g.salida = sale.find(s => s.nombre === g.nombre && s.t >= g.t && s.t - g.t < 30 * 60_000) ?? null
  return { entra, casi, radios }
}

const rx = (eventos, header) => eventos.filter(e => e.tipo === 'rx' && e.header === header)

function salidas(eventos) {
  const porTrip = new Map()
  for (const e of rx(eventos, 'salida')) {
    const d = e.data
    porTrip.set(String(d.id), { t: e.t, trip: String(d.id), inicio: parseStamp(d.inicio), lado: d.lado === true, conductor: d.conductor, controles: d.controles ?? [] })
  }
  return porTrip
}

function detenciones(pos) {
  const paradas = []
  const huecos = []
  let tramo = null
  const cerrar = () => tramo && tramo.b.t - tramo.a.t >= DETENIDO && paradas.push(tramo)
  pos.forEach((p, k) => {
    const prev = pos[k - 1]
    const corte = prev && p.t - prev.t > HUECO
    if (corte) huecos.push({ a: prev, b: p })
    if (p.vel <= 2 && !corte && tramo) {
      tramo.b = p
      tramo.n++
    } else {
      cerrar()
      tramo = p.vel <= 2 ? { a: p, b: p, n: 1 } : null
    }
  })
  cerrar()
  return { paradas, huecos }
}

function ventas(entradas) {
  const out = []
  let m
  for (const e of entradas)
    if (e.tag === 'VENTA' && (m = /^(IMPRESA|NO_IMPRESA)\b.*?nombre="([^"]*)" tarifa=([\d.]+)/.exec(e.msg)))
      out.push({ t: e.t, impresa: m[1] === 'IMPRESA', nombre: m[2], tarifa: +m[3] })
  return out
}

function paraderos(eventos) {
  const out = new Map()
  for (const e of eventos) if (e.tipo === 'cercano' && e.paradero && !isNaN(e.paradero.lat)) out.set(e.paradero.id, e.paradero)
  return [...out.values()]
}

/** Qué dice la causa de cierre del socket, en palabras. */
export function porQueSeCorta(c) {
  if (c.apagado && c.apagado.tipo !== 'reinicio') return c.apagado.titulo
  if (c.apagado) return 'la app se reinició: el proceso se cerró (el equipo no se apagó)'
  if (c.causa === 'watchdog') return `el watchdog lo cerró: ${c.silencio ? `${Math.round(c.silencio / 1000)} s` : 'demasiado tiempo'} sin mensajes del servidor`
  if (c.causa === 'reinicio de la app') return 'la app se reinició (MyApp.onCreate / SocketService creado)'
  if (c.causa === 'timeout') return 'timeout al conectar con el servidor'
  if (c.causa === 'limpieza') return 'la app cerró el socket (limpiando recursos)'
  if (/pong/.test(c.causa)) return `el servidor dejó de responder el ping: ${c.causa}`
  if (/abort|reset|refused|resolve|unreachable|timed out|failed to connect/i.test(c.causa)) return `falla de red del equipo: ${c.causa}`
  return c.causa
}

/** Lo que sugieren los intentos fallidos y la señal: qué le pasaba a la red del equipo. */
function pistaCorte(motivos, senal) {
  const txt = motivos.join(' ')
  if (/portal\.|movistar|claro\.|entel|bitel/i.test(txt)) return 'la red móvil redirige al portal del operador: sin plan de datos / saldo'
  if (/Unable to resolve host|No address associated/i.test(txt)) return 'sin DNS: el equipo no tenía internet'
  if (/Network is unreachable|ENETUNREACH/i.test(txt)) return 'sin red: datos móviles caídos'
  if (senal != null && senal <= -100) return `señal muy baja (${senal} dBm)`
  return null
}

/**
 * Cada vez que el socket se cae: dónde estaba el bus, por qué se cerró (causa + líneas del log), cuánto tardó en
 * reconectar, los intentos fallidos en el medio y la señal/batería del último device_status.
 */
function cortesConexion(rep, pos) {
  const { segmentos } = rep.conexion
  const fallas = rep.eventos.filter(e => e.tipo === 'falla')
  const estados = rep.eventos.filter(e => e.tipo === 'estado')
  const out = []
  for (const [k, s] of segmentos.entries()) {
    if (!s.causa || s.causa === 'reemplazado') continue
    const t = s.hasta
    const sig = segmentos.slice(k + 1).find(x => x.desde >= t - 2000) ?? null
    const vuelve = sig?.desde ?? null
    const fin = vuelve ?? rep.hasta
    const intentos = fallas.filter(f => f.t > t && f.t < fin)
    const wd = rep.conexion.cortes.find(c => Math.abs(c.t - t) <= 2000)
    const estado = estados.filter(e => e.t <= t && t - e.t <= 15 * 60_000).at(-1)?.data ?? null
    const i = Number.isFinite(s.iFin) ? s.iFin : null
    const motivos = [...new Set(intentos.map(f => f.motivo.split('\n')[0].replace(/ from \/[\d.]+ \(port \d+\)/, '').slice(0, 120)))].slice(0, 4)
    // Las líneas que rodean el cierre: ahí está el porqué (watchdog, onFailure, onClosed, arranque…).
    const lineas = i == null ? [] : rep.entradas.slice(Math.max(0, i - 6), i + 4).map(e => ({ t: e.t, tag: e.tag, msg: e.msg.split('\n')[0].slice(0, 220), propia: e.i === i }))
    // Si el equipo se apagó (o la app se reinició) justo ahí, ese es el porqué real del corte.
    const apagado = (rep.apagados ?? []).find(a => t >= a.t - 60_000 && t <= a.vuelve) ?? null
    out.push({
      apagado,
      lineas,
      t,
      i,
      sid: s.sid,
      desdeSid: s.desde,
      causa: s.causa,
      silencio: wd?.silencio ?? null,
      ultimoRx: s.ultimoRx ?? null,
      vuelve,
      sidNuevo: sig?.sid ?? null,
      fuera: Math.max(0, fin - t),
      intentos: intentos.length,
      motivos,
      pista: pistaCorte(motivos, estado?.cell_signal ?? null),
      senal: estado?.cell_signal ?? null,
      bateria: estado?.battery ?? null,
      online: estado?.online ?? null,
      p: pos[posicionEn(pos, t, 5 * 60_000)] ?? null,
      tramo: pos.filter(p => p.t >= t && p.t <= fin),
    })
  }
  return out
}

function veredicto(marcas, pos) {
  const conHora = marcas.filter(m => m.delta != null)
  const malas = conHora.filter(m => Math.abs(m.delta) > OK_MAX)
  const buenas = conHora.filter(m => Math.abs(m.delta) <= OK_MAX)
  const atraso = pos.map(p => p.enviada - p.t)
  const reloj = { min: Math.min(...atraso, 0), max: Math.max(...atraso, 0), tarde: atraso.filter(x => x > 60_000).length }
  const relojOk = reloj.min > -60_000 && reloj.tarde === 0
  const deltas = malas.map(m => m.delta).sort((a, b) => a - b)
  const offset = deltas.length ? { mediana: deltas[deltas.length >> 1], dispersion: deltas.at(-1) - deltas[0] } : null
  const nuncaEnviada = malas.every(m => !m.enviadaCerca)
  const sinDateros = malas.filter(m => m.dateros && !m.dateros.length).length
  const conDateros = buenas.filter(m => m.dateros?.length).length
  const culpa = !malas.length ? 'ninguno' : relojOk && nuncaEnviada ? 'central' : 'revisar'
  return { culpa, malas: malas.length, buenas: buenas.length, total: marcas.length, reloj, relojOk, offset, nuncaEnviada, sinDateros, conDateros }
}

export function recorrido(rep) {
  const { entradas, eventos } = rep
  const pos = posiciones(eventos)
  const { entra, casi, radios } = geocercasEquipo(entradas)
  const fwd = rx(eventos, 'forward_datero')
  const nombres = {}
  const marcas = rx(eventos, 'mark').map(e => {
    const d = e.data
    const m = { t: e.t, i: e.i, geocerca: String(d.geofence), trip: String(d.trip), volada: d.volada, hora: parseStamp(d.timestamp) }
    const g = entra.filter(x => x.t <= m.t + 2000 && m.t - x.t <= 30_000 && !x.marca).at(-1)
    if (g) {
      g.marca = m
      m.entrada = g
      nombres[m.geocerca] = g.nombre
    }
    const f = fwd.find(x => String(x.data.geofence) === m.geocerca && String(x.data.trip) === m.trip && Math.abs(x.t - m.t) < 10_000)
    m.dateros = f ? (f.data.dateros ?? []).map(x => `P${x.padron}(${x.delta})`) : null
    m.delta = g && m.hora != null ? m.hora - g.t : null
    m.enviadaCerca = m.hora != null && posicionEn(pos, m.hora, 60_000) >= 0
    return m
  })
  const en = t => pos[posicionEn(pos, t)] ?? null
  for (const g of entra) {
    g.p = en(g.t)
    if (g.salida) g.salida.p = en(g.salida.t)
    g.radio = radios[g.nombre] ?? 50
  }
  for (const x of casi) x.p = en(x.t)
  const vendidas = ventas(entradas)
  for (const v of vendidas) v.p = en(v.t)
  const sal = salidas(eventos)
  const viajes = [...sal.values()]
    .filter(s => marcas.some(m => m.trip === s.trip))
    .map(s => {
      let prog = s.inicio
      const filas = s.controles.map((c, k) => {
        prog += c.tiempo * 60_000
        const geocerca = String(c.geocerca)
        return { orden: k + 1, geocerca, nombre: nombres[geocerca] ?? null, prog, marca: marcas.find(m => m.trip === s.trip && m.geocerca === geocerca) ?? null }
      })
      return { ...s, filas }
    })
  return {
    pos,
    entra,
    casi,
    marcas,
    viajes,
    trips: conPosiciones(pos, sal),
    sinMarca: entra.filter(g => !g.marca),
    paraderos: paraderos(eventos),
    ventas: vendidas,
    cortes: cortesConexion(rep, pos),
    apagados: (rep.apagados ?? []).map(a => ({ ...a, p: a.lat != null ? { lat: a.lat, lng: a.lng, t: a.t, vel: null } : pos[posicionEn(pos, a.ultima, 10 * 60_000)] ?? null })),
    ...detenciones(pos),
    veredicto: veredicto(marcas, pos),
  }
}

/** Cada viaje (trip de las posiciones) con cuántas posiciones tiene, su horario y su salida si llegó. */
function conPosiciones(pos, sal) {
  const out = new Map()
  for (const p of pos) {
    const trip = String(p.trip)
    const v = out.get(trip) ?? { trip, n: 0, desde: null, hasta: null, adelantadas: 0, salida: sal.get(trip) ?? null }
    v.n++
    if (adelantada(p)) v.adelantadas++
    else {
      v.desde ??= p.t
      v.hasta = p.t
    }
    out.set(trip, v)
  }
  return [...out.values()].sort((a, b) => (a.desde ?? Infinity) - (b.desde ?? Infinity))
}

/**
 * Hojas del Excel de un viaje: una fila por posición enviada (con la geocerca que vio el equipo ahí y la hora que
 * estampó la central) y, si la central marcó, el viaje geocerca por geocerca.
 */
export function excelViaje(r, trip) {
  const geo = new Map()
  for (const g of r.entra) if (g.p) geo.set(g.p, [...(geo.get(g.p) ?? []), g])
  const posiciones = {
    nombre: `Posiciones ${trip}`,
    columnas: [
      { titulo: 'Hora GPS', ancho: 20, fecha: true },
      { titulo: 'Enviada', ancho: 20, fecha: true },
      { titulo: 'Envío − hora (s)', ancho: 15 },
      { titulo: 'Latitud', ancho: 12 },
      { titulo: 'Longitud', ancho: 12 },
      { titulo: 'Velocidad km/h', ancho: 14 },
      { titulo: 'Precisión m', ancho: 12 },
      { titulo: 'Ángulo', ancho: 8 },
      { titulo: 'Estado', ancho: 8 },
      { titulo: 'Geocerca (entra el equipo)', ancho: 28 },
      { titulo: 'Marca de la central', ancho: 20, fecha: true },
      { titulo: 'Observación', ancho: 30 },
    ],
    filas: r.pos
      .filter(p => String(p.trip) === trip)
      .map(p => {
        const gs = geo.get(p) ?? []
        const obs = adelantada(p) ? { v: `hora adelantada: ${desfase(adelanto(p))} después de su envío`, rojo: true } : ''
        return [p.t, p.enviada, Math.round(-adelanto(p) / 1000), p.lat, p.lng, p.vel, p.acc, p.ang, p.estado, gs.map(g => g.nombre).join(' · '), gs.find(g => g.marca)?.marca.hora, obs]
      }),
  }
  const v = r.viajes.find(x => x.trip === trip)
  if (!v) return [posiciones]
  const geocercas = {
    nombre: `Geocercas ${trip}`,
    columnas: [
      { titulo: '#', ancho: 5 },
      { titulo: 'Geocerca', ancho: 28 },
      { titulo: 'Programada', ancho: 20, fecha: true },
      { titulo: 'Equipo entra', ancho: 20, fecha: true },
      { titulo: 'Central marca', ancho: 20, fecha: true },
      { titulo: 'Diferencia', ancho: 12 },
      { titulo: 'Volada', ancho: 8 },
      { titulo: 'Dateros', ancho: 8 },
    ],
    filas: v.filas.map(({ orden, nombre, geocerca, prog, marca: m }) => [
      orden,
      nombre ?? `#${geocerca}`,
      prog,
      m?.entrada?.t,
      m?.hora,
      m?.delta != null ? { v: desfase(m.delta), rojo: estadoMarca(m) === 'mal' } : '',
      m?.volada,
      m?.dateros?.length,
    ]),
  }
  return [posiciones, geocercas]
}

/** El mismo recorrido limitado a [desde, hasta]: el veredicto se recalcula solo con lo que cae dentro. */
export function recortar(r, desde, hasta) {
  const dentro = x => x.t >= desde && x.t <= hasta
  const pos = r.pos.filter(dentro)
  const marcas = r.marcas.filter(dentro)
  const viajes = r.viajes.filter(v => (v.inicio >= desde && v.inicio <= hasta) || v.filas.some(f => f.marca && dentro(f.marca)))
  return {
    ...r,
    pos,
    marcas,
    viajes,
    entra: r.entra.filter(dentro),
    casi: r.casi.filter(dentro),
    sinMarca: r.sinMarca.filter(dentro),
    ventas: r.ventas.filter(dentro),
    cortes: r.cortes.filter(dentro),
    apagados: r.apagados.filter(a => a.vuelve >= desde && a.t <= hasta),
    paradas: r.paradas.filter(d => d.b.t >= desde && d.a.t <= hasta),
    huecos: r.huecos.filter(h => h.b.t >= desde && h.a.t <= hasta),
    veredicto: veredicto(marcas, pos),
  }
}

/**
 * Líneas del log en [desde, hasta] que contienen la consulta (sin distinguir mayúsculas), cada una con la posición
 * del bus a esa hora (la más cercana dentro de 5 min) para poder ponerla en el mapa.
 */
export function buscarEnLog(entradas, pos, consulta, desde, hasta, max = 300) {
  const q = consulta.trim().toLowerCase()
  if (q.length < 3) return { hallados: [], total: 0 }
  const todos = entradas.filter(e => e.t >= desde && e.t <= hasta && `[${e.tag}] ${e.msg}`.toLowerCase().includes(q))
  const hallados = todos.slice(0, max).map((e, k) => ({ n: k + 1, t: e.t, i: e.i, linea: e.n, tag: e.tag, msg: e.msg, p: pos[posicionEn(pos, e.t, 5 * 60_000)] ?? null }))
  return { hallados, total: todos.length }
}

/** CSV de las posiciones (hora local del equipo, tal cual el log). */
export function aCsv(pos) {
  const fila = p => [new Date(p.t).toISOString().slice(0, 19).replace('T', ' '), p.lat, p.lng, p.vel, p.acc, p.ang, p.trip ?? '', p.estado ?? '', new Date(p.enviada).toISOString().slice(11, 19)].join(',')
  return ['fecha_hora,lat,lng,velocidad_kmh,precision_m,angulo,trip,estado,enviada', ...pos.map(fila)].join('\n')
}

export const estadoMarca = m => (!m ? 'sin' : m.delta == null ? 'sin' : Math.abs(m.delta) > OK_MAX ? 'mal' : 'ok')

/** +4:20:31 */
export function desfase(ms) {
  const s = Math.round(Math.abs(ms) / 1000)
  const p2 = n => String(n).padStart(2, '0')
  return `${ms < 0 ? '−' : '+'}${Math.floor(s / 3600)}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`
}
