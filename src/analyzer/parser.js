// Lee un log de LogManager ("YYYY-MM-DD HH:mm:ss [TAG] mensaje"), en cualquier orden, y lo convierte en
// entradas ordenadas + eventos tipados que usan el diagnóstico, la línea de tiempo y la reproducción.

import { parseStamp } from '../engine/time.js'
import { parseKMap, parseKValue, paraderoDesdeLog } from '../engine/kotlin.js'

const LINEA = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] ?(.*)$/

export function leerEntradas(texto) {
  const out = []
  const lineas = texto.split(/\r?\n/)
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    const m = LINEA.exec(l)
    if (m) out.push({ t: parseStamp(m[1]), tag: m[2], msg: m[3], n: i + 1 })
    else if (out.length && l.trim()) out[out.length - 1].msg += `\n${l}`
  }
  const desc = out.length > 1 && out[0].t > out[out.length - 1].t
  if (desc) out.reverse()
  out.forEach((e, i) => (e.i = i))
  return { entradas: out, orden: desc ? 'desc' : 'asc' }
}

const RX = /^\[RECIBIDO\]\| #\d+ \| SID:\d+ \| \d+B \| (\w+) \[DATA\]: (.*)$/s
const TX = /^\[ENVIADO\] \| \[NUEVO\] \(\d+B\) \[KEY\]: (\w+) \[DATA\]: (.*)$/s
const TX_FAIL = /^\[ENVIADO\] \| \[ERROR🔴\] :(.*)$/

