// Lee un log de LogManager ("YYYY-MM-DD HH:mm:ss [TAG] mensaje"), venga en orden ascendente o descendente,
// y clasifica cada línea en un evento tipado. Entiende las líneas de 1.0.65 en adelante (las nuevas de 1.0.69
// como "Sesión activada" o "Logout confirmado" son opcionales: si no están, se deduce de los mensajes).
import { paraderoDesdeLog, parseKMap, parseKValue } from './kotlin.js'

const p2 = n => String(n).padStart(2, '0')

/** "2026-09-25 10:13:47" o "2026-09-25T10:13:46.965722" → ms (UTC, sin zona: 10:13 se ve 10:13 en cualquier PC). */
export function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?/.exec(s ?? '')
  if (!m) return null
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), ms)
}

export const horaLog = ms => {
  const d = new Date(ms)
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
}

export const fechaLog = ms => {
  const d = new Date(ms)
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export function duracion(ms) {
  const s = Math.round(Math.abs(ms) / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`
  return `${Math.floor(m / 60)} h ${p2(m % 60)} min`
}

const LINEA = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]*)\] ?(.*)$/

/** Entradas en orden cronológico. Las líneas sin fecha se pegan a la anterior. n = línea en el archivo. */
export function leerEntradas(texto) {
  const out = []
  const lineas = texto.split(/\r?\n/)
  for (let k = 0; k < lineas.length; k++) {
    const m = LINEA.exec(lineas[k])
    if (m) out.push({ t: parseStamp(m[1]), tag: m[2], msg: m[3], n: k + 1 })
    else if (out.length && lineas[k].trim()) out[out.length - 1].msg += `\n${lineas[k]}`
  }
  const desc = out.length > 1 && out[0].t > out[out.length - 1].t
  if (desc) out.reverse()
  out.forEach((e, i) => (e.i = i))
  return out
}

const RX = /^\[RECIBIDO\]\| #\d+ \| SID:(\d+) \| \d+B \| (\w+) \[DATA\]: (.*)$/s
const TX = /^\[ENVIADO\] \| \[NUEVO\] \(\d+B\) \[KEY\]: (\w+) \[DATA\]: (.*)$/s
const TX_FALLA = /^\[ENVIADO\] \| \[ERROR🔴\] :(.*)$/
const ID = /\[ID: (\d+)\]/

function socket(msg) {
  let m
  if ((m = RX.exec(msg))) return { tipo: 'rx', sid: +m[1], header: m[2], data: parseKMap(m[3]) }
  if ((m = TX.exec(msg))) return { tipo: 'tx', header: m[1], data: parseKMap(m[2]) }
  if ((m = TX_FALLA.exec(msg))) return { tipo: 'txFalla', motivo: m[1] }
  if (msg.startsWith('✅ CONECTADO')) return { tipo: 'conectado', sid: +ID.exec(msg)?.[1] }
  if (msg.startsWith('🔄 Conectando')) return { tipo: 'conectando', sid: +ID.exec(msg)?.[1] }
  if ((m = /^⏰ Watchdog: (\d+)ms sin mensajes/.exec(msg))) return { tipo: 'watchdog', silencio: +m[1] }
  if (msg.startsWith('🧹 Limpiando recursos')) return { tipo: 'limpiando', sid: +ID.exec(msg)?.[1] }
  if (msg.startsWith('⏱️ TIMEOUT conexión')) return { tipo: 'timeoutConexion', sid: +ID.exec(msg)?.[1] }
  if (msg.startsWith('🚀 SocketService creado')) return { tipo: 'arranque', fuente: 'SocketService' }
  if (msg.startsWith('🔑 Sin login ACK tras')) return { tipo: 'sinLoginAck' }
  if ((m = /^❌ \[onFailure\] \[ID: (\d+)\]: (.*)$/s.exec(msg))) return { tipo: 'falla', sid: +m[1], motivo: m[2] }
  if ((m = /^\[onClosed\] \[ID: (\d+)\] - \d+: '([^']*)'/.exec(msg))) return { tipo: 'cerrado', sid: +m[1], motivo: m[2] || 'cerrado' }
  return null
}

/** Evento tipado de una entrada, o null si no aporta al flujo de sesión. */
export function clasificar({ tag, msg }) {
  let m
  if (tag === 'SocketService' || tag === 'ERROR-SocketService') return socket(msg)
  if (tag === 'LogManager' && msg.startsWith('Inicialización de LogManager')) return { tipo: 'arranque', fuente: 'LogManager' }
  if (tag === 'Arranque' && /MyApp\.onCreate/.test(msg)) return { tipo: 'arranque', fuente: 'MyApp' }
  if (tag === 'DeviceStatus' && (m = /→ (\{.*\})$/s.exec(msg))) return { tipo: 'estado', data: parseKMap(m[1]) }
  if (tag === 'GeoMarkViewModel' && (m = /^✅ Marcando: (.*) a las (\d{2}:\d{2}:\d{2})/.exec(msg))) return { tipo: 'marca', nombre: m[1] }
  if (tag === 'GpsViewModel') {
    if (msg.startsWith('No hay conexión')) return { tipo: 'sinConexion' }
    if ((m = /^Restauración: sesión (\d+) de un día anterior/.exec(msg))) return { tipo: 'restauracion', resultado: 'vencida', sesion: +m[1] }
    if ((m = /^Restauración: sesión (\d+) lado=([AB]) restaurada/.exec(msg))) return { tipo: 'restauracion', resultado: 'restaurada', sesion: +m[1], lado: m[2] === 'B' }
    return null
  }
  if (tag === 'ParaderoManager') {
    if ((m = /^Paradero actual: (.*) \(id=(\d+)\)$/.exec(msg))) return { tipo: 'paraderoActual', nombre: m[1], id: +m[2] }
    if ((m = /^Paradero más cercano orden 1: (.*)$/s.exec(msg))) return { tipo: 'cercano', orden1: true, paradero: paraderoDesdeLog(parseKValue(m[1])) }
    if ((m = /^Paradero más cercano: (.*)$/s.exec(msg))) return { tipo: 'cercano', paradero: paraderoDesdeLog(parseKValue(m[1])) }
    return null
  }
  if (tag === 'DriverLoginRepository') {
    if ((m = /^Paradero mas cercano: (.*)$/s.exec(msg))) return { tipo: 'cercano', paradero: paraderoDesdeLog(parseKValue(m[1])) }
    if ((m = /^performLogin origen=(\w+)/.exec(msg))) return { tipo: 'performLogin', origen: m[1] }
    if ((m = /^Lado login=([AB]) por (.*?) gps=/.exec(msg))) return { tipo: 'ladoLogin', lado: m[1] === 'B', por: m[2] }
    if (msg.startsWith('driver_logout no enviado')) return { tipo: 'logoutNoEnviado' }
    if (msg.startsWith('driver_logout: conexión perdida')) return { tipo: 'logoutCortado' }
    if ((m = /^driver_logout (\d+): sin respuesta en 60s/.exec(msg))) return { tipo: 'logoutSinRespuesta', sesion: +m[1] }
    return null
  }
  if (tag === 'DriverSessionCoordinator') {
    if ((m = /^logout solicitado: (\d+) allowAutoLogin=(true|false)(?: autoRetorno=(true|false))?/.exec(msg)))
      return { tipo: 'logoutSolicitado', sesion: +m[1], autoRetorno: m[3] === 'true' }
    if ((m = /^Sesión activada: (\d+)(?: lado=([AB]))?/.exec(msg))) return { tipo: 'sesionActivada', sesion: +m[1], lado: m[2] ? m[2] === 'B' : null }
    if (msg.startsWith('onLoginSuccess: bloqueado')) return { tipo: 'loginBloqueado', sesion: +(/descartada sesión (\d+)/.exec(msg)?.[1] ?? NaN) }
    if ((m = /^Login rechazado: (.*)$/.exec(msg))) return { tipo: 'loginRechazado', texto: m[1] }
    if ((m = /^Logout confirmado: (\d+)/.exec(msg))) return { tipo: 'logoutConfirmado', sesion: +m[1] }
    return null
  }
  if (tag === 'DRIVERAUTO') {
    if ((m = /^Primera sesión obtenida: (.*)$/s.exec(msg))) {
      const s = parseKValue(m[1])
      return s?.id != null ? { tipo: 'sesionMemoria', sesion: Number(s.id), lado: s.direction === true } : null
    }
    if ((m = /^Ejecutando logout automático para SessionDriver\(id=(\d+)/.exec(msg))) return { tipo: 'terminal', sesion: +m[1] }
    if ((m = /^VALIDATE AutoLogin: (true|false) - Paradero actual: (.*)$/s.exec(msg))) return { tipo: 'cercano', paradero: paraderoDesdeLog(parseKValue(m[2])) }
    if ((m = /^Autoretorno → abriendo lado ([AB]) \((\w+)\)/.exec(msg))) return { tipo: 'autoretorno', lado: m[1] === 'B', config: m[2] }
    if ((m = /^Ejecutando auto-login\.\.\.SessionDriverEntity\(id=(\d+)/.exec(msg))) return { tipo: 'autoretorno', desde: +m[1] }
    if ((m = /^Sesión encontrada para logout remoto: (?:SessionDriverEntity\(id=)?(\d+)/.exec(msg))) return { tipo: 'remotoCierre', sesion: +m[1] }
    if ((m = /^sesion remoto: (\d+) (no encontrada|ya finalizada)/.exec(msg))) return { tipo: 'remotoIgnorado', sesion: +m[1], motivo: m[2] }
    if ((m = /^Error procesando (?:operation|android_command): (.*)$/.exec(msg))) return { tipo: 'operacionError', texto: m[1] }
    return null
  }
  if (tag === 'SocketMessageDispatcher') {
    if ((m = /^Processing operation: .*key=([^,]*), value=(.*)\)$/.exec(msg))) return { tipo: 'operacionProcesada', key: m[1], value: m[2] }
    if ((m = /^↩️ operation (\S+) ya atendida/.exec(msg))) return { tipo: 'operacionDuplicada', id: m[1] }
    return null
  }
  if (tag === 'ProtectorVM' || tag === 'ProtectorViewModel') {
    if ((m = /^(Bateria critica|ENERGY|NIGHT): cerrando sesión (\d+)/.exec(msg))) return { tipo: 'forzado', motivo: m[1], sesion: +m[2] }
    return null
  }
  return null
}

/** Entradas + eventos clasificados (cada evento lleva t e i de su entrada). */
export function leerLog(texto) {
  const entradas = leerEntradas(texto)
  const eventos = []
  for (const e of entradas) {
    let ev = null
    try {
      ev = clasificar(e)
    } catch {
      ev = null
    }
    if (ev) eventos.push({ ...ev, t: e.t, i: e.i })
  }
  return { entradas, eventos }
}
