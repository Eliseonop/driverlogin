// Central simulada. Reglas deducidas de logs reales (ago–sep 2026):
//  - driver_login: "Se ha creado una nueva sesión" | "Ha reingresado a su sesión anterior" (devuelve la sesión
//    abierta del chofer AUNQUE se pida otro lado) | error "La unidad tiene una sesión abierta con otro conductor  - <id>"
//    | error "DNI y CLAVE inválidos" | error "Formulario Inválido" (dni que no tiene 8 dígitos).
//  - driver_logout: "Sesión Cerrada" | "Ya estaba cerrada".
//  - Tras cerrar una sesión A la central crea SOLA la B y la empuja como driver_login "Se ha creado una nueva
//    sesión automática". Visto en 8 de 8 cierres de sesiones A abiertas (terminal, manual, ENERGY y batería crítica)
//    y en 0 de 7 cierres de sesiones B (incluido un cierre remoto en PORTÓN). No depende de dónde esté el bus.
//  - operation: se reenvía cada ~5 min hasta recibir el eco {id}; los reenvíos usan un id fijo
//    09374710268af53289c05871 (visto para sesiones distintas en días distintos).

import { isRouteConfigEnabled, RETORNO_AUTO_A, RETORNO_AUTO_B } from './policy.js'
import { distA } from './geo.js'
import { isoSeg } from './time.js'

export const ID_REENVIO_FIJO = '09374710268af53289c05871'

export const REGLAS_SERVIDOR = {
  autoSesion: {
    tras_cerrar_a: 'Al cerrar una sesión A crea la B (lo observado en logs ago–sep 2026)',
    segun_config: 'Al cerrar cualquier lado abre el otro si su config de retorno está activa (hipótesis)',
    en_terminal: 'Solo si el bus está dentro de un terminal/liquidar al cerrar (hipótesis)',
    nunca: 'Nunca crea sesión automática',
  },
}

const ladoTxt = l => (l ? 'B' : 'A')

export class Server {
  constructor(world, cfg) {
    this.w = world
    this.reglas = cfg.servidor
    this.choferes = cfg.choferes
    this.sesiones = []
    this.nextId = cfg.servidor.primerId ?? 35417
    this.ops = []
    this.opSeq = 0
    this.trip = cfg.servidor.trip ?? 39084
  }

  ev(texto, extra) {
    this.w.evento('servidor', texto, extra)
  }

  abierta(vehicle) {
    return this.sesiones.find(s => s.open && s.vehicle === vehicle) ?? null
  }

  sessionPayload(s) {
    return {
      castigado: false,
      start_time: s.start_time,
      driver_id: s.driver_id,
      route: s.route,
      vencido: false,
      driver_code: s.driver_code,
      id: s.id,
      conductor: true,
      activo: true,
      direction: s.direction,
    }
  }

  crearSesion(chofer, route, vehicle, direction, automatica = false) {
    const s = {
      id: this.nextId++,
      dni: chofer.dni,
      driver_id: chofer.driver_id,
      driver_code: chofer.code,
      route,
      vehicle,
      direction,
      start_time: isoSeg(this.w.now),
      open: true,
      automatica,
      inicio: this.w.now,
      fin: null,
    }
    this.sesiones.push(s)
    return s
  }

  recibir(header, data) {
    switch (header) {
      case 'login':
        return this.w.alEquipo('login', this.loginPayload())
      case 'driver_login':
        return this.w.alEquipo('driver_login', this.driverLogin(data))
      case 'driver_logout':
        return this.driverLogout(data)
      case 'operation': {
        const op = this.ops.find(o => !o.acked && (o.id === data.id || o.idReenvio === data.id))
        if (op) {
          op.acked = true
          this.ev(`📨 eco operation ${data.id} → deja de reenviar (${op.key}=${op.value})`)
        }
        return
      }
      case 'android_command':
        return this.ev(`📨 ACK del equipo: ${data.key} → ${data.value}`)
      default:
        return
    }
  }

  loginPayload() {
    return { route: this.w.device.route, trip: this.trip, logged: true, id: this.w.device.vehicle, state: 'R', direction: this.direccionViaje ?? false }
  }

  driverLogin({ dni, key, direction, route, vehicle }) {
    const err = message => ({ sessions: [], error: true, title: 'error', message })
    if (!/^\d{8}$/.test(String(dni ?? ''))) {
      this.ev(`❌ driver_login dni='${dni}' → Formulario Inválido`)
      return { sessions: [], error: true, title: 'Formulario Inválido', message: 'Ocurrió un error al procesar la solicitud' }
    }
    const chofer = this.choferes.find(c => c.dni === dni)
    if (!chofer || chofer.clave !== key) {
      this.ev(`❌ driver_login ${dni} → DNI y CLAVE inválidos`)
      return err('DNI y CLAVE inválidos')
    }
    const abierta = this.abierta(vehicle)
    if (abierta && abierta.dni !== dni) {
      this.ev(`❌ driver_login ${dni} → unidad ocupada por sesión ${abierta.id} (${abierta.driver_code})`)
      return err(`La unidad tiene una sesión abierta con otro conductor  - ${abierta.id}`)
    }
    if (abierta) {
      const nota = abierta.direction !== direction ? ` (pidió ${ladoTxt(direction)}, se devuelve ${ladoTxt(abierta.direction)})` : ''
      this.ev(`↪️ reingreso a sesión ${abierta.id} lado ${ladoTxt(abierta.direction)}${nota}`, { sesion: abierta.id })
      return { sessions: [this.sessionPayload(abierta)], error: false, title: 'Acceso permitido', message: 'Ha reingresado a su sesión anterior' }
    }
    const lado = this.reglas.ladoForzado == null ? direction : this.reglas.ladoForzado
    const s = this.crearSesion(chofer, route, vehicle, lado)
    this.ev(`🟢 sesión ${s.id} creada lado ${ladoTxt(lado)} (${chofer.code})`, { sesion: s.id })
    return { sessions: [this.sessionPayload(s)], error: false, title: 'Acceso permitido', message: 'Se ha creado una nueva sesión' }
  }

