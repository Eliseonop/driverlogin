// Reconstruye lo que pasó en un log real: carriles en el tiempo (viaje, conexión, sesión del equipo, sesión de la
// central), mensajes de sesión emparejados con su respuesta, boletos, posición del bus sobre la ruta y hallazgos.
// Solo usa lo que dice el log: lo deducido se marca como tal (estado 'incierta' / 'inferida').
import { duracion, horaLog, leerLog, parseStamp } from './leer.js'

const SESION = new Set(['driver_login', 'driver_logout', 'operation', 'android_command', 'uid_driver'])
const ESPERA_LOGOUT = 60_000 // executeLogout: tope esperando la respuesta
const ESPERA_LOGIN = 30_000
const MISMO_MOMENTO = 2000
const PROCESO_OP = 3000 // si en 3 s no hay rastro de procesamiento, la orden se ignoró

export const ladoTxt = l => (l == null ? '?' : l ? 'B' : 'A')
const soles = centimos => `S/ ${(centimos / 100).toFixed(2)}`

/** Tramos continuos a partir de cambios [{t, v}] (v null = nada). */
function tramos(cambios, hasta) {
  const out = []
  cambios.forEach((c, k) => {
    const fin = cambios[k + 1]?.t ?? hasta
    if (c.v != null && fin > c.t) out.push({ desde: c.t, hasta: fin, ...c.v })
  })
  return out
}

function cambiar(cambios, t, v, igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  const ult = cambios.at(-1)
  if (ult && igual(ult.v, v)) return
  if (ult && ult.t === t) cambios.pop()
  cambios.push({ t, v })
}

/** Último índice con lista[k][campo] <= t (listas ordenadas). */
export function buscar(lista, t, campo = 't') {
  let lo = 0
  let hi = lista.length - 1
  let r = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (lista[m][campo] <= t) {
      r = m
      lo = m + 1
    } else hi = m - 1
  }
  return r
}

export const tramoEn = (lista, t) => {
  const k = buscar(lista, t, 'desde')
  return k >= 0 && t < lista[k].hasta ? lista[k] : null
}

// ── equipo y ruta ─────────────────────────────────────────────────────────────

function infoEquipo(eventos) {
  const info = { versiones: [], unidad: null, padron: null, placa: null, modelo: null, serial: null, ruta: null }
  for (const e of eventos) {
    if (e.tipo === 'estado' || (e.tipo === 'tx' && e.header === 'device_status')) {
      const v = e.data.version && String(e.data.version)
      if (v && !info.versiones.includes(v)) info.versiones.push(v)
      info.modelo ??= e.data.model ?? null
      info.serial ??= e.data.serial ?? null
      info.unidad ??= e.data.id ?? null
    }
    if (e.tipo === 'rx' && e.header === 'login') {
      info.padron ??= e.data.padron ?? null
      info.placa ??= e.data.placa ?? null
      info.unidad ??= e.data.id ?? null
      info.ruta ??= e.data.route ?? null
    }
  }
  return info
}

const metros = (a, b) => {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  return Math.hypot((b.lng - a.lng) * Math.cos(lat) * 111_320, (b.lat - a.lat) * 110_540)
}

/** Paraderos vistos en el log, por lado y orden, con su posición f (0..1) a lo largo de su lado. */
function catalogo(eventos, ruta) {
  const porId = new Map()
  for (const e of eventos) if (e.tipo === 'cercano' && e.paradero?.id != null && Number.isFinite(e.paradero.lat)) porId.set(e.paradero.id, e.paradero)
  let todos = [...porId.values()]
  if (ruta != null && todos.some(p => p.ruta === ruta)) todos = todos.filter(p => p.ruta === ruta)
  const lados = {}
  for (const lado of [false, true]) {
    const ps = todos.filter(p => p.lado === lado).sort((a, b) => a.orden - b.orden)
    let acum = 0
    const cum = ps.map((p, k) => (acum += k ? metros(ps[k - 1], p) : 0))
    const total = acum || 1
    lados[lado] = { paraderos: ps.map((p, k) => ({ ...p, f: ps.length > 1 ? cum[k] / total : 0.5 })), largo: acum }
  }
  return { porId, lados }
}

