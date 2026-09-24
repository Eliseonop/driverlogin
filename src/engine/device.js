// Ticketera simulada. Cada método replica una clase real de Android y escribe los MISMOS logs
// (tag + texto) que LogManager, para que el analizador lea igual un log real y uno simulado.
//
//   performLogin / calculateLado / autoRetornoAfterLogout / executeLogout → DriverLoginRepository
//   onLoginSuccess / logout / onLogoutSuccess                         → DriverSessionCoordinator
//   evalFlows (paradero actual, más cercano, cierre en terminal)       → ParaderoManager
//   recibir / dispatch / processOperation                              → SocketService + SocketMessageDispatcher
//   cargarUltimaSesionSinFinalizar                                     → GpsViewModel
//   forceLogout / batería / ENERGY / NIGHT                             → ProtectorViewModel
//
// Perfiles: 'actual' = rama validator (DriverSessionPolicy) · 'v1066' = APK 1.0.66 en campo.

import * as P from './policy.js'
import { kMap, kParadero, kSession, kEntity, kOperation, kDouble } from './kotlin.js'
import { distA } from './geo.js'
import { isoMicro, fecha, minutosDelDia } from './time.js'

const T_REPO = 'DriverLoginRepository'
const T_COORD = 'DriverSessionCoordinator'
const T_PM = 'ParaderoManager'
const T_DISP = 'SocketMessageDispatcher'
const T_SOCK = 'SocketService'
const T_GPS = 'GpsViewModel'
const T_PROT = 'ProtectorVM'
const T_AUTO = 'DRIVERAUTO'

export const PERFILES = {
  actual: { id: 'actual', nombre: 'Actual (rama validator)', corto: 'actual' },
  v1066: { id: 'v1066', nombre: 'APK 1.0.66 (en campo)', corto: '1.0.66' },
}

const ladoTxt = l => (l ? 'B' : 'A')
const ROOM_LIMITE = 10

export class Device {
  constructor(world, cfg) {
    this.w = world
    this.perfil = cfg.perfil
    this.vehicle = cfg.vehicle
    this.route = cfg.route
    this.serial = cfg.serial
    this.logsNuevos = cfg.logsNuevos
    this.room = []
    this.dataStore = {}
    this.encendido = true
    this.conectado = true
    this.gpsFix = true
    this.bateria = { nivel: 80, cargando: true }
    this.gen = 0
    this.sid = 200
    this.resetMemoria()
  }

  get v66() {
    return this.perfil === 'v1066'
  }

  resetMemoria() {
    this.gen++
    this.m = {
      sessionDriver: null,
      paraderoActual: null,
      paraderoMasCercano: null,
      paraderoMasCercanoOrden1: null,
      lastCredentials: null,
      currentLado: null,
      loadingLogout: false,
      protoLogin: null,
      readyLogin: false,
      ubicacion: null,
      intents: new P.LogoutIntents(),
      deduper: new P.OperationDeduper(),
      blockIncomingLogin: false,
      pendingAllowAutoLogin: new Map(),
      lastAutoKey: undefined,
      lastActualLogged: undefined,
      lastInitTrip: null,
      lastTerminalLog: -Infinity,
      nightEjecutado: false,
      energyEsperando: false,
    }
    this.inbox = []
    this.busy = 0
    this.msgSeq = 0
  }

  // ── utilidades ──────────────────────────────────────────────────────────────

  log(tag, msg) {
    this.w.log(tag, msg)
  }

  /** Log agregado en esta rama para diagnóstico: el perfil 1.0.66 no lo tiene. */
  logNuevo(tag, msg) {
    if (!this.v66 && this.logsNuevos) this.log(tag, msg)
  }

  hablar(texto) {
    this.w.evento('audio', `🔊 "${texto}"`)
  }

  get configs() {
    return this.w.cfg.configs
  }

