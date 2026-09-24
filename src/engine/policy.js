// Port 1:1 de DriverSessionPolicy.kt, LogoutIntents y OperationDeduper (rama validator).
// Si cambias la lógica en Android, cámbiala aquí y corre `npm test`.

export const RETORNO_AUTO_A = 'retorno_auto_a'
export const RETORNO_AUTO_B = 'retorno_auto_b'

/** configs.firstOrNull { nombre && ruta }?.data as? Boolean == true */
export const isRouteConfigEnabled = (configs, routeId, nombre) =>
  configs.find(c => c.nombre === nombre && c.ruta === routeId)?.data === true

/** Lado del login: el del paradero orden 1 más cercano (ambos lados); sin él, A (false). */
export const calculateLado = masCercanoOrden1 => masCercanoOrden1?.lado ?? false

export function nearestOrden1(paraderos, distanceTo) {
  let best = null
  let bestD = Infinity
  for (const p of paraderos) {
    if (p.orden !== 1) continue
    const d = distanceTo(p)
    if (d < bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

export const paraderoInicial = (paraderos, direction) =>
  paraderos.find(p => p.lado === direction && p.orden === 1) ?? null

export const paraderoEnRadio = (paraderos, direction, distanceTo) =>
  paraderos.find(p => p.lado === direction && distanceTo(p) <= p.radio) ?? null

export const shouldCloseAtTerminal = (session, paradero) =>
  session != null && paradero != null && session.direction === paradero.lado && (paradero.terminal || paradero.liquidar)

/** → { tipo: 'SinCredenciales' } | { tipo: 'NoConfigurado', configName } | { tipo: 'Abrir', lado, configName, dni, password } */
export function autoRetorno(closed, configs) {
  const { dni, password } = closed
  if (!dni || !password) return { tipo: 'SinCredenciales' }
  const nextLado = !closed.direction
  const configName = nextLado ? RETORNO_AUTO_B : RETORNO_AUTO_A
  if (!isRouteConfigEnabled(configs, closed.route, configName)) return { tipo: 'NoConfigurado', configName }
  return { tipo: 'Abrir', lado: nextLado, configName, dni, password }
}

/** → { tipo: 'NoEncontrada' } | { tipo: 'YaFinalizada' } | { tipo: 'Cerrar', sessionId } */
export function cierreRemoto(session) {
  if (session == null) return { tipo: 'NoEncontrada' }
  if (session.finalizado) return { tipo: 'YaFinalizada' }
  return { tipo: 'Cerrar', sessionId: session.id }
}

/** value = "<dni> <clave>" separados por el primer espacio; null si falta alguno. */
export function parseCredenciales(raw) {
  const value = (raw ?? '').trim()
  const sp = value.indexOf(' ')
  const dni = (sp < 0 ? value : value.slice(0, sp)).trim()
  const password = (sp < 0 ? '' : value.slice(sp + 1)).trim()
  return !dni || !password ? null : [dni, password]
}

export const toSessionDriver = e => ({
  id: e.id,
  driver_id: e.driver_id,
  driver_code: e.driver_code,
  activo: e.activo,
  castigado: e.castigado,
  conductor: e.conductor,
  vencido: e.vencido,
  route: e.route,
  direction: e.direction,
  start_time: e.start_time,
  autoLogin: e.autoLogin,
})

/** Sesión pendiente en Room al iniciar un viaje: de un día anterior se cierra, si no se restaura. */
export function restaurar(pendiente, hoy /* 'YYYY-MM-DD' */) {
  if (pendiente == null) return { tipo: 'Nada' }
  const fecha = pendiente.start_time?.slice(0, 10)
  if (fecha && fecha < hoy) return { tipo: 'CerrarVencida', sessionId: pendiente.id }
  return { tipo: 'Restaurar', session: toSessionDriver(pendiente) }
}

export class LogoutIntents {
  constructor() {
    this.pendingAutoRetorno = new Map()
    this.blockIncomingLogin = false
  }

  onLogoutRequested(sessionId, allowAutoLogin, autoRetorno) {
    if (!allowAutoLogin) this.blockIncomingLogin = true
    this.pendingAutoRetorno.set(sessionId, autoRetorno)
  }

  consumeLoginBlock() {
    if (!this.blockIncomingLogin) return false
    this.blockIncomingLogin = false
    return true
  }

  consumeAutoRetorno(sessionId) {
    const v = this.pendingAutoRetorno.get(sessionId) ?? false
    this.pendingAutoRetorno.delete(sessionId)
    return v
  }
}

export class OperationDeduper {
  constructor(capacity = 50) {
    this.capacity = capacity
    this.handled = []
  }

  markHandled(id) {
    if (this.handled.includes(id)) return false
    this.handled.push(id)
    if (this.handled.length > this.capacity) this.handled.shift()
    return true
  }
}
