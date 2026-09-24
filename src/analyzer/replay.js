// "¿Qué habría pasado con otra lógica?": convierte un log real en un guion (GPS, logins manuales, órdenes de
// la central, reinicios, cortes de red, batería) y lo corre en el simulador con el perfil elegido.
// Lo que en el log fue DECISIÓN de la app (cierre en terminal, autoretorno, restauración) NO se copia:
// lo decide la lógica simulada. Así se compara lo real contra lo que haría el código.

import { World } from '../engine/world.js'
import { offset } from '../engine/geo.js'
import RUTA_124 from '../data/ruta124.js'
import { diagnosticar } from './diagnose.js'
import { ID_REENVIO_FIJO } from '../engine/server.js'

const CLAVES_CENTRAL = new Set(['sesion', 'logout-conductor', 'login-conductor'])

export function guionDesdeLog(diag) {
  const { parse, sesiones } = diag
  const evs = parse.eventos
  const avisos = []
  const acciones = []
  const add = (e, tipo, a = {}) => acciones.push({ t: e.t, i: e.i, tipo, a })

  let paraderos = parse.paraderos
  if (paraderos.length < 2) {
    avisos.push('El log casi no trae paraderos: se usa la ruta 1 del padrón 124.')
    paraderos = RUTA_124.paraderos
  }
  const txLogin = evs.find(e => e.tipo === 'tx' && e.header === 'driver_login')
  const rxLogin = evs.find(e => e.tipo === 'rx' && e.header === 'login')
  const route = Number(txLogin?.data.route ?? rxLogin?.data.route ?? paraderos[0]?.ruta ?? 1)
  const vehicle = Number(txLogin?.data.vehicle ?? rxLogin?.data.id ?? parse.equipo.id ?? 15)

  // Choferes: DNI/clave vistos en driver_login; código desde la respuesta que les siguió.
  const choferes = new Map()
  evs.forEach((e, k) => {
    if (e.tipo !== 'tx' || e.header !== 'driver_login') return
    const dni = String(e.data.dni ?? '')
    const key = String(e.data.key ?? '')
    const resp = evs.slice(k + 1, k + 40).find(x => x.tipo === 'rx' && x.header === 'driver_login')
    const ok = resp && !resp.data.error
    const code = ok ? resp.data.sessions?.[0]?.driver_code : null
    const prev = choferes.get(dni)
    if (!prev || (ok && !prev.ok)) choferes.set(dni, { dni, clave: key, driver_id: Number(resp?.data.sessions?.[0]?.driver_id ?? 0), code: code ?? prev?.code ?? `DNI${dni.slice(-3)}`, ok })
  })
  if (!choferes.size) choferes.set('40000001', { dni: '40000001', clave: '0001', driver_id: 1, code: 'ID1', ok: true })

  // Sesión que ya venía abierta antes del inicio del log.
  const previa = sesiones.find(s => s.apertura === 'previa' && s.lado != null && Number.isFinite(s.id))
  const primerCreada = sesiones.filter(s => s.apertura !== 'previa').map(s => s.id).sort((a, b) => a - b)[0]

  let trip = null
  let red = true
  const opsVistas = new Set()
  evs.forEach((e, k) => {
    switch (e.tipo) {
      case 'arranque':
        if (e.t - parse.desde > 30_000) add(e, 'reiniciar')
        return
      case 'desconectado':
        if (red) add(e, 'red', { on: false })
        red = false
        return
      case 'conectado':
        if (!red) add(e, 'red', { on: true })
        red = true
        return
      case 'rx':
        if (e.header === 'login' && e.data.trip != null) {
          if (trip != null && e.data.trip !== trip) add(e, 'viaje', { direction: e.data.direction === true })
          trip = e.data.trip
        }
        if ((e.header === 'operation' || e.header === 'android_command') && CLAVES_CENTRAL.has(e.data.key)) {
          const id = String(e.data.id ?? `${e.header}-${e.t}`)
          if (e.header === 'operation' && (id === ID_REENVIO_FIJO || opsVistas.has(id))) return
          opsVistas.add(id)
          const via = e.header
          const v = e.data.value ?? ''
          if (e.data.key === 'sesion') add(e, 'cerrarRemoto', { via, sesion: v })
          else if (e.data.key === 'logout-conductor') add(e, 'logoutConductor', { via })
          else add(e, 'loginConductor', { via, value: v })
        }
        if (e.header === 'uid_driver' && e.data.dni) add(e, 'login', { dni: String(e.data.dni), clave: String(e.data.key ?? '') })
        if (e.header === 'report') return
        return
      case 'tx':
        if (e.header === 'driver_login') {
          const auto = evs.slice(Math.max(0, k - 12), k + 6).some(x => Math.abs(e.t - x.t) <= 3000 && (x.tipo === 'autoretorno' || x.tipo === 'loginRemoto' || x.tipo === 'loginNfc' || (x.tipo === 'rx' && x.header === 'uid_driver')))
          if (!auto) add(e, 'login', { dni: String(e.data.dni ?? ''), clave: String(e.data.key ?? '') })
        }
        if (e.header === 'report') for (const p of e.data.positions ?? []) if (p?.lat && p?.lng) add(e, 'mover', { lat: Number(p.lat), lng: Number(p.lng), acc: Number(p.accuracy ?? 5) })
        return
      case 'paraderoActual':
        add(e, 'irA', { paradero: e.id })
        return
      case 'validateV66':
        if (e.paradero) add(e, 'irA', { paradero: e.paradero.id })
        return
      case 'cercano':
        if (e.paradero) {
          const p = offset(e.paradero.latitud, e.paradero.longitud, e.paradero.radio + 20, 0)
          add(e, 'mover', { lat: p.lat, lng: p.lng })
        }
        return
      case 'ladoLogin':
        if (e.fix) add(e, 'mover', { lat: e.lat, lng: e.lng, acc: e.acc })
        return
      case 'logoutSolicitado': {
        const s = sesiones.find(x => x.id === e.sesion)
        if (s?.cierreCausa === 'terminar-venta' && s.cierreSolicitado === e.t) add(e, 'terminarVenta')
        return
      }
      case 'bateriaCritica':
        add(e, 'bateriaCritica')
        return
      case 'energy':
        add(e, 'energy')
        return
      case 'energyCancelado':
        add(e, 'cargar')
        return
      default:
    }
  })

  // Si el log empieza sin fix GPS conocido, ubicar el bus en el primer punto que aparezca.
  const primerGps = acciones.find(a => a.tipo === 'mover' || a.tipo === 'irA')
  acciones.sort((a, b) => a.t - b.t || a.i - b.i)
  return {
    config: {
      ruta: { nombre: 'Ruta del log', route, vehicle, paraderos },
      inicio: parse.desde - 8000,
      inicioEn: primerGps?.tipo === 'irA' ? primerGps.a.paradero : paraderos.find(p => p.orden === 1)?.nombre,
      choferes: [...choferes.values()],
      servidor: { primerId: primerCreada ?? (previa ? previa.id + 1 : 35417), trip: trip ?? 1 },
    },
    previa,
    acciones,
    avisos,
  }
}