  paraderosFiltrados() {
    if (!this.m.protoLogin) return []
    return this.w.cfg.paraderos.filter(p => p.ruta === this.m.protoLogin.route && p.activo !== false)
  }

  /** LocationState: (0,0) hasta el primer fix tras arrancar; luego el último fix conocido. */
  ubicacion() {
    return this.m.ubicacion ?? { lat: 0, lng: 0, acc: 0 }
  }

  retornoAutoB() {
    return P.isRouteConfigEnabled(this.configs, this.m.protoLogin?.route ?? this.route, P.RETORNO_AUTO_B)
  }

  /** Espera tipo `while(cond) delay(paso)`. Si `bloquea`, el dispatcher no procesa otros mensajes mientras tanto. */
  esperar(listo, paso, fin, bloquea = false) {
    const gen = this.gen
    if (bloquea) this.busy++
    const tick = () => {
      if (gen !== this.gen) return
      if (!listo()) return this.w.programar(paso, tick, 'espera')
      if (bloquea) this.busy--
      fin()
      this.pump()
    }
    tick()
  }

  // ── socket ──────────────────────────────────────────────────────────────────

  /** SocketHelper.sendMessage + SocketService.send */
  send(header, data, validate = true) {
    if (!this.encendido) return
    if (validate && this.m.protoLogin?.id == null) {
      this.w.evento('sim', `⚠️ ${header} descartado en silencio: aún no hay login del equipo (SocketHelper.validate)`)
      return
    }
    if (!this.conectado) {
      this.log(T_SOCK, '[ENVIADO] | [ERROR🔴] :No conectado (false)')
      this.w.evento('perdido', `✉️✖ ${header} no salió (sin conexión)`)
      return
    }
    const txt = kMap(data)
    this.log(T_SOCK, `[ENVIADO] | [NUEVO] (${Math.max(3, Math.round(txt.length / 4))}B) [KEY]: ${header} [DATA]: ${txt}`)
    this.w.alServidor(header, data)
  }

  recibir(header, data) {
    if (!this.encendido || !this.conectado) {
      this.w.evento('perdido', `✉️✖ ${header} del servidor no llegó (equipo sin conexión)`)
      return
    }
    const txt = kMap(data)
    this.log(T_SOCK, `[RECIBIDO]| #${++this.msgSeq} | SID:${this.sid} | ${Math.max(3, Math.round(txt.length / 4))}B | ${header} [DATA]: ${txt}`)
    this.inbox.push({ header, data, gen: this.gen })
    this.pump()
  }

  pump() {
    while (this.busy === 0 && this.inbox.length) {
      const msg = this.inbox.shift()
      if (msg.gen !== this.gen) continue
      this.dispatch(msg.header, msg.data)
    }
    if (this.busy > 0 && this.inbox.length) {
      const h = this.inbox.map(m => m.header).join(', ')
      if (this._ultimoAvisoCola !== h) {
        this._ultimoAvisoCola = h
        this.w.evento('sim', `⏳ dispatcher ocupado: en cola [${h}]`)
      }
    }
  }

  conectar() {
    if (!this.encendido || this.conectado) return
    this.conectado = true
    this.sid++
    this.msgSeq = 0
    this.log(T_SOCK, `✅ CONECTADO [ID: ${this.sid}] - Code: 101`)
    this.handshake()
  }

  desconectar() {
    if (!this.conectado) return
    this.conectado = false
    this.m.readyLogin = false
    this.log(`ERROR-${T_SOCK}`, `❌ [onFailure] [ID: ${this.sid}]: Socket closed`)
    this.log(T_GPS, 'No hay conexión. Se omite procesamiento.')
  }

  handshake() {
    this.log(T_SOCK, `🔑 Enviando login handshake (${this.serial})`)
    this.send('login', { serial: this.serial }, false)
  }

  // ── dispatcher ──────────────────────────────────────────────────────────────

