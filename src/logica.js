// Reglas del APK (portable-bus-printer), copiadas 1:1 de
//   core/chofer/ticket/login/DriverSessionPolicy.kt  (y LogoutIntents, en el mismo archivo).
// Si cambian allá, se cambian aquí. Lado: false = A, true = B (igual que `direction` / `lado` en el APK).
// LogoutIntents va como datos simples (no clase) para poder guardar y restaurar el estado al retroceder.

export const RETORNO_AUTO_A = 'retorno_auto_a'
export const RETORNO_AUTO_B = 'retorno_auto_b'

export const ladoTxt = lado => (lado ? 'B' : 'A')

/** minByOrNull de Kotlin: en empate gana el primero. */
function minBy(items, fn) {
  let best = null
  let bestV = Infinity
  for (const it of items) {
    const v = fn(it)
    if (v < bestV) {
      best = it
      bestV = v
    }
  }
  return best
}

/** configs.firstOrNull { nombre && ruta }?.data as? Boolean == true → el texto "true" NO cuenta. */
export const isRouteConfigEnabled = (configs, routeId, nombre) =>
  configs.find(c => c.nombre === nombre && c.ruta === routeId)?.data === true

/** Lado del login: el del paradero orden 1 más cercano (de ambos lados); sin él, A. */
export const calculateLado = masCercanoOrden1 => masCercanoOrden1?.lado ?? false

export const nearestOrden1 = (paraderos, distanceTo) => minBy(paraderos.filter(p => p.orden === 1), distanceTo)

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

/**
 * Sesión pendiente en Room al iniciar un viaje: de un día anterior se cierra, si no se restaura.
 * `dia` = número de día de start_time; `hoy` = número de día actual.
 * → { tipo: 'Nada' } | { tipo: 'CerrarVencida', sessionId } | { tipo: 'Restaurar', session }
 */
export function restaurar(pendiente, hoy) {
  if (pendiente == null) return { tipo: 'Nada' }
  if (pendiente.dia != null && pendiente.dia < hoy) return { tipo: 'CerrarVencida', sessionId: pendiente.id }
  return { tipo: 'Restaurar', session: toSessionDriver(pendiente) }
}

export const toSessionDriver = e => ({ id: e.id, direction: e.direction, route: e.route, dia: e.dia, start: e.start })

// ── LogoutIntents ───────────────────────────────────────────────────────────
// Intenciones de logout pendientes hasta que el server confirma:
//  - autoRetorno por sesión (solo el cierre por terminal lo pide).
//  - bloqueo del próximo driver_login entrante tras un logout forzado (allowAutoLogin=false).

export const nuevosIntents = () => ({ pendingAutoRetorno: {}, blockIncomingLogin: false })

export function onLogoutRequested(intents, sessionId, allowAutoLogin, autoRetorno) {
  if (!allowAutoLogin) intents.blockIncomingLogin = true
  intents.pendingAutoRetorno[sessionId] = autoRetorno
}

export function consumeLoginBlock(intents) {
  if (!intents.blockIncomingLogin) return false
  intents.blockIncomingLogin = false
  return true
}

export function consumeAutoRetorno(intents, sessionId) {
  const v = intents.pendingAutoRetorno[sessionId] ?? false
  delete intents.pendingAutoRetorno[sessionId]
  return v
}
