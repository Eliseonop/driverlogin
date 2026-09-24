// Mundo simulado: reloj virtual + cola de eventos + red + equipo + central + posición real del bus.
// Todo es determinista: el mismo guion produce siempre el mismo log.

import { Device } from './device.js'
import { Server } from './server.js'
import { tramo, offset, distA } from './geo.js'
import { stamp, parseStamp, DIA, MIN, inicioDia, minutosDelDia } from './time.js'
import { RETORNO_AUTO_A, RETORNO_AUTO_B } from './policy.js'
import RUTA_124 from '../data/ruta124.js'

export const CHOFERES_DEMO = [
  { dni: '40000001', clave: '0001', driver_id: 131, code: 'ID131', nombre: 'Chofer 1' },
  { dni: '40000002', clave: '0002', driver_id: 58, code: 'ID58', nombre: 'Chofer 2' },
]

/** Valor de una config de retorno en la UI → lista ConfigRuta. 'ausente' = no viene en routes-data. */
export function configsDesde(retorno, route) {
  const out = []
  for (const [nombre, v] of [[RETORNO_AUTO_B, retorno.b], [RETORNO_AUTO_A, retorno.a]]) {
    if (v === 'ausente') continue
    out.push({ nombre, ruta: route, data: v === 'texto' ? 'true' : v === true || v === 'true' })
  }
  return out
}

export function configPorDefecto(over = {}) {
  const ruta = over.ruta ?? RUTA_124
  const retorno = { b: true, a: true, ...(over.retorno ?? {}) }
  return {
    perfil: 'actual',
    logsNuevos: true,
    serial: 'F31P50544G00242',
    inicio: parseStamp('2026-09-23 06:15:00'),
    inicioEn: 'PRDO INICIAL',
    choferes: CHOFERES_DEMO,
    ...over,
    ruta,
    route: ruta.route,
    vehicle: ruta.vehicle,
    paraderos: ruta.paraderos,
    retorno,
    configs: over.configs ?? configsDesde(retorno, ruta.route),
    red: { subidaMs: 250, bajadaMs: 250, ...(over.red ?? {}) },
    servidor: {
      autoSesion: 'tras_cerrar_a',
      autoSesionUsaConfig: true,
      autoSesionDelayMs: 200,
      ladoForzado: null,
      idReenvioFijo: true,
      reenvioMs: 5 * MIN,
      maxReenvios: 40,
      configComoTexto: false,
      primerId: 35417,
      trip: 39084,
      ...(over.servidor ?? {}),
    },
  }
}

export class World {
  constructor(over = {}) {
    this.cfg = configPorDefecto(over)
    this.now = this.cfg.inicio
    this.seq = 0
    this.cola = []
    this.logs = []
    this.eventos = []
    this.acciones = []
    this.historial = []
    this.redArriba = true
    const p0 = this.paradero(this.cfg.inicioEn)
    this.bus = p0 ? { lat: p0.latitud, lng: p0.longitud, acc: 5 } : { lat: -11.93, lng: -76.96, acc: 5 }
    this.server = new Server(this, this.cfg)
    this.device = new Device(this, this.cfg)
    this.device.arrancar()
    this.programar(60_000, () => this.tickProtector(), 'protector')
    this.avanzar(6_000)
  }

  // ── reloj y cola ────────────────────────────────────────────────────────────

  programar(delay, fn, label = '') {
    const ev = { t: this.now + Math.max(0, delay), seq: this.seq++, fn, label }
    let i = this.cola.length
    while (i > 0 && (this.cola[i - 1].t > ev.t || (this.cola[i - 1].t === ev.t && this.cola[i - 1].seq > ev.seq))) i--
    this.cola.splice(i, 0, ev)
    return ev
  }

  avanzar(ms) {
    const fin = this.now + ms
    let guard = 0
    while (this.cola.length && this.cola[0].t <= fin) {
      const ev = this.cola.shift()
      this.now = Math.max(this.now, ev.t)
      ev.fn()
      this.registrarEstado()
      if (++guard > 500_000) throw new Error('Simulación sin fin (¿bucle de eventos?)')
    }
    this.now = fin
  }