/** Punto (lat, lng) proyectado sobre la polilínea de paraderos del lado → f 0..1 y distancia en m. */
export function proyectar(cat, lado, lat, lng) {
  const ps = cat.lados[lado]?.paraderos ?? []
  if (!ps.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (ps.length === 1) return { f: ps[0].f, dist: metros(ps[0], { lat, lng }) }
  const cos = Math.cos(lat * (Math.PI / 180))
  const xy = p => [p.lng * cos * 111_320, p.lat * 110_540]
  const [px, py] = xy({ lat, lng })
  let mejor = null
  for (let k = 1; k < ps.length; k++) {
    const [ax, ay] = xy(ps[k - 1])
    const [bx, by] = xy(ps[k])
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy || 1
    const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const dist = Math.hypot(ax + u * dx - px, ay + u * dy - py)
    if (!mejor || dist < mejor.dist) mejor = { f: ps[k - 1].f + u * (ps[k].f - ps[k - 1].f), dist }
  }
  return mejor
}

// ── carriles ────────────────────────────────────────────────────────────────

function carrilViaje(eventos, hasta) {
  const cambios = []
  for (const e of eventos) {
    const esLogin = e.tipo === 'rx' && e.header === 'login'
    const esReport = e.tipo === 'tx' && e.header === 'report'
    if (!esLogin && !esReport) continue
    const d = e.data
    if (typeof d.direction !== 'boolean' || !d.trip) continue
    cambiar(cambios, e.t, { trip: d.trip ?? null, lado: d.direction, estado: d.state ?? null })
  }
  return tramos(cambios, hasta)
}

function carrilConexion(eventos, desde, hasta) {
  const segmentos = []
  const cortes = []
  const intentos = []
  const rx = []
  let abierto = null
  let watchdog = null
  const cerrar = (t, causa, e) => {
    segmentos.push({ ...abierto, hasta: t, causa, iFin: e?.i })
    abierto = null
  }
  for (const e of eventos) {
    switch (e.tipo) {
      case 'conectado':
        if (abierto) cerrar(e.t, 'reemplazado', e)
        abierto = { sid: e.sid, desde: e.t, rx: 0, iIni: e.i }
        break
      case 'rx':
        rx.push(e.t)
        if (!abierto || abierto.sid !== e.sid) {
          if (abierto) cerrar(e.t, 'reemplazado', e)
          abierto = { sid: e.sid, desde: e.t, rx: 0, iIni: e.i }
        }
        abierto.rx++
        abierto.ultimoRx = e.t
        break
      case 'watchdog':
        watchdog = e
        cortes.push({ t: e.t, silencio: e.silencio, i: e.i })
        break
      case 'limpiando':
      case 'falla':
      case 'cerrado':
      case 'timeoutConexion':
        if (abierto && (!e.sid || e.sid === abierto.sid)) {
          const porWatchdog = watchdog && e.t - watchdog.t <= MISMO_MOMENTO
          cerrar(e.t, porWatchdog ? 'watchdog' : e.tipo === 'timeoutConexion' ? 'timeout' : e.motivo ?? 'limpieza', e)
        } else if (!abierto && e.tipo === 'falla') intentos.push({ t: e.t, motivo: e.motivo })
        break
      case 'arranque':
        if (abierto) cerrar(e.t, 'reinicio de la app', e)
        break
    }
  }
  if (abierto) cerrar(hasta, null)
  // Dentro del mismo segundo las líneas pueden venir desordenadas: un cierre pegado a un watchdog es del watchdog.
  const DEL_WATCHDOG = new Set(['limpieza', 'Socket closed', 'Canceled', 'reemplazado'])
  for (const s of segmentos) {
    s.iFin ??= Infinity
    if (DEL_WATCHDOG.has(s.causa) && cortes.some(c => Math.abs(c.t - s.hasta) <= MISMO_MOMENTO)) s.causa = 'watchdog'
  }
  const huecos = []
  let prev = desde
  for (const s of segmentos) {
    if (s.desde - prev > 5000) huecos.push({ desde: prev, hasta: s.desde })
    prev = s.hasta
  }
  if (hasta - prev > 5000) huecos.push({ desde: prev, hasta })
  for (const h of huecos) h.intentos = intentos.filter(x => x.t >= h.desde && x.t <= h.hasta).length
  return { segmentos, huecos, cortes, rx }
}

/** Socket activo en la línea i (por índice: dentro del mismo segundo el orden de las líneas decide). */
const socketEn = (conexion, i) => conexion.segmentos.find(s => s.iIni <= i && i < s.iFin) ?? null

function mensajesSesion(eventos, conexion) {
  const msgs = []
  for (const e of eventos) {
    const seg = socketEn(conexion, e.i)
    if (e.tipo === 'tx' && SESION.has(e.header)) msgs.push({ t: e.t, i: e.i, dir: 'tx', header: e.header, data: e.data, sid: seg?.sid ?? null })
    if (e.tipo === 'rx' && SESION.has(e.header)) msgs.push({ t: e.t, i: e.i, dir: 'rx', header: e.header, data: e.data, sid: e.sid })
    if (e.tipo === 'logoutNoEnviado') {
      const pedido = [...eventos].reverse().find(x => x.t <= e.t && e.t - x.t < 5000 && x.tipo === 'logoutSolicitado')
      msgs.push({ t: e.t, i: e.i, dir: 'tx', header: 'driver_logout', data: { session: pedido?.sesion }, perdido: true })
    }
  }
  return msgs
}

const sesionDe = d => Number(d.session ?? d.sesion)

/** Empareja pedidos con respuestas y marca lo que quedó sin respuesta, cortado o ignorado. */
function emparejar(msgs, eventos, conexion) {
  for (const [k, m] of msgs.entries()) {
    if (m.dir === 'tx' && m.header === 'driver_logout' && !m.perdido) {
      const s = sesionDe(m.data)
      m.sesion = s
      const r = msgs.slice(k + 1).find(x => x.dir === 'rx' && x.header === 'driver_logout' && Number(x.data.id) === s && x.t - m.t <= ESPERA_LOGOUT && !x.pedido)
      if (r) {
        m.respuesta = r
        r.pedido = m
        continue
      }
      m.sinRespuesta = true
      const seg = socketEn(conexion, m.i)
      if (seg && seg.hasta - m.t <= ESPERA_LOGOUT && seg.causa) m.corte = { t: seg.hasta, i: seg.iFin, causa: seg.causa, sid: seg.sid }
      m.rxDespues = seg ? eventos.filter(e => e.tipo === 'rx' && e.sid === seg.sid && e.i > m.i && e.i < seg.iFin && e.t - m.t <= ESPERA_LOGOUT).length : 0
      const reco = conexion.segmentos.find(x => x.iIni > m.i && x.desde - m.t <= ESPERA_LOGOUT)
      if (reco) m.reconexion = { t: reco.desde, sid: reco.sid, reintento: msgs.some(x => x.dir === 'tx' && x.header === 'driver_logout' && x.i > reco.iIni && x.t - reco.desde <= 10_000 && sesionDe(x.data) === s) }
    }
    if (m.dir === 'tx' && m.header === 'driver_login') {
      const r = msgs.slice(k + 1).find(x => x.dir === 'rx' && x.header === 'driver_login' && x.t - m.t <= ESPERA_LOGIN && !x.pedido)
      if (r) {
        m.respuesta = r
        r.pedido = m
      } else m.sinRespuesta = true
    }
    if (m.dir === 'rx' && (m.header === 'operation' || m.header === 'android_command')) {
      const rastro = eventos.find(
        e =>
          e.t >= m.t &&
          e.t - m.t <= PROCESO_OP &&
          e.i > m.i &&
          (['operacionProcesada', 'operacionDuplicada', 'remotoCierre', 'remotoIgnorado', 'operacionError'].includes(e.tipo) || (e.tipo === 'tx' && e.header === 'operation')),
      )
      m.procesada = !!rastro
      if (rastro?.tipo === 'remotoIgnorado') m.resultado = `sesión ${rastro.sesion} ${rastro.motivo}`
      if (rastro?.tipo === 'operacionDuplicada') m.resultado = 'duplicada (solo eco)'
      if (rastro?.tipo === 'remotoCierre') m.resultado = `cierra ${rastro.sesion}`
    }
  }
  for (const m of msgs) if (m.dir === 'rx' && m.header === 'driver_login' && !m.pedido) m.espontanea = true
}

function leerBoletos(eventos) {
  const vistos = new Map()
  const acks = new Set()
  for (const e of eventos) {
    if (e.tipo === 'tx' && e.header === 'tickets') {
      for (const b of e.data.tickets ?? []) {
        const c = Number(b.correlative ?? b.correlativo)
        if (vistos.has(c)) {
          vistos.get(c).envios++
          continue
        }
        vistos.set(c, { t: parseStamp(String(b.time ?? '')) ?? e.t, i: e.i, sesion: Number(b.session ?? b.sesion), correlativo: c, precio: Number(b.price ?? 0), envios: 1 })
      }
    }
    if (e.tipo === 'rx' && e.header === 'tickets') for (const b of e.data.tickets ?? []) acks.add(Number(b.correlative))
  }
  const out = [...vistos.values()].sort((a, b) => a.t - b.t)
  for (const b of out) b.ack = acks.has(b.correlativo)
  return out
}

/** Lado conocido de cada sesión (por driver_login, memoria, restauración). */
function ladosDeSesion(eventos, msgs) {
  const lados = new Map()
  for (const m of msgs) if (m.dir === 'rx' && m.header === 'driver_login') for (const s of m.data.sessions ?? []) lados.set(Number(s.id), s.direction === true)
  for (const e of eventos) if ((e.tipo === 'sesionMemoria' || e.tipo === 'restauracion') && e.lado != null && !lados.has(e.sesion)) lados.set(e.sesion, e.lado)
  return lados
}

/** Sesión que el equipo tiene en memoria (la que usa para vender y cerrar en terminal). */
function carrilEquipo(eventos, msgs, boletos, lados, desde, hasta) {
  const cambios = []
  const poner = (t, sesion, fuente) => {
    if ((cambios.at(-1)?.v?.sesion ?? null) === sesion) return
    const previa = !cambios.length && sesion != null && (fuente === 'memoria' || fuente === 'boletos')
    cambiar(cambios, previa ? desde : t, sesion == null ? null : { sesion, lado: lados.get(sesion) ?? null, fuente: previa ? 'previa' : fuente })
  }
  const bloqueos = eventos.filter(e => e.tipo === 'loginBloqueado')
  const linea = [
    ...msgs.filter(m => m.dir === 'rx' && (m.header === 'driver_login' || m.header === 'driver_logout')).map(m => ({ t: m.t, i: m.i, m })),
    ...eventos.filter(e => ['sesionActivada', 'sesionMemoria', 'restauracion', 'logoutConfirmado', 'arranque'].includes(e.tipo)).map(e => ({ t: e.t, i: e.i, e })),
    ...boletos.map(b => ({ t: b.t, i: b.i, b })),
  ].sort((a, b) => a.t - b.t || a.i - b.i)
  const actual = () => cambios.at(-1)?.v?.sesion ?? null
  for (const x of linea) {
    if (x.m?.header === 'driver_login') {
      const s = x.m.data.sessions?.[0]
      if (x.m.data.error || !s) continue
      if (bloqueos.some(b => b.t >= x.t && b.t - x.t <= MISMO_MOMENTO)) continue
      poner(x.t, Number(s.id), 'driver_login')
    } else if (x.m?.header === 'driver_logout') {
      if (!x.m.data.error && actual() === Number(x.m.data.id)) poner(x.t, null)
    } else if (x.e?.tipo === 'logoutConfirmado') {
      if (actual() === x.e.sesion) poner(x.t, null)
    } else if (x.e?.tipo === 'restauracion') {
      if (x.e.resultado === 'restaurada') poner(x.t, x.e.sesion, 'restaurada')
    } else if (x.e?.tipo === 'arranque') {
      cambios.push({ t: x.t, v: cambios.at(-1)?.v ?? null, reinicio: true })
    } else if (x.e) {
      poner(x.t, x.e.sesion, x.e.tipo === 'sesionActivada' ? 'driver_login' : 'memoria')
    } else if (x.b && Number.isFinite(x.b.sesion)) {
      poner(x.t, x.b.sesion, 'boletos')
    }
  }
  return tramos(cambios, hasta)
}

/** Sesión abierta en la central para esta unidad, según lo que la central le dijo al equipo. */
function carrilCentral(msgs, lados, hasta) {
  const cambios = []
  const actual = () => cambios.at(-1)?.v ?? null
  const opsSesion = msgs.filter(m => m.dir === 'rx' && (m.header === 'operation' || m.header === 'android_command') && m.data.key === 'sesion' && /^\d+$/.test(String(m.data.value)))
  for (const m of msgs) {
    if (m.dir === 'rx' && m.header === 'driver_login' && !m.data.error && m.data.sessions?.[0]) {
      const s = Number(m.data.sessions[0].id)
      cambiar(cambios, m.t, { sesion: s, lado: lados.get(s) ?? null, estado: 'confirmada' })
    } else if (m.dir === 'rx' && m.header === 'driver_logout' && !m.data.error) {
      if (actual()?.sesion === Number(m.data.id)) cambiar(cambios, m.t, null)
    } else if (m.dir === 'tx' && m.header === 'driver_logout' && m.sinRespuesta && actual()?.sesion === m.sesion && actual().estado === 'confirmada') {
      // Si más tarde la central pide cerrar OTRA sesión más nueva, la central sí procesó este cierre y abrió esa.
      const otra = opsSesion.find(o => o.t > m.t && Number(o.data.value) > m.sesion)
      const v = otra
        ? { sesion: Number(otra.data.value), lado: lados.get(Number(otra.data.value)) ?? null, estado: 'inferida', cerro: m.sesion }
        : { sesion: m.sesion, lado: actual().lado, estado: 'incierta' }
      cambiar(cambios, m.t, v)
    } else if (opsSesion.includes(m) && actual()?.sesion !== Number(m.data.value)) {
      const s = Number(m.data.value)
      cambiar(cambios, m.t, { sesion: s, lado: lados.get(s) ?? null, estado: 'inferida' })
    }
  }
  return tramos(cambios, hasta)
}

/** Muestras de posición del bus sobre la ruta: reports, device_status y paraderos cercanos. */
function posicionesBus(eventos, cat, viaje) {
  const out = []
  const ladoEn = t => tramoEn(viaje, t)?.lado ?? null
  const agregar = (t, lat, lng, fuente, ladoDado) => {
    let lado = ladoDado ?? ladoEn(t)
    let p = lado != null ? proyectar(cat, lado, lat, lng) : null
    if (!p) {
      const a = proyectar(cat, false, lat, lng)
      const b = proyectar(cat, true, lat, lng)
      if (!a && !b) return
      lado = !a || (b && b.dist < a.dist)
      p = lado ? b : a
    }
    out.push({ t, lado, f: p.f, dist: p.dist, fuente })
  }
  for (const e of eventos) {
    if (e.tipo === 'tx' && e.header === 'report') {
      for (const q of e.data.positions ?? []) agregar(parseStamp(String(q.time ?? '')) ?? e.t, Number(q.lat), Number(q.lng), 'report', typeof e.data.direction === 'boolean' ? e.data.direction : null)
    } else if (e.tipo === 'estado' && e.data.lat != null) agregar(e.t, Number(e.data.lat), Number(e.data.lng), 'device_status')
    else if (e.tipo === 'cercano' && e.paradero) agregar(e.t, e.paradero.lat, e.paradero.lng, 'paradero')
    else if (e.tipo === 'paraderoActual' && cat.porId.has(e.id)) {
      const p = cat.porId.get(e.id)
      agregar(e.t, p.lat, p.lng, 'paradero')
    }
  }
  return out.filter(p => p.dist < 1500).sort((a, b) => a.t - b.t)
}

// ── hitos y hallazgos ─────────────────────────────────────────────────────────

function hitosDe(msgs, conexion, viaje, eventos) {
  const h = []
  for (const m of msgs) {
    if (m.header === 'driver_login' && m.dir === 'rx') {
      const s = m.data.sessions?.[0]
      h.push(m.data.error ? { t: m.t, i: m.i, tipo: 'error', texto: `login rechazado: ${m.data.message}` } : { t: m.t, i: m.i, tipo: 'login', texto: `driver_login → #${s?.id} ${ladoTxt(s?.direction)}${m.espontanea ? ' (la central sola)' : ''}` })
    }
    if (m.header === 'driver_logout' && m.dir === 'tx')
      h.push({ t: m.t, i: m.i, tipo: m.perdido || m.sinRespuesta ? 'sin-respuesta' : 'logout-tx', texto: `driver_logout #${sesionDe(m.data)} ${m.perdido ? 'no salió (sin socket)' : m.sinRespuesta ? 'SIN RESPUESTA' : 'enviado'}` })
    if (m.header === 'driver_logout' && m.dir === 'rx') h.push({ t: m.t, i: m.i, tipo: 'logout', texto: `central: ${m.data.title} #${m.data.id}` })
    if ((m.header === 'operation' || m.header === 'android_command') && m.dir === 'rx')
      h.push({ t: m.t, i: m.i, tipo: m.procesada ? 'orden' : 'ignorada', texto: `${m.header} ${m.data.key}=${m.data.value}${m.procesada ? '' : ' ignorada'}` })
  }
  for (const c of conexion.cortes) {
    const cerca = msgs.find(m => m.dir === 'tx' && Math.abs(m.t - c.t) <= MISMO_MOMENTO && m.header !== 'operation')
    if (cerca) h.push({ t: c.t, i: c.i, tipo: 'corte', texto: `watchdog corta el socket junto a ${cerca.header}` })
  }
  viaje.forEach((v, k) => k && viaje[k - 1].lado !== v.lado && h.push({ t: v.desde, tipo: 'viaje', texto: `viaje ${v.trip}: pasa al lado ${ladoTxt(v.lado)}` }))
  let ultArranque = -Infinity
  for (const e of eventos)
    if (e.tipo === 'arranque' && e.t - ultArranque > 60_000) {
      ultArranque = e.t
      h.push({ t: e.t, i: e.i, tipo: 'arranque', texto: 'la app arranca' })
    }
  for (const e of eventos) if (e.tipo === 'terminal') h.push({ t: e.t, i: e.i, tipo: 'terminal', texto: `terminal → cerrar #${e.sesion}` })
  return h.sort((a, b) => a.t - b.t)
}

function hallazgosDe(rep) {
  const { mensajes, conexion, equipo, central, boletos, viaje, info, eventos } = rep
  const out = []
  const logouts = mensajes.filter(m => m.dir === 'tx' && m.header === 'driver_logout')
  const respondidos = logouts.filter(m => m.respuesta)

  for (const m of logouts.filter(x => x.perdido || x.sinRespuesta)) {
    const d = []
    const s = sesionDe(m.data)
    if (m.perdido) d.push('No había socket: el mensaje no salió y la app no lo vuelve a intentar.')
    else {
      if (m.corte && m.corte.t - m.t <= MISMO_MOMENTO)
        d.push(`En el mismo segundo el socket SID ${m.corte.sid} se cerró (${m.corte.causa === 'watchdog' ? 'watchdog por silencio' : m.corte.causa}). Un cancel() descarta lo que está en cola: el mensaje pudo no salir.`)
      else if (m.corte) d.push(`El socket SID ${m.corte.sid} se cerró ${duracion(m.corte.t - m.t)} después (${m.corte.causa}).`)
      if (m.rxDespues > 0) d.push(`El socket siguió vivo: llegaron ${m.rxDespues} mensajes en el siguiente minuto, pero ninguno fue la respuesta.`)
      if (m.reconexion) d.push(`Reconectó a las ${horaLog(m.reconexion.t)} (SID ${m.reconexion.sid}) ${m.reconexion.reintento ? 'y reenvió el cierre.' : 'y NO reintentó el cierre.'}`)
      if (respondidos.length) d.push(`Los otros ${respondidos.length} cierres de este log sí tuvieron respuesta.`)
      else d.push('La central suele responder en menos de 1 s, incluso con "Ya estaba cerrada".')
    }
    const despues = boletos.filter(b => b.sesion === s && b.t > m.t)
    const siguio = tramoEn(equipo, rep.hasta - 1)?.sesion === s
    out.push({ nivel: 'error', t: m.t, i: m.i, titulo: `driver_logout #${s} ${m.perdido ? 'no salió' : 'sin respuesta'} (${horaLog(m.t)})`, detalle: d, sesion: s, siguio, despues })
  }

  // La sesión siguió abierta en el equipo y vendió.
  const sesionesFallidas = [...new Set(out.map(h => h.sesion))]
  for (const s of sesionesFallidas) {
    const primero = logouts.find(m => sesionDe(m.data) === s && (m.sinRespuesta || m.perdido))
    if (logouts.some(m => sesionDe(m.data) === s && m.respuesta)) continue
    const despues = boletos.filter(b => b.sesion === s && b.t > primero.t)
    const seg = equipo.filter(x => x.sesion === s).at(-1)
    const d = [`Sin respuesta la app no marca la sesión como cerrada: siguió usándola ${seg ? `hasta las ${horaLog(seg.hasta)}${seg.hasta >= rep.hasta ? ' (fin del log)' : ''}` : ''}.`]
    if (despues.length) d.push(`Vendió ${despues.length} boletos con la #${s} después del cierre (${horaLog(despues[0].t)}–${horaLog(despues.at(-1).t)}, ${soles(despues.reduce((a, b) => a + b.precio, 0))}).`)
    out.push({ nivel: 'error', t: despues[0]?.t ?? primero.t, i: despues[0]?.i ?? primero.i, titulo: `La sesión #${s} nunca se cerró en el equipo`, detalle: d })
  }

  // Lado del viaje distinto al lado de la sesión mientras vende.
  for (const v of viaje.filter(x => x.estado === 'R')) {
    for (const e of equipo) {
      const a = Math.max(v.desde, e.desde)
      const b = Math.min(v.hasta, e.hasta)
      if (b - a < 5 * 60_000 || e.lado == null || e.lado === v.lado) continue
      const bs = boletos.filter(x => x.t >= a && x.t < b)
      out.push({ nivel: 'aviso', t: a, titulo: `Viaje lado ${ladoTxt(v.lado)} con sesión #${e.sesion} de lado ${ladoTxt(e.lado)}`, detalle: [`${horaLog(a)}–${horaLog(b)} (${duracion(b - a)}), trip ${v.trip}: ${bs.length} boletos.`] })
    }
  }

  // Órdenes de la central que la app no procesó.
  const ops = mensajes.filter(m => m.dir === 'rx' && (m.header === 'operation' || m.header === 'android_command'))
  const grupos = new Map()
  for (const m of ops) {
    const k = `${m.header} ${m.data.key}=${m.data.value}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(m)
  }
  const conocidas = new Set([...equipo.map(e => e.sesion), ...boletos.map(b => b.sesion)])
  for (const [k, ms] of grupos) {
    const ign = ms.filter(m => !m.procesada)
    if (!ign.length) continue
    const d = [`Llegó ${ms.length} ${ms.length === 1 ? 'vez' : 'veces'} (${horaLog(ms[0].t)}–${horaLog(ms.at(-1).t)}) y la app no dejó rastro de procesarla${info.versiones.some(v => /^1\.0\.6[4-8]$/.test(v)) ? ': en 1.0.64–1.0.68 el header "operation" está desactivado' : ''}.`]
    const val = Number(ms[0].data.value)
    if (ms[0].data.key === 'sesion' && Number.isFinite(val) && !conocidas.has(val)) {
      d.push(`La sesión #${val} nunca llegó al equipo (no hubo driver_login con ese id).`)
      const cerrada = central.find(c => c.estado === 'inferida' && c.sesion === val && c.cerro != null)
      if (cerrada) d.push(`Es más nueva que la #${cerrada.cerro}: probablemente la B automática que la central crea al cerrar una A. O sea, la central sí cerró la #${cerrada.cerro} hacia las ${horaLog(cerrada.desde)}.`)
    }
    out.push({ nivel: 'error', t: ms[0].t, i: ms[0].i, titulo: `Orden ${k} ignorada`, detalle: d })
  }

  // Reconexiones por watchdog.
  const porWatchdog = conexion.segmentos.filter(s => s.causa === 'watchdog')
  if (porWatchdog.length >= 5) {
    const sil = conexion.cortes.map(c => c.silencio).sort((a, b) => a - b)
    const reales = conexion.segmentos.filter(s => s.causa && s.causa !== 'watchdog' && s.causa !== 'reemplazado').length
    out.push({
      nivel: 'aviso',
      t: porWatchdog[0].hasta,
      i: porWatchdog[0].iFin,
      titulo: `${porWatchdog.length} reconexiones por watchdog`,
      detalle: [
        `El watchdog corta tras ${duracion(sil[0])}–${duracion(sil.at(-1))} sin mensajes; ${reales} cierres fueron por otra causa.`,
        'Con el bus quieto la central habla cada ~5 min: el socket no estaba caído, estaba en silencio.',
      ],
    })
  }

  for (const e of eventos.filter(x => x.tipo === 'loginBloqueado')) out.push({ nivel: 'aviso', t: e.t, i: e.i, titulo: `driver_login descartado (${horaLog(e.t)})`, detalle: ['Tras un logout forzado la app descarta el siguiente driver_login.'] })
  for (const e of eventos.filter(x => x.tipo === 'forzado')) out.push({ nivel: 'aviso', t: e.t, i: e.i, titulo: `Logout forzado ${e.motivo} (#${e.sesion})`, detalle: [] })

  if (!eventos.some(e => e.tipo === 'sesionActivada' || e.tipo === 'logoutConfirmado') && info.versiones.length)
    out.push({
      nivel: 'info',
      t: rep.desde,
      titulo: `Log de ${info.versiones.join(', ')}: sin logs de sesión nuevos`,
      detalle: ['La sesión del equipo se deduce de driver_login, "Primera sesión obtenida" y los boletos; la de la central, de sus respuestas y órdenes.'],
    })
  return out.sort((a, b) => ({ error: 0, aviso: 1, info: 2 })[a.nivel] - { error: 0, aviso: 1, info: 2 }[b.nivel] || a.t - b.t)
}