  dispatch(header, data) {
    this.log(T_DISP, `Mensaje: Header: ${header}, Data: ${kMap(data)}`)
    switch (header) {
      case 'login': {
        const wasReady = this.m.readyLogin
        this.m.protoLogin = { ...data }
        this.m.readyLogin = true
        if (!wasReady) this.log(T_DISP, '✅ Login confirmado por servidor (sesión OK)')
        this.observeLogin()
        this.evalFlows()
        return
      }
      case 'driver_login':
        return this.onLoginSuccess(data)
      case 'driver_logout':
        return this.onLogoutSuccess(data)
      case 'uid_driver':
        if (data.dni != null && data.key != null) {
          this.logNuevo(T_DISP, `🪪 uid_driver → login por tarjeta dni='${data.dni}'`)
          this.performLogin(data.dni, data.key, 'nfc', { bloquea: true })
        }
        return
      case 'operation': {
        if (this.v66) return
        const id = data.id ?? null
        if (id != null) this.send('operation', { id })
        if (id != null && !this.m.deduper.markHandled(id)) {
          this.log(T_DISP, `↩️ operation ${id} ya atendida (key=${data.key}), solo eco`)
          return
        }
        return this.processOperation(data)
      }
      case 'android_command':
        return this.processOperation(data)
      default:
        return
    }
  }

  ackOp(key, subject, status, detail) {
    if (key == null) return
    const clean = s => String(s).trim().replaceAll(':', ' ')
    const subj = subject != null && clean(subject) ? clean(subject) : key
    const value = `${subj}:${status}${detail ? `:${clean(detail)}` : ''}`
    this.send('android_command', { key, value })
    this.log(T_DISP, `↩️ ACK ${value}`)
  }

  processOperation(op) {
    const ok = () => this.ackOp(op.key, op.value, 'OK')
    const falla = msg => {
      this.log(T_AUTO, `Error procesando operation: ${msg}`)
      this.m.loadingLogout = false
      this.ackOp(op.key, op.value, 'ERROR', msg)
    }
    this.log(T_DISP, `Processing operation: ${kOperation(op)}`)
    this.ackOp(op.key, op.value, 'RECV')

    switch (op.key) {
      case 'sesion': {
        const sessionId = /^-?\d+$/.test(op.value ?? '') ? Number(op.value) : null
        if (sessionId == null) return falla('VALOR_INVALIDO')
        const entity = this.roomGet(sessionId)
        if (this.v66) {
          if (!entity) {
            this.log(T_AUTO, `sesion remoto: ${sessionId} no encontrada en BD`)
            return this.ackOp(op.key, op.value, 'WARN', 'SESION_NO_ENCONTRADA')
          }
          this.log(T_AUTO, `Sesión encontrada para logout remoto: ${kEntity(entity)}`)
          return this.logout(entity.id, {}, { bloquea: true, luego: ok })
        }
        const cierre = P.cierreRemoto(entity)
        if (cierre.tipo === 'NoEncontrada') {
          this.log(T_AUTO, `sesion remoto: ${sessionId} no encontrada en BD`)
          return this.ackOp(op.key, op.value, 'WARN', 'SESION_NO_ENCONTRADA')
        }
        if (cierre.tipo === 'YaFinalizada') {
          this.log(T_AUTO, `sesion remoto: ${sessionId} ya finalizada`)
          return this.ackOp(op.key, op.value, 'WARN', 'SESION_YA_FINALIZADA')
        }
        this.log(T_AUTO, `Sesión encontrada para logout remoto: ${cierre.sessionId}`)
        return this.logout(cierre.sessionId, {}, { bloquea: true, luego: ok })
      }
      case 'login-conductor': {
        const creds = P.parseCredenciales(op.value)
        if (!creds) return falla('VALOR_INVALIDO')
        this.log(T_DISP, `👤 Operation login-conductor → dni='${creds[0]}'`)
        return this.performLogin(creds[0], creds[1], 'remoto', { bloquea: true, luego: ok })
      }
      case 'logout-conductor': {
        const sessionId = this.m.sessionDriver?.id ?? this.roomUltimaPendiente()?.id
        if (sessionId == null) return falla('SIN_SESION_ACTIVA')
        this.log(T_DISP, `👤 Operation logout-conductor → sesión ${sessionId}`)
        return this.logout(sessionId, {}, { bloquea: true, luego: ok })
      }
      default:
        this.log(T_DISP, `❓ Operation key no soportada: ${op.key}`)
        return this.ackOp(op.key, op.value, 'WARN', 'KEY_NO_SOPORTADA')
    }
  }