/** Corre el guion con la lógica elegida y devuelve el mundo simulado + su propio diagnóstico. */
export function reproducir(diagReal, { perfil = 'actual', retorno, servidor = {}, logsNuevos = true } = {}) {
  const guion = guionDesdeLog(diagReal)
  const cfg = { ...guion.config, perfil, logsNuevos, servidor: { ...guion.config.servidor, ...servidor } }
  if (retorno) cfg.retorno = retorno
  const primerMover = guion.acciones.find(a => a.tipo === 'mover')
  const w = new World(cfg)
  if (primerMover && guion.config.inicioEn == null) w.moverBus(primerMover.a.lat, primerMover.a.lng)

  if (guion.previa) sembrarPrevia(w, guion.previa, guion.config.choferes[0])

  const errores = []
  for (const a of guion.acciones) {
    if (a.t > w.now) w.avanzarHasta(a.t)
    try {
      w.accion(a.tipo, a.a)
    } catch (e) {
      errores.push(`${a.tipo} (línea ${a.i + 1}): ${e.message}`)
    }
  }
  w.avanzar(90_000)
  const diagSim = diagnosticar(w.exportarLog('asc'))
  return { world: w, guion, errores, diagSim }
}

function sembrarPrevia(w, s, chofer) {
  const start = s.startTime ?? null
  w.server.sesiones.push({ id: s.id, dni: chofer.dni, driver_id: chofer.driver_id, driver_code: s.driver ?? chofer.code, route: w.cfg.route, vehicle: w.cfg.vehicle, direction: s.lado, start_time: start ?? '', open: true, automatica: false, inicio: w.now, fin: null })
  w.server.nextId = Math.max(w.server.nextId, s.id + 1)
  w.device.roomInsertar({
    id: s.id,
    driver_id: chofer.driver_id,
    driver_code: s.driver ?? chofer.code,
    activo: true,
    castigado: false,
    conductor: true,
    vencido: false,
    route: w.cfg.route,
    direction: s.lado,
    start_time: start ?? '',
    finalizado: false,
    end_time: null,
    dni: chofer.dni,
    password: chofer.clave,
    autoLogin: w.device.v66,
  })
  w.evento('sim', `🧩 sesión ${s.id} (${s.lado ? 'B' : 'A'}) ya estaba abierta antes del log: se siembra en Room y en la central`)
  w.device.cargarUltimaSesionSinFinalizar()
}