  /** Guarda cada cambio de sesión activa del equipo (para la línea de tiempo). */
  registrarEstado() {
    const s = this.device.m.sessionDriver
    const id = this.device.encendido ? s?.id ?? null : null
    const ult = this.historial[this.historial.length - 1]
    if (ult?.id === id && (id == null || ult.lado === s.direction)) return
    this.historial.push({ t: this.now, id, lado: id == null ? null : s.direction })
  }

  avanzarHasta(ms) {
    if (ms > this.now) this.avanzar(ms - this.now)
  }

  tickProtector() {
    this.device.tickNocturno()
    this.programar(60_000, () => this.tickProtector(), 'protector')
  }

  // ── red ─────────────────────────────────────────────────────────────────────

  alServidor(header, data) {
    this.programar(this.cfg.red.subidaMs, () => this.server.recibir(header, data), `→ ${header}`)
  }

  alEquipo(header, data) {
    this.programar(this.cfg.red.bajadaMs, () => this.device.recibir(header, data), `← ${header}`)
  }

  // ── registro ────────────────────────────────────────────────────────────────

  log(tag, msg) {
    this.logs.push({ t: this.now, tag, msg, i: this.logs.length })
  }

  evento(tipo, texto, extra = {}) {
    this.eventos.push({ t: this.now, tipo, texto, ...extra })
  }

  lineas({ orden = 'asc' } = {}) {
    const ls = this.logs.map(l => `${stamp(l.t)} [${l.tag}] ${l.msg}`)
    return orden === 'desc' ? ls.reverse() : ls
  }

  exportarLog(orden = 'desc') {
    return this.lineas({ orden }).join('\n')
  }

  // ── consultas ───────────────────────────────────────────────────────────────

  paradero(ref) {
    if (ref == null) return null
    if (typeof ref === 'object') return ref
    const ps = this.cfg.paraderos
    if (typeof ref === 'number') return ps.find(p => p.id === ref) ?? null
    const [nombre, lado] = String(ref).split('@')
    const cands = ps.filter(p => p.nombre.toLowerCase() === nombre.trim().toLowerCase())
    if (lado) return cands.find(p => p.lado === (lado.trim().toUpperCase() === 'B')) ?? null
    return cands[0] ?? null
  }

  get sesion() {
    return this.device.m.sessionDriver
  }

  abiertasServidor() {
    return this.server.sesiones.filter(s => s.open)
  }

  logsCon(re) {
    return this.logs.filter(l => (typeof re === 'string' ? l.msg.includes(re) || l.tag === re : re.test(`[${l.tag}] ${l.msg}`)))
  }

  // ── movimiento del bus ──────────────────────────────────────────────────────

  moverBus(lat, lng, acc = 5) {
    this.bus = { lat, lng, acc }
    this.device.actualizarGps()
  }

  irA(ref, { fuera = 0 } = {}) {
    const p = this.paradero(ref)
    if (!p) throw new Error(`Paradero no encontrado: ${ref}`)
    const pos = fuera ? offset(p.latitud, p.longitud, p.radio + fuera, 0) : { lat: p.latitud, lng: p.longitud }
    this.moverBus(pos.lat, pos.lng)
    return p
  }

  /** Puntos GPS para recorrer un lado desde la posición actual por sus paraderos en orden (desde..hasta). */
  planRecorrido({ lado, desde = 1, hasta, kmh = 30, paso = 40 }) {
    const l = lado === 'B' || lado === true
    const ps = this.cfg.paraderos.filter(p => p.lado === l).sort((a, b) => a.orden - b.orden)
    const fin = hasta == null || hasta === '' ? Infinity : typeof hasta === 'number' ? hasta : this.paradero(`${hasta}@${l ? 'B' : 'A'}`)?.orden ?? Infinity
    const puntos = []
    let cur = { lat: this.bus.lat, lng: this.bus.lng }
    for (const wp of ps.filter(p => p.orden >= desde && p.orden <= fin)) {
      puntos.push(...tramo(cur, { lat: wp.latitud, lng: wp.longitud }, paso))
      cur = { lat: wp.latitud, lng: wp.longitud }
    }
    return { puntos, pasoMs: Math.round((paso / ((kmh * 1000) / 3600)) * 1000) }
  }