  // ── Room ────────────────────────────────────────────────────────────────────

  roomGet(id) {
    return this.room.find(e => e.id === id) ?? null
  }

  roomUltimaPendiente() {
    return [...this.room].filter(e => !e.finalizado).sort((a, b) => (a.start_time < b.start_time ? 1 : -1))[0] ?? null
  }

  roomInsertar(entity) {
    this.room = this.room.filter(e => e.id !== entity.id)
    this.room.push(entity)
    this.room.sort((a, b) => (a.start_time < b.start_time ? 1 : -1))
    this.room = this.room.slice(0, ROOM_LIMITE)
  }

  toEntity(session, credentials) {
    return {
      id: session.id,
      driver_id: session.driver_id,
      driver_code: session.driver_code,
      activo: session.activo,
      castigado: session.castigado,
      conductor: session.conductor,
      vencido: session.vencido,
      route: session.route,
      direction: session.direction,
      start_time: session.start_time,
      finalizado: false,
      end_time: null,
      dni: credentials?.[0] ?? null,
      password: credentials?.[1] ?? null,
      autoLogin: this.v66 ? this.retornoAutoB() : false,
    }
  }

  // ── DriverLoginRepository ───────────────────────────────────────────────────

  calculateLado() {
    const masCercano = this.m.paraderoMasCercanoOrden1
    let lado
    if (this.v66) {
      if (this.retornoAutoB()) lado = false
      else {
        this.log(T_REPO, `Paradero mas cercano: ${kParadero(masCercano)}`)
        lado = masCercano?.lado ?? true
      }
    } else {
      if (this.logsNuevos) {
        const u = this.ubicacion()
        const por = masCercano ? `${masCercano.nombre} (id=${masCercano.id})` : 'sin paradero orden 1 → A por defecto'
        this.log(T_REPO, `Lado login=${ladoTxt(P.calculateLado(masCercano))} por ${por} gps=${kDouble(u.lat)},${kDouble(u.lng)} acc=${Math.trunc(u.acc ?? 0)}m fix=${this.m.ubicacion != null}`)
      } else this.log(T_REPO, `Paradero mas cercano: ${kParadero(masCercano)}`)
      lado = P.calculateLado(masCercano)
    }
    this.m.currentLado = lado
    return lado
  }

  createDriverLoginData(dni, key, lado) {
    return { route: this.m.protoLogin?.route ?? 0, dni, key, direction: lado, vehicle: this.m.protoLogin?.id ?? 0 }
  }

  /** origen: manual | nfc | remoto (solo para el log nuevo). */
  performLogin(dni, password, origen = 'manual', { bloquea = false, luego } = {}) {
    if (!dni || !password) {
      this.w.evento('sim', 'performLogin: DNI y clave son requeridos')
      return luego?.()
    }
    this.m.lastCredentials = [dni, password]
    if (this.v66) this.log(T_REPO, `Retornogps: ${this.retornoAutoB()}`)
    else this.logNuevo(T_REPO, `performLogin origen=${origen} dni='${dni}'`)
    const lado = this.calculateLado()
    this.send('driver_login', this.createDriverLoginData(dni, password, lado))
    const hasta = this.w.now + 1000
    this.esperar(() => this.w.now >= hasta, 1000, () => luego?.(), bloquea)
  }