// ── entrada ───────────────────────────────────────────────────────────────────

export function reconstruir(texto, archivo = 'log') {
  const { entradas, eventos } = leerLog(texto)
  if (!entradas.length) throw new Error('No hay líneas con formato de LogManager ("YYYY-MM-DD HH:mm:ss [TAG] mensaje").')
  const desde = entradas[0].t
  const hasta = entradas.at(-1).t + 1000
  const info = infoEquipo(eventos)
  const cat = catalogo(eventos, info.ruta)
  const viaje = carrilViaje(eventos, hasta)
  const conexion = carrilConexion(eventos, desde, hasta)
  const mensajes = mensajesSesion(eventos, conexion)
  emparejar(mensajes, eventos, conexion)
  const boletos = leerBoletos(eventos)
  const lados = ladosDeSesion(eventos, mensajes)
  const equipo = carrilEquipo(eventos, mensajes, boletos, lados, desde, hasta)
  const central = carrilCentral(mensajes, lados, hasta)
  const posiciones = posicionesBus(eventos, cat, viaje)
  const rep = { archivo, desde, hasta, entradas, eventos, info, cat, viaje, conexion, mensajes, boletos, equipo, central, posiciones }
  rep.hitos = hitosDe(mensajes, conexion, viaje, eventos)
  rep.hallazgos = hallazgosDe(rep)
  rep.marcas = eventos.filter(e => e.tipo === 'marca')
  rep.estados = eventos.filter(e => e.tipo === 'estado')
  rep.paraderosActuales = eventos.filter(e => e.tipo === 'paraderoActual')
  return rep
}