  /** Recorre un lado desde la posición actual pasando por sus paraderos en orden (desde..hasta). */
  recorrer({ lado, desde = 1, hasta, kmh = 30, paso = 40 }) {
    const { puntos, pasoMs } = this.planRecorrido({ lado, desde, hasta, kmh, paso })
    for (const pt of puntos) {
      this.avanzar(pasoMs)
      this.moverBus(pt.lat, pt.lng)
    }
  }

  // ── acciones (UI, escenarios y reproducción de logs) ────────────────────────

  accion(tipo, a = {}) {
    this.acciones.push({ t: this.now, tipo, a })
    try {
      return this.ejecutar(tipo, a)
    } finally {
      this.registrarEstado()
    }
  }

  ejecutar(tipo, a) {
    const d = this.device
    const s = this.server
    const chofer = a.dni ? this.cfg.choferes.find(c => c.dni === a.dni) : this.cfg.choferes[0]
    const sesionRef = ref => (ref === 'activa' || ref == null ? d.m.sessionDriver?.id ?? s.abierta(d.vehicle)?.id : Number(ref))
    switch (tipo) {
      case 'login':
        this.evento('accion', `👆 Login manual ${a.dni ?? chofer.dni}`)
        return d.performLogin(a.dni ?? chofer.dni, a.clave ?? chofer.clave, 'manual')
      case 'nfc':
        this.evento('accion', `🪪 Tarjeta NFC ${a.dni ?? chofer?.dni}`)
        return s.tarjetaNfc(a.dni ?? chofer?.dni)
      case 'terminarVenta':
        this.evento('accion', '👆 Terminar venta (logout manual)')
        if (d.m.sessionDriver) d.logout(d.m.sessionDriver.id)
        return
      case 'cerrarRemoto': {
        const id = sesionRef(a.sesion)
        this.evento('accion', `🛰️ Central cierra sesión ${id} vía ${a.via ?? 'operation'}`)
        return a.via === 'android_command' ? s.enviarAndroidCommand('sesion', id) : s.enviarOperation('sesion', id, a)
      }
      case 'logoutConductor':
        this.evento('accion', `🛰️ Central logout-conductor vía ${a.via ?? 'android_command'}`)
        return a.via === 'operation' ? s.enviarOperation('logout-conductor', '') : s.enviarAndroidCommand('logout-conductor', '')
      case 'loginConductor': {
        const v = a.value ?? `${chofer.dni} ${chofer.clave}`
        this.evento('accion', `🛰️ Central login-conductor "${v}" vía ${a.via ?? 'android_command'}`)
        return a.via === 'operation' ? s.enviarOperation('login-conductor', v) : s.enviarAndroidCommand('login-conductor', v)
      }
      case 'cerrarEnServidor':
        return s.cerrarSoloEnServidor(sesionRef(a.sesion))
      case 'viaje':
        return s.cambiarViaje(a.direction)
      case 'irA':
        this.evento('accion', `📍 Bus en ${a.paradero}`)
        return this.irA(a.paradero, a)
      case 'mover':
        return this.moverBus(a.lat, a.lng, a.acc)
      case 'recorrer':
        this.evento('accion', `🚌 Recorre lado ${a.lado}${a.hasta ? ` hasta ${a.hasta}` : ''}`)
        return this.recorrer(a)
      case 'esperar':
        return this.avanzar((a.s ?? 0) * 1000 + (a.min ?? 0) * MIN)
      case 'hora': {
        const [h, m] = String(a.hora).split(':').map(Number)
        let t = inicioDia(this.now) + (h * 60 + m) * MIN
        if (t <= this.now) t += DIA
        return this.avanzarHasta(t)
      }
      case 'red':
        this.evento('accion', a.on ? '📶 Vuelve la señal' : '📵 Se cae la señal')
        return a.on ? this.redVuelve() : this.redCae()
      case 'gpsFix':
        this.evento('accion', a.on ? '🛰️ GPS con fix' : '🚫 GPS sin fix')
        d.gpsFix = !!a.on
        if (a.on) d.actualizarGps()
        return
      case 'reiniciar':
        this.evento('accion', '🔄 Reinicio de la app')
        d.apagar()
        return this.programar(2000, () => d.arrancar(), 'arranque')
      case 'apagar':
        return this.apagarEquipo('apagado manual')
      case 'encender':
        this.evento('accion', '🔌 Equipo encendido')
        return d.arrancar()
      case 'bateriaCritica':
        this.evento('accion', '🪫 Batería crítica 10%')
        return d.bateriaCritica()
      case 'energy':
        this.evento('accion', '🔋 Batería 16% sin cargar (ENERGY)')
        return d.energyBaja()
      case 'cargar':
        this.evento('accion', '🔌 Conectan el cargador')
        return d.cargar()
      case 'noche':
        return this.accion('hora', { hora: '02:31' })
      case 'config':
        this.cfg.retorno = { ...this.cfg.retorno, ...a }
        this.cfg.configs = configsDesde(this.cfg.retorno, this.cfg.route)
        return this.evento('accion', `⚙️ Config ruta: b=${this.cfg.retorno.b} a=${this.cfg.retorno.a}`)
      case 'servidor':
        Object.assign(this.cfg.servidor, a)
        return this.evento('accion', `⚙️ Central: ${JSON.stringify(a)}`)
      default:
        throw new Error(`Acción desconocida: ${tipo}`)
    }
  }