  autoRetornoAfterLogout(closed) {
    const d = P.autoRetorno(closed, this.configs)
    if (d.tipo === 'SinCredenciales') return this.log(T_AUTO, 'Autoretorno: sin credenciales guardadas')
    if (d.tipo === 'NoConfigurado') return this.log(T_AUTO, `Autoretorno no configurado (${d.configName}) ruta=${closed.route}`)
    this.m.lastCredentials = [d.dni, d.password]
    this.send('driver_login', this.createDriverLoginData(d.dni, d.password, d.lado))
    this.log(T_AUTO, `Autoretorno → abriendo lado ${ladoTxt(d.lado)} (${d.configName})`)
  }

  /** 1.0.66: DriverLoginRepository.setAutoLogin → executeAutoLogin (siempre direction=true). */
  setAutoLoginV66(entity) {
    if (!entity.autoLogin) return
    this.log(T_AUTO, `Ejecutando auto-login...${kEntity(entity)}`)
    if (!entity.dni || !entity.password) return this.log(T_AUTO, 'No hay credenciales guardadas')
    this.send('driver_login', this.createDriverLoginData(entity.dni, entity.password, true))
  }

  executeLogout(sessionId, { bloquea = false, luego } = {}) {
    const client = {
      digital: 0,
      resume: [],
      last: 0,
      session: sessionId,
      end_time: isoMicro(this.w.now),
      cash: 0,
      first: 0,
      vehicle: this.m.protoLogin?.id ?? 0,
    }
    this.m.loadingLogout = true
    this.send('driver_logout', client)
    if (!this.conectado) {
      this.log(T_REPO, 'driver_logout no enviado: socket desconectado')
      this.m.loadingLogout = false
      return luego?.()
    }
    const deadline = this.w.now + 60_000
    let cayo = false
    this.esperar(
      () => {
        if (!this.m.loadingLogout || this.w.now >= deadline) return true
        if (!this.conectado) return (cayo = true)
        return false
      },
      300,
      () => {
        if (cayo) this.log(T_REPO, 'driver_logout: conexión perdida esperando respuesta')
        else if (this.m.loadingLogout) this.logNuevo(T_REPO, `driver_logout ${sessionId}: sin respuesta en 60s`)
        this.m.loadingLogout = false
        luego?.()
      },
      bloquea,
    )
  }

  // ── DriverSessionCoordinator ────────────────────────────────────────────────

  onLoginSuccess(d) {
    const first = d.sessions?.[0]
    if (this.v66) {
      if (this.m.blockIncomingLogin) {
        this.m.blockIncomingLogin = false
        this.log(T_COORD, 'onLoginSuccess: bloqueado por logout forzado')
        this.w.evento('bloqueado', `🚫 driver_login descartado (bloqueo por logout forzado)${first ? ` sesión ${first.id} ${ladoTxt(first.direction)}` : ''}`)
        return
      }
    } else if (this.m.intents.consumeLoginBlock()) {
      const det = this.logsNuevos && first ? ` (descartada sesión ${first.id} lado=${ladoTxt(first.direction)} '${d.message}')` : ''
      this.log(T_COORD, `onLoginSuccess: bloqueado por logout forzado${det}`)
      this.w.evento('bloqueado', `🚫 driver_login descartado (bloqueo por logout forzado)${first ? ` sesión ${first.id} ${ladoTxt(first.direction)}` : ''}`)
      return
    }
    if (d.error) {
      this.logNuevo(T_COORD, `Login rechazado: ${d.title} - ${d.message}`)
      this.hablar(`Error al ingresar: ${d.message}`)
      return
    }
    if (!first) return this.log(T_COORD, 'onLoginSuccess: sin sesión en la respuesta')

    const session = { ...first, autoLogin: false }
    this.m.sessionDriver = session
    if (this.logsNuevos && !this.v66) this.log(T_COORD, `Sesión activada: ${session.id} lado=${ladoTxt(session.direction)} '${d.message}'`)
    else this.log(T_COORD, `Sesión activada: ${session.id}`)

    const paradero = P.paraderoInicial(this.paraderosFiltrados(), session.direction)
    this.m.paraderoActual = paradero
    this.log(T_COORD, `Paradero inicial: ${paradero?.nombre ?? 'null'}`)

    if (!this.roomGet(session.id)) {
      this.roomInsertar(this.toEntity(session, this.m.lastCredentials))
      this.log(T_COORD, `Sesión persistida en BD: ${session.id}`)
    }
    if (this.m.lastCredentials) this.dataStore = { dni: this.m.lastCredentials[0], password: this.m.lastCredentials[1] }
    this.hablar('Sesión iniciada')
    this.evalFlows()
  }