/** Evento tipado por entrada (o null si no interesa al flujo de sesión). */
export function clasificar(e) {
  const { tag, msg } = e
  let m
  if (tag === 'SocketService') {
    if ((m = RX.exec(msg))) return { tipo: 'rx', header: m[1], data: parseKMap(m[2]) }
    if ((m = TX.exec(msg))) return { tipo: 'tx', header: m[1], data: parseKMap(m[2]) }
    if ((m = TX_FAIL.exec(msg))) return { tipo: 'txFalla', motivo: m[1] }
    if (msg.startsWith('✅ CONECTADO')) return { tipo: 'conectado' }
    return null
  }
  if (tag === 'ERROR-SocketService' && /onFailure|Socket closed|Watchdog/.test(msg)) return { tipo: 'desconectado' }
  if (tag === 'GpsViewModel') {
    if (msg.startsWith('No hay conexión')) return { tipo: 'desconectado' }
    if ((m = /^Restauración: (.*)$/.exec(msg))) {
      const r = m[1]
      if (r.startsWith('sin sesión')) return { tipo: 'restauracion', resultado: 'nada' }
      if ((m = /^sesión (\d+) de un día anterior/.exec(r))) return { tipo: 'restauracion', resultado: 'vencida', sesion: +m[1] }
      if ((m = /^sesión (\d+) lado=([AB]) restaurada.*creds=(sí|no)/.exec(r))) return { tipo: 'restauracion', resultado: 'restaurada', sesion: +m[1], lado: m[2] === 'B', creds: m[3] === 'sí' }
    }
    return null
  }
  if (tag === 'LogManager' && msg.startsWith('Inicialización de LogManager')) return { tipo: 'arranque' }
  if (tag === 'DeviceStatus' && (m = /→ (\{.*\})$/s.exec(msg))) return { tipo: 'estado', data: parseKMap(m[1]) }
  if (tag === 'ParaderoManager') {
    if ((m = /^Paradero actual: (.*) \(id=(\d+)\)$/.exec(msg))) return { tipo: 'paraderoActual', nombre: m[1], id: +m[2] }
    if ((m = /^Paradero más cercano orden 1: (.*)$/s.exec(msg))) return { tipo: 'cercanoOrden1', paradero: paraderoDesdeLog(parseKValue(m[1])) }
    if ((m = /^Paradero más cercano: (.*)$/s.exec(msg))) return { tipo: 'cercano', paradero: paraderoDesdeLog(parseKValue(m[1])) }
    if ((m = /^TERMINAL (.*) dist:(\d+)m radio:(\d+)m acc:(\d+)m lado=(true|false) dentro=(true|false)/.exec(msg)))
      return { tipo: 'terminalCerca', nombre: m[1], dist: +m[2], radio: +m[3], acc: +m[4], lado: m[5] === 'true', dentro: m[6] === 'true' }
    return null
  }
  if (tag === 'DriverLoginRepository') {
    if ((m = /^Retornogps: (true|false)/.exec(msg))) return { tipo: 'retornoGps', valor: m[1] === 'true' }
    if ((m = /^Paradero mas cercano: (.*)$/s.exec(msg))) return { tipo: 'ladoCalculo', paradero: paraderoDesdeLog(parseKValue(m[1])) }
    if ((m = /^Lado login=([AB]) por (.*) gps=([-\d.]+),([-\d.]+) acc=(\d+)m fix=(true|false)/.exec(msg)))
      return { tipo: 'ladoLogin', lado: m[1] === 'B', por: m[2], lat: +m[3], lng: +m[4], acc: +m[5], fix: m[6] === 'true' }
    if ((m = /^performLogin origen=(\w+) dni='([^']*)'/.exec(msg))) return { tipo: 'performLogin', origen: m[1], dni: m[2] }
    if (msg.startsWith('driver_logout no enviado')) return { tipo: 'logoutNoEnviado' }
    if (msg.startsWith('driver_logout: conexión perdida')) return { tipo: 'logoutSinRespuesta', motivo: 'conexión perdida' }
    if ((m = /^driver_logout (\d+): sin respuesta en 60s/.exec(msg))) return { tipo: 'logoutSinRespuesta', motivo: '60 s', sesion: +m[1] }
    return null
  }
  if (tag === 'DriverSessionCoordinator') {
    if ((m = /^logout solicitado: (\d+) allowAutoLogin=(true|false)(?: autoRetorno=(true|false))?/.exec(msg)))
      return { tipo: 'logoutSolicitado', sesion: +m[1], allowAutoLogin: m[2] === 'true', autoRetorno: m[3] == null ? null : m[3] === 'true' }
    if ((m = /^Sesión activada: (\d+)(?: lado=([AB]))?/.exec(msg))) return { tipo: 'sesionActivada', sesion: +m[1], lado: m[2] ? m[2] === 'B' : null }
    if (msg.startsWith('onLoginSuccess: bloqueado')) {
      m = /descartada sesión (\d+) lado=([AB])/.exec(msg)
      return { tipo: 'loginBloqueado', sesion: m ? +m[1] : null, lado: m ? m[2] === 'B' : null }
    }
    if ((m = /^Login rechazado: (.*)$/.exec(msg))) return { tipo: 'loginRechazado', texto: m[1] }
    if ((m = /^Logout confirmado: (\d+) lado=([AB]) autoRetorno=(true|false)/.exec(msg)))
      return { tipo: 'logoutConfirmado', sesion: +m[1], lado: m[2] === 'B', autoRetorno: m[3] === 'true' }
    if ((m = /^Paradero inicial: (.*)$/.exec(msg))) return { tipo: 'paraderoInicial', nombre: m[1] }
    return null
  }
  if (tag === 'DRIVERAUTO') {
    if ((m = /^Terminal alcanzado lado=(true|false) \((.*)\) → cerrar sesión (\d+)/.exec(msg))) return { tipo: 'terminal', lado: m[1] === 'true', nombre: m[2], sesion: +m[3] }
    if ((m = /^Ejecutando logout automático para SessionDriver\(id=(\d+)/.exec(msg))) return { tipo: 'terminal', sesion: +m[1], v66: true }
    if ((m = /^VALIDATE AutoLogin: (true|false) - Paradero actual: (.*)$/s.exec(msg)))
      return { tipo: 'validateV66', autoLogin: m[1] === 'true', paradero: paraderoDesdeLog(parseKValue(m[2])) }
    if ((m = /^Primera sesión obtenida: (.*)$/s.exec(msg))) {
      const s = parseKValue(m[1])
      return { tipo: 'sesionMemoria', sesion: Number(s.id), lado: s.direction === true, autoLogin: s.autoLogin === true, start: s.start_time }
    }
    if ((m = /^Autoretorno → abriendo lado ([AB]) \((\w+)\)/.exec(msg))) return { tipo: 'autoretorno', lado: m[1] === 'B', config: m[2] }
    if ((m = /^Autoretorno no configurado \((\w+)\)/.exec(msg))) return { tipo: 'autoretornoNoConfig', config: m[1] }
    if (msg.startsWith('Autoretorno: sin credenciales')) return { tipo: 'autoretornoSinCreds' }
    if ((m = /^Ejecutando auto-login\.\.\.SessionDriverEntity\(id=(\d+)/.exec(msg))) return { tipo: 'autoretorno', v66: true, desde: +m[1], lado: true }
    if ((m = /^Sesión encontrada para logout remoto: (?:SessionDriverEntity\(id=)?(\d+)/.exec(msg))) return { tipo: 'remotoCierre', sesion: +m[1] }
    if ((m = /^sesion remoto: (\d+) (no encontrada|ya finalizada)/.exec(msg))) return { tipo: 'remotoIgnorado', sesion: +m[1], motivo: m[2] }
    if ((m = /^Error procesando (?:operation|android_command): (.*)$/.exec(msg))) return { tipo: 'operacionError', texto: m[1] }
    return null
  }
  if (tag === 'SocketMessageDispatcher') {
    if ((m = /^Mensaje: Header: (\w+), Data: /.exec(msg))) return { tipo: 'despacho', header: m[1] }
    if ((m = /^Processing operation: ProtoOperation\(id=([^,]*), section=[^,]*, key=([^,]*), value=(.*)\)$/.exec(msg)))
      return { tipo: 'operacionProcesada', id: m[1], key: m[2], value: m[3] }
    if ((m = /^↩️ operation (\S+) ya atendida \(key=([^)]*)\)/.exec(msg))) return { tipo: 'operacionDuplicada', id: m[1], key: m[2] }
    if ((m = /^↩️ ACK (.*)$/.exec(msg))) return { tipo: 'ack', value: m[1] }
    if ((m = /^👤 Operation login-conductor → dni='([^']*)'/.exec(msg))) return { tipo: 'loginRemoto', dni: m[1] }
    if ((m = /^👤 Operation logout-conductor → sesión (\d+)/.exec(msg))) return { tipo: 'logoutRemoto', sesion: +m[1] }
    if ((m = /^🪪 uid_driver/.exec(msg))) return { tipo: 'loginNfc' }
    return null
  }
  if (tag === 'ProtectorVM') {
    if ((m = /^(Bateria critica|ENERGY|NIGHT): cerrando sesión (\d+)/.exec(msg))) return { tipo: 'forzado', motivo: m[1], sesion: +m[2] }
    if (msg.startsWith('Bateria critica (')) return { tipo: 'bateriaCritica' }
    if (msg.startsWith('ENERGY: batería baja sin carga')) return { tipo: 'energy' }
    if (msg.startsWith('ENERGY: condición ya no aplica')) return { tipo: 'energyCancelado' }
    if (msg.startsWith('NIGHT: dentro del rango') && msg.includes('cerrando')) return { tipo: 'noche' }
    return null
  }
  return null
}

/** Parse completo: entradas + eventos + catálogo de paraderos + datos del equipo. */
export function analizarTexto(texto) {
  const { entradas, orden } = leerEntradas(texto)
  const eventos = []
  const paraderos = new Map()
  const equipo = { versiones: new Set(), serial: null, id: null, padron: null }
  const tags = new Map()
  for (const e of entradas) {
    tags.set(e.tag, (tags.get(e.tag) ?? 0) + 1)
    let ev = null
    try {
      ev = clasificar(e)
    } catch {
      ev = null
    }
    if (!ev) continue
    ev.t = e.t
    ev.i = e.i
    ev.n = e.n
    eventos.push(ev)
    if (ev.paradero?.id != null) paraderos.set(ev.paradero.id, ev.paradero)
    if (ev.tipo === 'estado') {
      if (ev.data.version) equipo.versiones.add(String(ev.data.version))
      equipo.serial ??= ev.data.serial ?? null
      equipo.id ??= ev.data.id ?? null
    }
    if (ev.tipo === 'rx' && ev.header === 'login') {
      equipo.padron ??= ev.data.padron ?? null
      equipo.id ??= ev.data.id ?? null
    }
  }
  return {
    entradas,
    orden,
    eventos,
    paraderos: [...paraderos.values()].sort((a, b) => a.id - b.id),
    equipo: { ...equipo, versiones: [...equipo.versiones] },
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]),
    desde: entradas[0]?.t ?? null,
    hasta: entradas[entradas.length - 1]?.t ?? null,
  }
}