  driverLogout({ session }) {
    const s = this.sesiones.find(x => x.id === session)
    const estabaAbierta = !!s?.open
    if (s && s.open) {
      s.open = false
      s.fin = this.w.now
      this.ev(`🔴 sesión ${s.id} cerrada (lado ${ladoTxt(s.direction)})`, { sesion: s.id })
    } else this.ev(`⚪ driver_logout ${session}: ya estaba cerrada`)
    this.w.alEquipo('driver_logout', {
      id: session,
      error: false,
      title: estabaAbierta ? 'Sesión Cerrada' : 'Ya estaba cerrada',
      message: 'Se cerró la sesión correctamente',
    })
    if (estabaAbierta) this.quizasAutoSesion(s)
  }

  quizasAutoSesion(cerrada) {
    const regla = this.reglas.autoSesion
    if (regla === 'nunca') return
    if (regla === 'tras_cerrar_a' && cerrada.direction !== false) return
    const next = !cerrada.direction
    const cfg = next ? RETORNO_AUTO_B : RETORNO_AUTO_A
    if (this.reglas.autoSesionUsaConfig && !isRouteConfigEnabled(this.configsServidor(), cerrada.route, cfg)) return
    if (regla === 'en_terminal') {
      const bus = this.w.bus
      const t = this.w.cfg.paraderos.find(p => (p.terminal || p.liquidar) && distA(bus, p) <= p.radio)
      if (!t) return
    }
    const chofer = this.choferes.find(c => c.dni === cerrada.dni)
    this.w.programar(this.reglas.autoSesionDelayMs ?? 1200, () => {
      if (this.abierta(cerrada.vehicle)) return
      const s = this.crearSesion(chofer, cerrada.route, cerrada.vehicle, next, true)
      this.ev(`🤖 central crea sesión automática ${s.id} lado ${ladoTxt(next)} tras cerrar ${cerrada.id}`, { sesion: s.id })
      this.w.alEquipo('driver_login', {
        sessions: [this.sessionPayload(s)],
        error: false,
        title: 'Acceso permitido',
        message: 'Se ha creado una nueva sesión automática',
      })
    })
  }

  /** La central lee la config de ruta con su propio criterio: 'igual' (booleano) o 'texto' (acepta "true"). */
  configsServidor() {
    const configs = this.w.cfg.configs
    if (this.reglas.configComoTexto) return configs.map(c => ({ ...c, data: c.data === true || c.data === 'true' }))
    return configs
  }

  // ── acciones de la central (panel web / consola) ───────────────────────────

  nuevoOpId() {
    this.opSeq++
    return `6ab4${String(this.opSeq).padStart(4, '0')}27bb27508ccc${(this.w.now % 0xffff).toString(16).padStart(4, '0')}`
  }

  enviarOperation(key, value, { reenviar = true } = {}) {
    const op = { id: this.nuevoOpId(), idReenvio: this.reglas.idReenvioFijo ? ID_REENVIO_FIJO : null, key, value, acked: false, envios: 0 }
    this.ops.push(op)
    this.ev(`📤 operation ${key}=${value} (id ${op.id})`)
    const enviar = primero => {
      if (op.acked || op.cancelada) return
      op.envios++
      const id = primero || !op.idReenvio ? op.id : op.idReenvio
      this.w.alEquipo('operation', { section: 'remote', id, value: String(value), key })
      if (reenviar && op.envios < (this.reglas.maxReenvios ?? 40)) this.w.programar(this.reglas.reenvioMs ?? 300_000, () => enviar(false), 'reenvío operation')
    }
    enviar(true)
    return op
  }

  enviarAndroidCommand(key, value) {
    this.ev(`📤 android_command ${key}=${value}`)
    this.w.alEquipo('android_command', { key, value: String(value) })
  }

  tarjetaNfc(dni) {
    const c = this.choferes.find(x => x.dni === dni)
    if (!c) return this.ev(`❌ tarjeta desconocida ${dni}`)
    this.w.alEquipo('uid_driver', { dni: c.dni, key: c.clave })
  }

  /** Un operador cierra la sesión desde la web: solo en BD del servidor, el equipo no se entera. */
  cerrarSoloEnServidor(id) {
    const s = this.sesiones.find(x => x.id === id && x.open)
    if (!s) return
    s.open = false
    s.fin = this.w.now
    this.ev(`🗄️ sesión ${id} cerrada solo en la central (el equipo no se entera)`, { sesion: id })
  }

  /** Nuevo viaje; `direction` es el lado del VIAJE (protoLogin.direction), distinto del lado de la sesión. */
  cambiarViaje(direction) {
    this.trip++
    if (direction != null) this.direccionViaje = direction === true
    this.ev(`🧭 nuevo viaje ${this.trip}${direction != null ? ` (lado viaje ${direction ? 'B' : 'A'})` : ''}`)
    this.w.alEquipo('login', this.loginPayload())
  }
}