  logout(sessionId, { allowAutoLogin = true, autoRetorno = false } = {}, ctx = {}) {
    if (this.v66) {
      this.log(T_COORD, `logout solicitado: ${sessionId} allowAutoLogin=${allowAutoLogin}`)
      if (!allowAutoLogin) this.m.blockIncomingLogin = true
      this.m.pendingAllowAutoLogin.set(sessionId, allowAutoLogin)
    } else {
      this.log(T_COORD, `logout solicitado: ${sessionId} allowAutoLogin=${allowAutoLogin} autoRetorno=${autoRetorno}`)
      this.m.intents.onLogoutRequested(sessionId, allowAutoLogin, autoRetorno)
    }
    this.executeLogout(sessionId, ctx)
  }

  onLogoutSuccess(d) {
    this.log(T_AUTO, `Decoded Driver Logout: ProtoDriverLogout(error=${d.error}, title=${d.title}, message=${d.message}, id=${d.id})`)
    if (d.error) return this.hablar(`Error al cerrar sesión: ${d.message}`)
    const sessionId = d.id
    if (sessionId == null) return this.log(T_COORD, 'onLogoutSuccess: id de sesión nulo en respuesta')
    const found = this.roomGet(sessionId)
    if (!found) return this.log(T_COORD, `onLogoutSuccess: sesión ${sessionId} no encontrada en BD`)
    const closed = { ...found }
    found.finalizado = true
    found.end_time = isoMicro(this.w.now)
    if (this.m.sessionDriver?.id === sessionId) this.m.sessionDriver = null

    if (this.v66) {
      const allow = this.m.pendingAllowAutoLogin.get(sessionId) ?? true
      this.m.pendingAllowAutoLogin.delete(sessionId)
      if (closed.autoLogin && allow) this.setAutoLoginV66(closed)
    } else {
      const auto = this.m.intents.consumeAutoRetorno(sessionId)
      this.logNuevo(T_COORD, `Logout confirmado: ${sessionId} lado=${ladoTxt(closed.direction)} autoRetorno=${auto} '${d.title}'`)
      if (auto) this.autoRetornoAfterLogout(closed)
    }
    this.hablar('Sesión finalizada')
    this.m.loadingLogout = false
    this.evalFlows()
  }

  // ── GpsViewModel ────────────────────────────────────────────────────────────

  observeLogin() {
    const trip = this.m.protoLogin?.trip
    if (trip == null || !this.conectado || !this.m.readyLogin) return
    if (this.m.lastInitTrip === trip) return
    this.m.lastInitTrip = trip
    this.cargarUltimaSesionSinFinalizar()
  }

  cargarUltimaSesionSinFinalizar() {
    const pendiente = this.roomUltimaPendiente()
    const r = P.restaurar(pendiente, fecha(this.w.now))
    if (r.tipo === 'Nada') return this.logNuevo(T_GPS, 'Restauración: sin sesión pendiente en BD')
    if (r.tipo === 'CerrarVencida') {
      this.logNuevo(T_GPS, `Restauración: sesión ${r.sessionId} de un día anterior (${pendiente.start_time}) → cerrando`)
      return this.executeLogout(r.sessionId)
    }
    this.m.sessionDriver = this.v66 ? r.session : { ...r.session }
    this.logNuevo(T_GPS, `Restauración: sesión ${r.session.id} lado=${ladoTxt(r.session.direction)} restaurada desde BD (creds=${pendiente.dni ? 'sí' : 'no'})`)
    this.evalFlows()
  }

