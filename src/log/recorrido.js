// Recorrido del bus y marcas de geocerca: lo que vio el equipo (ENTERING/EXITING) contra lo que estampó
// la central (header "mark"). El equipo no marca: manda posiciones con events=[] y la central calcula la marca.
import { parseStamp } from './leer.js'

const OK_MAX = 60_000 // diferencia tolerada entre la entrada del equipo y la hora de la central
const HUECO = 120_000 // sin posiciones por más de esto = hueco GPS
const DETENIDO = 60_000 // velocidad ≤ 2 km/h por más de esto = detención

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
  const viajes = [...salidas(eventos).values()]
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
    sinMarca: entra.filter(g => !g.marca),
    paraderos: paraderos(eventos),
    ventas: vendidas,
    ...detenciones(pos),
    veredicto: veredicto(marcas, pos),
  }
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