/** Estado reconstruido en el instante t. */
export function estadoEn(rep, t) {
  const viaje = tramoEn(rep.viaje, t)
  const k = buscar(rep.posiciones, t)
  const prev = rep.posiciones[k]
  const next = rep.posiciones[k + 1]
  const lado = viaje?.lado ?? prev?.lado ?? next?.lado ?? false
  let f = null
  if (prev?.lado === lado && next?.lado === lado) f = prev.f + ((next.f - prev.f) * (t - prev.t)) / Math.max(1, next.t - prev.t)
  else if (prev?.lado === lado) f = prev.f
  else if (next?.lado === lado) {
    const ini = viaje?.desde ?? t
    f = (next.f * (t - ini)) / Math.max(1, next.t - ini)
  } else f = 0
  const logout = rep.mensajes.find(m => m.dir === 'tx' && m.header === 'driver_logout' && !m.perdido && m.t <= t && t < (m.respuesta?.t ?? Math.min(m.t + ESPERA_LOGOUT, m.corte?.t ?? Infinity)))
  const ult = (lista, max = Infinity) => {
    const j = buscar(lista, t)
    return j >= 0 && t - lista[j].t <= max ? lista[j] : null
  }
  const nb = buscar(rep.boletos, t) + 1
  return {
    t,
    viaje,
    bus: { lado, f: Math.max(0, Math.min(1, f)) },
    equipo: tramoEn(rep.equipo, t),
    central: tramoEn(rep.central, t),
    conexion: tramoEn(rep.conexion.segmentos, t),
    esperandoLogout: logout,
    marca: ult(rep.marcas, 30 * 60_000),
    paradero: ult(rep.paraderosActuales, 10 * 60_000),
    estado: ult(rep.estados),
    boletos: rep.boletos.slice(0, nb),
    linea: Math.max(0, buscar(rep.entradas, t)),
  }
}