  // ── ParaderoManager ─────────────────────────────────────────────────────────

  actualizarGps() {
    if (!this.encendido || !this.gpsFix) return
    const b = this.w.bus
    this.m.ubicacion = { lat: b.lat, lng: b.lng, acc: b.acc ?? 5 }
    this.evalFlows()
  }

  evalFlows() {
    if (!this.encendido) return
    for (let i = 0; i < 6; i++) if (!this.evalOnce()) break
  }

  evalOnce() {
    const m = this.m
    const pars = this.paraderosFiltrados()
    const loc = this.ubicacion()
    const dist = p => distA(loc, p)
    let cambio = false

    if (pars.length) {
      const o1 = P.nearestOrden1(pars, dist)
      if ((o1?.id ?? null) !== (m.paraderoMasCercanoOrden1?.id ?? null)) {
        this.log(T_PM, `Paradero más cercano orden 1: ${kParadero(o1)}`)
        m.paraderoMasCercanoOrden1 = o1
      }
      if (!m.sessionDriver) m.paraderoMasCercano = null
      else {
        let c = null
        let cd = Infinity
        for (const p of pars) if (dist(p) < cd) (c = p), (cd = dist(p))
        if (c?.id !== m.paraderoMasCercano?.id) {
          m.paraderoMasCercano = c
          this.log(T_PM, `Paradero más cercano: ${kParadero(c)}`)
        }
      }
    }

    if (!m.sessionDriver && !this.v66) {
      if (m.paraderoActual) {
        m.paraderoActual = null
        cambio = true
      }
    } else if (this.v66) {
      if (!m.protoLogin) return cambio
      // 1.0.66: el paradero actual se filtraba por el lado del VIAJE (protoLogin.direction), no el de la sesión.
      const enRadio = P.paraderoEnRadio(pars, m.protoLogin?.direction === true, dist)
      if (enRadio && enRadio.id !== m.paraderoActual?.id) {
        m.paraderoActual = enRadio
        cambio = true
      }
    } else {
      const enRadio = P.paraderoEnRadio(pars, m.sessionDriver.direction, dist)
      if (enRadio && enRadio.id !== m.paraderoActual?.id) {
        m.paraderoActual = enRadio
        cambio = true
      }
      if (!this.v66) {
        const term = pars
          .filter(p => p.lado === m.sessionDriver.direction && (p.terminal || p.liquidar))
          .map(p => [p, dist(p)])
          .sort((a, b) => a[1] - b[1])[0]
        if (term && term[1] <= term[0].radio + 30 && this.w.now - m.lastTerminalLog >= 5000) {
          m.lastTerminalLog = this.w.now
          this.log(T_PM, `TERMINAL ${term[0].nombre} dist:${Math.trunc(term[1])}m radio:${Math.trunc(term[0].radio)}m acc:${Math.trunc(loc.acc ?? 0)}m lado=${term[0].lado} dentro=${term[1] <= term[0].radio}`)
        }
      }
    }

    if (m.paraderoActual && m.paraderoActual.id !== m.lastActualLogged) {
      m.lastActualLogged = m.paraderoActual.id
      this.log(T_PM, `Paradero actual: ${m.paraderoActual.nombre} (id=${m.paraderoActual.id})`)
    }

    const key = `${JSON.stringify(m.sessionDriver)}|${m.paraderoActual?.id ?? null}`
    if (key !== m.lastAutoKey) {
      m.lastAutoKey = key
      this.observeAutoLogouts()
    }
    return cambio
  }