  redCae() {
    this.redArriba = false
    this.device.desconectar()
  }

  redVuelve() {
    this.redArriba = true
    this.programar(1500, () => this.device.conectar(), 'reconexión')
  }

  apagarEquipo(motivo) {
    this.evento('accion', `⏻ Equipo apagado (${motivo})`)
    this.device.apagar()
  }

  // ── foto del estado para la UI ──────────────────────────────────────────────

  snapshot() {
    const d = this.device
    const m = d.m
    return {
      now: this.now,
      bus: { ...this.bus },
      redArriba: this.redArriba,
      cfg: this.cfg,
      device: {
        perfil: d.perfil,
        encendido: d.encendido,
        conectado: d.conectado,
        gpsFix: d.gpsFix,
        bateria: { ...d.bateria },
        busy: d.busy,
        inbox: d.inbox.map(x => x.header),
        room: d.room.map(e => ({ ...e })),
        dataStore: { ...d.dataStore },
        mem: {
          sessionDriver: m.sessionDriver && { ...m.sessionDriver },
          paraderoActual: m.paraderoActual,
          paraderoMasCercanoOrden1: m.paraderoMasCercanoOrden1,
          lastCredentials: m.lastCredentials,
          currentLado: m.currentLado,
          loadingLogout: m.loadingLogout,
          readyLogin: m.readyLogin,
          trip: m.protoLogin?.trip ?? null,
          ubicacion: m.ubicacion,
          blockIncomingLogin: d.v66 ? m.blockIncomingLogin : m.intents.blockIncomingLogin,
          pendingAutoRetorno: d.v66 ? Object.fromEntries(m.pendingAllowAutoLogin) : Object.fromEntries(m.intents.pendingAutoRetorno),
          opsAtendidas: [...m.deduper.handled],
        },
      },
      server: {
        sesiones: this.server.sesiones.map(s => ({ ...s })),
        ops: this.server.ops.map(o => ({ ...o })),
        trip: this.server.trip,
      },
    }
  }

  distanciaA(ref) {
    const p = this.paradero(ref)
    return p ? distA(this.bus, p) : null
  }

  minutoDelDia() {
    return minutosDelDia(this.now)
  }
}