  observeAutoLogouts() {
    const s = this.m.sessionDriver
    const p = this.m.paraderoActual
    if (this.v66) {
      if (!s || !p) return
      this.log(T_AUTO, `Primera sesión obtenida: ${kSession(s)}`)
      if (s.direction !== p.lado) return
      this.log(T_AUTO, 'La dirección de la sesión coincide con el lado del paradero actual')
      this.log(T_AUTO, `VALIDATE AutoLogin: ${s.autoLogin} - Paradero actual: ${kParadero(p)}`)
      if ((p.liquidar || p.terminal) && s.autoLogin) {
        this.log(T_AUTO, `Ejecutando logout automático para ${kSession(s)}`)
        this.logout(s.id)
      }
      return
    }
    if (!s || !p) return
    if (!P.shouldCloseAtTerminal(s, p)) return
    this.log(T_AUTO, `Terminal alcanzado lado=${p.lado} (${p.nombre}) → cerrar sesión ${s.id}`)
    this.logout(s.id, { autoRetorno: true })
  }

  // ── ProtectorViewModel ──────────────────────────────────────────────────────

  forceLogout(tag, luego) {
    const s = this.m.sessionDriver
    if (!s) {
      this.log(T_PROT, `${tag}: sin sesión activa`)
      return luego?.()
    }
    this.log(T_PROT, `${tag}: cerrando sesión ${s.id}`)
    this.logout(s.id, { allowAutoLogin: false }, { luego })
  }

  bateriaCritica() {
    this.bateria = { nivel: 10, cargando: false }
    this.log(T_PROT, `Bateria critica (10%). Iniciando apagado.`)
    this.forceLogout('Bateria critica', () => {
      const hasta = this.w.now + 10_000
      this.esperar(() => this.m.sessionDriver == null || this.w.now >= hasta, 300, () => this.w.apagarEquipo('apagado por batería crítica'))
    })
  }

  energyBaja() {
    this.bateria = { nivel: 16, cargando: false }
    if (this.m.energyEsperando) return
    this.m.energyEsperando = true
    this.log(T_PROT, 'ENERGY: batería baja sin carga → esperando 3min')
    const gen = this.gen
    this.w.programar(200_000, () => {
      if (gen !== this.gen) return
      this.m.energyEsperando = false
      const low = this.bateria.nivel <= 16
      if (low && !this.bateria.cargando) this.forceLogout('ENERGY')
      else this.log(T_PROT, `ENERGY: condición ya no aplica (low=${low} noCharge=${!this.bateria.cargando})`)
    })
  }

  cargar() {
    this.bateria = { nivel: Math.max(this.bateria.nivel, 20), cargando: true }
  }

  /** Protector: tick cada 60 s para el cierre nocturno 02:30–03:00. */
  tickNocturno() {
    if (!this.encendido) return
    const min = minutosDelDia(this.w.now)
    const enRango = min >= 150 && min < 180
    if (enRango && !this.m.nightEjecutado) {
      if (this.m.sessionDriver) {
        this.log(T_PROT, 'NIGHT: dentro del rango 02:30-03:00 → cerrando sesión')
        this.forceLogout('NIGHT')
      } else this.log(T_PROT, 'NIGHT: dentro del rango 02:30-03:00 → sin sesión activa, nada que hacer')
      this.m.nightEjecutado = true
    } else if (!enRango && min >= 180 && this.m.nightEjecutado) {
      this.log(T_PROT, 'NIGHT: pasadas las 03:00 → reseteando nightShutdownExecuted')
      this.m.nightEjecutado = false
    }
  }

  // ── arranque ────────────────────────────────────────────────────────────────

  arrancar() {
    this.encendido = true
    this.resetMemoria()
    this.log('LogManager', 'Inicialización de LogManager completa')
    this.conectado = false
    this.w.programar(1500, () => {
      if (this.w.redArriba) this.conectar()
    })
    this.w.programar(4000, () => this.actualizarGps())
  }

  apagar() {
    this.encendido = false
    this.conectado = false
    this.gen++
    this.inbox = []
    this.busy = 0
  }
}
