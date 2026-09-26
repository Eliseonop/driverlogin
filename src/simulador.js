// El mundo del simulador: la ruta circular (A ida, B vuelta), el bus, el equipo (APK) y la central.
// El equipo sigue paso a paso DriverLoginRepository, DriverSessionCoordinator, ParaderoManager, GpsViewModel,
// ProtectorViewModel, SocketMessageDispatcher, SocketHelper y SocketService; las decisiones salen de logica.js.
// La central es lo único deducido de los logs de campo.
//
// Todo el estado que cambia vive en `this.d` (datos simples) y el de la ruta en `this.m` (se reemplaza, no se
// muta): así se guardan fotos baratas del estado y se puede volver a cualquier momento.
import * as P from './logica.js'

const { ladoTxt } = P

export const CHOFERES = [
  { dni: '80183201', clave: '3201', code: 'ID29', nombre: 'Chofer 1' },
  { dni: '40516273', clave: '6273', code: 'ID41', nombre: 'Chofer 2' },
]
export const VELOCIDADES = [10, 30, 60, 120]
export const OPCIONES_RETORNO = [
  ['true', 'true'],
  ['false', 'false'],
  ['texto', '"true" (texto)'],
  ['none', 'sin config'],
]
export const OPCIONES_GPS = [
  ['ok', 'con señal'],
  ['congelado', 'sin señal (queda la última posición)'],
  ['sinfix', 'sin fix todavía (0,0)'],
]

export const DIA = 86_400_000
const VEHICULO = 15
const LATENCIA = 600 // ms por mensaje en el socket
const AUTO_B_DELAY = 1000 // ms que tarda la central en crear sola la B
const ESPERA_TERMINAL = 45_000 // ms que el bus se queda en el terminal antes de girar
const GIRO = 20_000 // ms que tarda en dar la vuelta al otro lado
const ARRANQUE = 3000 // ms desde que se enciende el equipo hasta el login del vehículo
const PASO = 10 // m entre lecturas de GPS
const SEPARACION = 20 // m entre la vereda A y la B (misma calle, sentido contrario)
const VEL = 30 / 3.6 // m/s del bus
const LEJOS = -5_000_000 // LocationState(0,0): lejísimos de la ruta
const MIN_DNI = 6 // LoginDriverViewModel.MIN_DNI_LENGTH
const ESPERA_SESION_UI = 20_000 // LoginDriverViewModel.SESSION_WAIT_MS
const ESPERA_LOGOUT = 60_000 // executeLogout: tope esperando la respuesta
const BATERIA_CRITICA = 10 // ProtectorViewModel.LOW_BATTERY_THRESHOLD
const BATERIA_ENERGY = 16 // ProtectorViewModel.ENERGY_INACTIVITY_THRESHOLD
const ENERGY_DELAY = 200_000 // ProtectorViewModel.ENERGY_INACTIVITY_DELAY
const ESPERA_APAGADO = 10_000 // batería crítica: espera a que se cierre la sesión y apaga
const APAGADO_TARDA = 5000 // lo que tarda Android en apagarse tras shutDownDevice()
const NOCHE_INI = 2.5 * 3_600_000 // 02:30
const NOCHE_FIN = 3 * 3_600_000 // 03:00
const REENVIO_OP = 5 * 60_000 // la central reenvía un operation sin eco cada ~5 min
const ID_REENVIO = '09374710268af53289c05871' // visto en los logs: los reenvíos usan este id
const MAX_FOTOS = 5000

export const rutaInicial = () => ({
  id: 1,
  nombre: 'Ruta 1',
  km: 4,
  paraderos: 10,
  radio: 50,
  radioTerminal: 130,
  retornoA: 'true',
  retornoB: 'true',
})

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const dos = n => String(Math.floor(n)).padStart(2, '0')
export const horaTxt = ms => {
  const s = Math.floor((((ms % DIA) + DIA) % DIA) / 1000)
  return `${dos(s / 3600)}:${dos((s / 60) % 60)}:${dos(s % 60)}`
}
export const diaDe = ms => Math.floor(ms / DIA)

/** Map de Kotlin: {route=1, dni=801…, direction=false}. Las claves con _ son del simulador y no se muestran. */
const kmap = v =>
  Array.isArray(v)
    ? `[${v.map(kmap).join(', ')}]`
    : v && typeof v === 'object'
      ? `{${Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => `${k}=${kmap(x)}`).join(', ')}}`
      : String(v)

const nombreParadero = p =>
  p.orden === 1 ? `Inicio ${ladoTxt(p.lado)}` : p.terminal ? `Terminal ${ladoTxt(p.lado)}${p.orden}` : `Paradero ${ladoTxt(p.lado)}${p.orden}`

export function generarParaderos(ruta, antes = []) {
  const n = ruta.paraderos
  const previo = antes.length === 2 * n ? new Map(antes.map(p => [p.id, p])) : new Map()
  const L = ruta.km * 1000
  const out = []
  for (const lado of [false, true]) {
    for (let orden = 1; orden <= n; orden++) {
      const id = (lado ? 20 : 0) + orden // ids chicos: no se confunden con los de sesión (101…)
      const p0 = previo.get(id)
      const terminal = p0 ? p0.terminal : orden === n
      const radioPropio = p0?.radioPropio ?? null
      const p = {
        id,
        ruta: ruta.id,
        lado,
        orden,
        s: ((orden - 1) / (n - 1)) * L,
        terminal,
        liquidar: p0 ? p0.liquidar : false,
        activo: p0 ? p0.activo : true,
        radio: radioPropio ?? (terminal ? ruta.radioTerminal : ruta.radio),
        radioPropio,
      }
      out.push({ ...p, nombre: nombreParadero(p) })
    }
  }
  return out
}

/** 10 geocercas al azar en las dos líneas, sin pisarse. f = posición 0..1 en su línea. */
export function generarGeocercas() {
  const g = []
  for (let intentos = 0; g.length < 10 && intentos < 800; intentos++) {
    const lado = Math.random() < 0.5
    const f = 0.04 + Math.random() * 0.92
    if (g.some(o => o.lado === lado && Math.abs(o.f - f) < 0.1)) continue
    g.push({ lado, f, radio: 80 + Math.round(Math.random() * 140) })
  }
  return g.sort((a, b) => +a.lado - +b.lado || a.f - b.f).map((x, i) => ({ ...x, id: i + 1, nombre: `Geocerca ${i + 1}` }))
}

const memoriaVacia = () => ({
  creds: null, // DriverLoginRepository._lastCredentials
  sesion: null, // SessionManager.sessionDriver
  paraderoActual: null,
  orden1: null, // SessionManager._paraderoMasCercanoOrden1
  intents: P.nuevosIntents(),
  cerrando: false, // SessionManager._loadingLogout
  logoutId: null,
  ultimoPar: '', // observeAutoLogouts: distinctUntilChanged
  lastInitTrip: null, // GpsViewModel
  dedupe: [], // OperationDeduper
  esperaUI: false, // LoginDriverViewModel esperando la sesión (20 s)
})

function estadoInicial() {
  return {
    hora: 6 * 3_600_000,
    seq: 0,
    cola: [], // eventos programados, solo datos
    enVuelo: [],
    bus: { lado: false, s: 0, fase: 'ruta', espera: 0, giro: 0, vueltas: 0 },
    pistas: [[], []],
    marcas: [[], []],
    hitos: [],
    disp: {
      encendido: true,
      conectado: true,
      gps: 'ok',
      gpsPos: { x: 0, y: 0 },
      datosRuta: true, // routes-data (paraderos + config de ruta) cargado
      bateria: 80,
      cargando: true, // bus encendido
      critPrev: null,
      bajaPrev: null,
      energyAl: null,
      apagarAl: null,
      nocheHecha: false,
    },
    veh: { id: VEHICULO, route: 1, trip: 1, state: 'R' }, // SessionManager.protoLogin
    eq: { ...memoriaVacia(), lastInitTrip: 1 },
    bd: { room: [], guardadas: null }, // Room + DataStore: sobreviven al apagado
    central: { sesiones: [], seq: 100, autoB: true, canal: 'operation', trip: 1, ops: [], opSeq: 0 },
  }
}

export class Simulador {
  constructor(ruta = {}) {
    const r = { ...rutaInicial(), ...ruta }
    this.m = { ruta: r, paraderos: generarParaderos(r), geocercas: generarGeocercas() }
    this.d = estadoInicial()
    this.logs = []
    this.hist = []
    this.cursor = null // índice de la foto que se está viendo; null = en vivo
    this.jugando = false
    this.mult = 30
    this.arrastrando = false
    this.ultimaFotoWall = -Infinity
    this.fotoPendiente = false
    this.log('GpsViewModel', 'Restauración: sin sesión pendiente en BD')
    this.gps()
    this.foto(true)
  }

  get largo() {
    return this.m.ruta.km * 1000
  }

  get dia() {
    return diaDe(this.d.hora)
  }

  // ── historia: fotos del estado para retroceder ─────────────────────────────

  foto(forzar = false) {
    const ahora = globalThis.performance?.now() ?? Date.now()
    if (!forzar && ahora - this.ultimaFotoWall < 120) return
    this.ultimaFotoWall = ahora
    this.hist.push({ hora: this.d.hora, din: structuredClone(this.d), mundo: this.m, nLogs: this.logs.length, nHitos: this.d.hitos.length })
    if (this.hist.length > MAX_FOTOS) {
      // raleo: de la mitad antigua queda una de cada dos fotos, pero nunca las que traen un hito nuevo
      const mitad = this.hist.length / 2
      this.hist = this.hist.filter((f, i) => i >= mitad || i % 2 === 0 || f.nHitos !== this.hist[i - 1]?.nHitos)
    }
  }

  /** Ver el estado de la foto i (sin borrar nada todavía). */
  irA(i) {
    i = clamp(Math.round(i), 0, this.hist.length - 1)
    const f = this.hist[i]
    this.d = structuredClone(f.din)
    this.m = f.mundo
    this.cursor = i === this.hist.length - 1 ? null : i
    this.jugando = false
    this.vistas = (this.vistas ?? 0) + 1 // para refrescar los campos del panel
  }

  get enPasado() {
    return this.cursor != null
  }

  logsVisibles() {
    return this.cursor == null ? this.logs : this.logs.slice(0, this.hist[this.cursor].nLogs)
  }

  /** Seguir desde la foto que se está viendo: se descarta lo que venía después. */
  seguirDesdeAqui() {
    if (this.cursor == null) return
    const f = this.hist[this.cursor]
    this.hist.length = this.cursor + 1
    this.logs.length = f.nLogs
    this.cursor = null
  }

  accion(fn) {
    this.seguirDesdeAqui()
    fn()
    this.foto(true)
  }

  // ── ruta ────────────────────────────────────────────────────────────────

  setRuta(cambios) {
    this.accion(() => {
      const L0 = this.largo
      const ruta = { ...this.m.ruta, ...cambios }
      this.m = { ...this.m, ruta, paraderos: generarParaderos(ruta, this.m.paraderos) }
      this.d.bus.s = clamp((this.d.bus.s / L0) * this.largo, 0, this.largo)
      this.gps()
    })
  }

  setParadero(id, cambios) {
    this.accion(() => {
      const paraderos = this.m.paraderos.map(p => {
        if (p.id !== id) return p
        const q = { ...p, ...cambios }
        if ('radio' in cambios) q.radioPropio = cambios.radio
        else if ('terminal' in cambios && q.radioPropio == null) q.radio = q.terminal ? this.m.ruta.radioTerminal : this.m.ruta.radio
        return { ...q, nombre: nombreParadero(q) }
      })
      this.m = { ...this.m, paraderos }
      this.gps()
    })
  }

  nuevasGeocercas() {
    this.accion(() => (this.m = { ...this.m, geocercas: generarGeocercas() }))
  }

  /** Config de ruta como la guarda la central (viene en routes-data): el APK solo acepta el booleano true. */
  configs() {
    if (!this.d.disp.datosRuta) return []
    const data = { true: true, false: false, texto: 'true' }
    return [
      [P.RETORNO_AUTO_A, this.m.ruta.retornoA],
      [P.RETORNO_AUTO_B, this.m.ruta.retornoB],
    ]
      .filter(([, v]) => v !== 'none')
      .map(([nombre, v]) => ({ nombre, ruta: this.m.ruta.id, data: data[v] }))
  }

  /** FetchManager.paraderosFiltrados: los de la ruta del vehículo y activos (vacío sin login o sin routes-data). */
  filtrados() {
    const v = this.d.veh
    if (!v || !this.d.disp.datosRuta) return []
    return this.m.paraderos.filter(p => p.ruta === v.route && p.activo)
  }

  /** La calle: A va de x=0 a x=L; B vuelve de x=L a x=0 por la vereda de enfrente. */
  pos(lado, s) {
    return lado ? { x: this.largo - s, y: SEPARACION } : { x: s, y: 0 }
  }

  posGps() {
    const disp = this.d.disp
    if (disp.gps === 'sinfix') return { x: LEJOS, y: 0 }
    if (disp.gps === 'congelado') return disp.gpsPos
    disp.gpsPos = this.pos(this.d.bus.lado, this.d.bus.s)
    return disp.gpsPos
  }

  geocercaActual() {
    const b = this.d.bus
    return this.m.geocercas.find(g => g.lado === b.lado && Math.abs(g.f * this.largo - b.s) <= g.radio) ?? null
  }

  // ── reloj ───────────────────────────────────────────────────────────────

  /** Avanza dtWall ms reales. Mientras viajan mensajes corre a x1 para que se vean; en pausa solo corre la red. */
  tick(dtWall) {
    if (this.cursor != null) return
    const red = this.d.cola.some(e => e.red)
    const rate = red ? 1 : this.jugando ? this.mult : 0
    if (!rate) return
    this.avanzar(dtWall * rate, this.jugando && !this.arrastrando)
    this.foto(this.fotoPendiente)
    this.fotoPendiente = false
  }

  avanzar(dt, moverBus) {
    const fin = this.d.hora + dt
    for (let vueltas = 0; vueltas < 5000; vueltas++) {
      this.vencidos()
      if (this.d.hora >= fin) break
      const prox = Math.min(fin, ...this.d.cola.map(e => e.at), ...this.limitesReloj())
      const paso = Math.max(0, prox - this.d.hora)
      if (moverBus) this.moverBus(paso)
      this.d.hora = prox
      this.reglasEquipo()
    }
  }

  /** Momentos en que cambia algo solo por el reloj (para no saltárselos al avanzar de golpe). */
  limitesReloj() {
    const { disp } = this.d
    const d0 = this.dia * DIA
    return [disp.energyAl, disp.apagarAl, d0 + NOCHE_INI, d0 + NOCHE_FIN + 1, d0 + DIA + NOCHE_INI].filter(t => t != null && t > this.d.hora)
  }

  vencidos() {
    for (let i = 0; i < 1000; i++) {
      let k = -1
      for (let j = 0; j < this.d.cola.length; j++) if (this.d.cola[j].at <= this.d.hora && (k < 0 || this.d.cola[j].at < this.d.cola[k].at)) k = j
      if (k < 0) return
      this.ejecutar(this.d.cola.splice(k, 1)[0])
    }
  }

  programar(ms, ev) {
    this.d.cola.push({ at: this.d.hora + ms, ...ev })
  }

  /** Saltar el reloj hacia adelante (el bus queda quieto): los temporizadores del medio se disparan en orden. */
  saltarA(hora) {
    this.accion(() => {
      if (hora <= this.d.hora) return
      const diaAntes = this.dia
      this.avanzar(hora - this.d.hora, false)
      if (this.dia !== diaAntes) this.log('RELOJ', `── día ${this.dia + 1} ──`, 'bus')
    })
  }

  irAHora(hhmm) {
    const [h, m] = hhmm.split(':').map(Number)
    let t = this.dia * DIA + (h * 60 + m) * 60_000
    if (t <= this.d.hora) t += DIA
    this.saltarA(t)
  }

  // ── bus ─────────────────────────────────────────────────────────────────

  moverBus(dt) {
    const b = this.d.bus
    const L = this.largo
    if (b.fase === 'terminal') {
      b.espera -= dt
      if (b.espera <= 0) {
        b.fase = 'giro'
        b.giro = 0
      }
      return
    }
    if (b.fase === 'giro') {
      b.giro += dt / GIRO
      if (b.giro >= 1) this.cambiarDeLinea()
      return
    }
    let resto = (VEL * dt) / 1000
    while (resto > 1e-9) {
      if (b.s >= L - 1e-9) {
        b.fase = 'terminal'
        b.espera = ESPERA_TERMINAL
        this.log('BUS', `Llegó al final del lado ${ladoTxt(b.lado)}`, 'bus')
        return
      }
      const paso = Math.min(PASO, resto, L - b.s)
      const desde = b.s
      b.s += paso
      resto -= paso
      this.pintar(desde, b.s)
      this.gps()
    }
  }

  cambiarDeLinea() {
    const lado = !this.d.bus.lado
    this.d.bus = { lado, s: 0, fase: 'ruta', espera: 0, giro: 0, vueltas: this.d.bus.vueltas + 1 }
    this.d.pistas[+lado] = []
    this.d.marcas[+lado] = []
    this.log('BUS', `Da la vuelta: pasa al lado ${ladoTxt(lado)}`, 'bus')
    this.gps()
  }

  /** Arrastre del bus: en la misma línea avanza de a PASO para no saltarse ningún radio. */
  moverA(lado, s) {
    this.seguirDesdeAqui()
    s = clamp(s, 0, this.largo)
    const b = this.d.bus
    b.fase = 'ruta'
    b.espera = 0
    if (lado !== b.lado) {
      b.lado = lado
      b.s = s
      this.gps()
    } else {
      while (Math.abs(s - b.s) > 0.01) {
        const desde = b.s
        b.s += clamp(s - desde, -PASO, PASO)
        this.pintar(desde, b.s)
        this.gps()
      }
    }
    this.foto()
  }

  pintar(desde, hasta) {
    const pista = this.d.pistas[+this.d.bus.lado]
    const ses = this.d.eq.sesion
    const key = !this.d.disp.encendido ? 'off' : ses ? ses.id : null
    const ult = pista.at(-1)
    if (ult && ult.key === key && Math.abs(ult.b - desde) < 0.5) ult.b = hasta
    else pista.push({ a: desde, b: hasta, key, lado: ses?.direction ?? null })
  }

  marcar(tipo, texto) {
    const b = this.d.bus
    this.d.marcas[+b.lado].push({ s: b.fase === 'ruta' ? b.s : this.largo, tipo, texto })
    this.hito(tipo, texto)
  }

  hito(tipo, texto) {
    this.d.hitos.push({ hora: this.d.hora, tipo, texto })
    this.fotoPendiente = true
  }

  log(tag, msg, tipo = 'info') {
    this.logs.push({ n: this.logs.length + 1, hora: horaTxt(this.d.hora), tag, msg, tipo })
  }

  /** Línea del simulador (no existe en el APK): explica algo que el log real no dice. */
  nota(msg) {
    this.log('·', msg, 'nota')
  }

  // ── red ─────────────────────────────────────────────────────────────────

  vuelo(tipo, dir, ev) {
    const v = { id: ++this.d.seq, tipo, dir, t0: this.d.hora, t1: this.d.hora + LATENCIA }
    this.d.enVuelo.push(v)
    this.programar(LATENCIA, { ...ev, red: true, vuelo: v.id })
  }

  /** SocketHelper.sendMessage + SocketService.send (equipo → central). */
  enviar(tipo, data, validate = true) {
    const d = this.d
    if (!d.disp.encendido) return
    if (validate && d.veh?.id == null) return this.nota(`SocketHelper descarta ${tipo}: el vehículo aún no tiene login en la central (protoLogin=null)`)
    if (!d.disp.conectado) return this.log('SocketService', `[ERROR🔴] :No conectado (false)  ← ${tipo} se pierde`, 'error')
    this.log('SocketService', `[ENVIADO] ${tipo} [DATA]: ${kmap(data)}`, 'enviado')
    this.vuelo(tipo, 'sube', { tipo: 'aCentral', msg: { tipo, data } })
  }

  /** central → equipo */
  alEquipo(tipo, data) {
    this.vuelo(tipo, 'baja', { tipo: 'aEquipo', msg: { tipo, data } })
  }

  ejecutar(ev) {
    if (ev.vuelo) this.d.enVuelo = this.d.enVuelo.filter(v => v.id !== ev.vuelo)
    switch (ev.tipo) {
      case 'aCentral':
        return this.centralRecibe(ev.msg.tipo, ev.msg.data)
      case 'aEquipo':
        return this.equipoRecibe(ev.msg.tipo, ev.msg.data)
      case 'autoB':
        return this.centralAutoB(ev.cerrada)
      case 'reenvioOp':
        return this.centralReenvio(ev.opId)
      case 'arranque':
        return this.arranque()
      case 'apagar':
        return this.d.disp.encendido && this.apagar('batería crítica')
      case 'timeoutLogout':
        if (this.d.eq.cerrando && this.d.eq.logoutId === ev.id) {
          this.log('DriverLoginRepository', `driver_logout ${ev.id}: sin respuesta en 60s`, 'error')
          this.d.eq.cerrando = false
        }
        return
      case 'timeoutUI':
        if (this.d.eq.esperaUI && !this.d.eq.sesion) this.log('LoginDriverViewModel', 'La sesión no llegó. Reintenta.', 'error')
        this.d.eq.esperaUI = false
        return
    }
  }

  // ── equipo (APK) ──────────────────────────────────────────────────────────

  /** SocketMessageDispatcher.dispatch */
  equipoRecibe(tipo, data) {
    const d = this.d
    if (!d.disp.encendido || !d.disp.conectado) {
      this.nota(`${tipo} de la central se pierde: el equipo está ${d.disp.encendido ? 'sin conexión' : 'apagado'}`)
      if (tipo === 'driver_login' || tipo === 'driver_logout') this.hito('perdido', `${tipo} perdido`)
      return
    }
    this.log('SocketService', `[RECIBIDO] ${tipo} [DATA]: ${kmap(data)}`, 'recibido')
    const T = 'SocketMessageDispatcher'
    switch (tipo) {
      case 'login':
        return this.onProtoLogin(data)
      case 'driver_login':
        return this.onLoginSuccess(data)
      case 'driver_logout':
        return this.onLogoutSuccess(data)
      case 'uid_driver':
        this.log(T, `🪪 uid_driver → login por tarjeta dni='${data.dni}'`)
        return this.performLogin(data.dni, data.key, 'nfc')
      case 'operation': {
        // Canal legacy: eco {id} siempre; los ids ya atendidos solo se re-confirman.
        this.enviar('operation', { id: data.id })
        if (d.eq.dedupe.includes(data.id)) return this.log(T, `↩️ operation ${data.id} ya atendida (key=${data.key}), solo eco`)
        d.eq.dedupe.push(data.id)
        if (d.eq.dedupe.length > 50) d.eq.dedupe.shift()
        return this.processOperation(data)
      }
      case 'android_command':
        return this.processOperation(data)
    }
  }

  /** "login" del vehículo (SessionManager.updateProtoLogin) + GpsViewModel.observeSocketAndLogin. */
  onProtoLogin(data) {
    const eq = this.d.eq
    const eraNulo = this.d.veh == null
    this.d.veh = { ...data }
    if (eraNulo) this.log('SocketMessageDispatcher', '✅ Login confirmado por servidor (sesión OK)')
    if (data.trip != null && eq.lastInitTrip !== data.trip) {
      eq.lastInitTrip = data.trip
      this.cargarUltimaSesionSinFinalizar()
    }
    this.gps()
  }

  /** GpsViewModel.cargarUltimaSesionSinFinalizar */
  cargarUltimaSesionSinFinalizar() {
    const T = 'GpsViewModel'
    const pendiente = this.ultimaPendiente()
    const r = P.restaurar(pendiente, this.dia)
    if (r.tipo === 'Nada') return this.log(T, 'Restauración: sin sesión pendiente en BD')
    if (r.tipo === 'CerrarVencida') {
      this.log(T, `Restauración: sesión ${r.sessionId} de un día anterior (día ${pendiente.dia + 1} ${horaTxt(pendiente.start)}) → cerrando`, 'auto')
      return this.executeLogout(r.sessionId)
    }
    this.log(T, `Restauración: sesión ${r.session.id} lado=${ladoTxt(r.session.direction)} restaurada desde BD (creds=${pendiente.dni ? 'sí' : 'no'})`, 'ok')
    this.d.eq.sesion = r.session
    this.marcar('login', `restaurada #${r.session.id} ${ladoTxt(r.session.direction)}`)
    this.gps()
  }

  ultimaPendiente() {
    return this.d.bd.room.filter(r => !r.finalizado).sort((a, b) => b.start - a.start)[0] ?? null
  }

  /** ParaderoManager: procesarParaderosCercanos + procesarParaderosActual + observeAutoLogouts. */
  gps() {
    const d = this.d
    const eq = d.eq
    if (!d.disp.encendido) return
    const pos = this.posGps()
    const dist = p => {
      const q = this.pos(p.lado, p.s)
      return Math.hypot(pos.x - q.x, pos.y - q.y)
    }
    const pars = this.filtrados()
    if (pars.length) {
      const o1 = P.nearestOrden1(pars, dist)
      if (o1?.id !== eq.orden1?.id) {
        eq.orden1 = o1
        this.log('ParaderoManager', `Paradero más cercano orden 1: ${o1?.nombre} (lado ${ladoTxt(o1?.lado)})`)
      }
    }
    if (!eq.sesion) {
      eq.paraderoActual = null
    } else {
      const enRadio = P.paraderoEnRadio(pars, eq.sesion.direction, dist)
      if (enRadio && enRadio.id !== eq.paraderoActual?.id) {
        eq.paraderoActual = enRadio
        this.log('ParaderoManager', `Paradero actual: ${enRadio.nombre} (id=${enRadio.id})`)
      }
    }
    this.observeAutoLogouts()
  }

  /** combine(sessionDriver, paraderoActual).distinctUntilChanged() → shouldCloseAtTerminal */
  observeAutoLogouts() {
    const { sesion, paraderoActual } = this.d.eq
    const par = `${sesion?.id}|${paraderoActual?.id}`
    if (par === this.d.eq.ultimoPar) return
    this.d.eq.ultimoPar = par
    if (!P.shouldCloseAtTerminal(sesion, paraderoActual)) return
    const que = paraderoActual.terminal ? 'Terminal' : 'Liquidar'
    this.log('DRIVERAUTO', `${que} alcanzado lado=${ladoTxt(paraderoActual.lado)} (${paraderoActual.nombre}) → cerrar sesión ${sesion.id}`, 'auto')
    this.logout(sesion.id, true, true)
  }

  /** SessionManager.createDriverLoginData */
  loginData(dni, key, lado) {
    const v = this.d.veh
    return { dni, key, direction: lado, route: v?.route ?? 0, vehicle: v?.id ?? 0 }
  }

  /** DriverLoginRepository.performLogin (manual | nfc | remoto) */
  performLogin(dni, password, origen = 'manual') {
    const T = 'DriverLoginRepository'
    if (!dni || !password) return this.log(T, 'DNI y clave son requeridos', 'error')
    const eq = this.d.eq
    eq.creds = [dni, password]
    this.log(T, `performLogin origen=${origen} dni='${dni}'`)
    const o1 = eq.orden1
    const lado = P.calculateLado(o1)
    const g = this.d.disp.gps === 'sinfix' ? 'gps=0.0,0.0 fix=false' : 'fix=true'
    this.log(T, `Lado login=${ladoTxt(lado)} por ${o1 ? `${o1.nombre} (id=${o1.id})` : 'sin paradero orden 1 → A por defecto'} ${g}`)
    this.enviar('driver_login', this.loginData(dni, password, lado))
  }

  /** DriverSessionCoordinator.logout */
  logout(sessionId, allowAutoLogin = true, autoRetorno = false) {
    this.log('DriverSessionCoordinator', `logout solicitado: ${sessionId} allowAutoLogin=${allowAutoLogin} autoRetorno=${autoRetorno}`)
    P.onLogoutRequested(this.d.eq.intents, sessionId, allowAutoLogin, autoRetorno)
    this.executeLogout(sessionId)
  }

  /** DriverLoginRepository.executeLogout */
  executeLogout(sessionId) {
    const d = this.d
    d.eq.cerrando = true
    d.eq.logoutId = sessionId
    this.enviar('driver_logout', { session: sessionId, vehicle: d.veh?.id ?? 0, end_time: horaTxt(d.hora), cash: 0, digital: 0 })
    if (!d.disp.conectado) {
      this.log('DriverLoginRepository', 'driver_logout no enviado: socket desconectado', 'error')
      d.eq.cerrando = false
      return
    }
    this.programar(ESPERA_LOGOUT, { tipo: 'timeoutLogout', id: sessionId, dev: true })
  }

  /** DriverSessionCoordinator.onLoginSuccess */
  onLoginSuccess(d) {
    const T = 'DriverSessionCoordinator'
    const eq = this.d.eq
    const first = d.sessions?.[0]
    if (P.consumeLoginBlock(eq.intents)) {
      const desc = first ? ` (descartada sesión ${first.id} lado=${ladoTxt(first.direction)} '${d.message}')` : ''
      this.log(T, `onLoginSuccess: bloqueado por logout forzado${desc}`, 'error')
      return this.marcar('descartada', first ? `descarta #${first.id}` : 'descarta')
    }
    if (d.error) {
      this.log(T, `Login rechazado: ${d.title} - ${d.message}`, 'error')
      eq.esperaUI = false
      return this.marcar('error', 'rechazado')
    }
    if (!first) return this.log(T, 'onLoginSuccess: sin sesión en la respuesta', 'error')

    eq.sesion = { id: first.id, direction: first.direction, route: first.route, dia: first._dia, start: first._start }
    this.log(T, `Sesión activada: ${first.id} lado=${ladoTxt(first.direction)} '${d.message}'`, 'ok')
    const inicial = P.paraderoInicial(this.filtrados(), first.direction)
    eq.paraderoActual = inicial
    this.log(T, `Paradero inicial: ${inicial?.nombre ?? 'null'}`)
    const bd = this.d.bd
    if (!bd.room.some(r => r.id === first.id)) {
      const [dni, password] = eq.creds ?? [null, null]
      bd.room.push({ id: first.id, direction: first.direction, route: first.route, dni, password, finalizado: false, dia: first._dia, start: first._start })
      // insertarYMantenerLimite: con más de 20 quedan las 10 más recientes
      if (bd.room.length > 20) bd.room = bd.room.sort((a, b) => b.start - a.start).slice(0, 10)
      this.log(T, `Sesión persistida en BD: ${first.id}`)
    }
    if (eq.creds) bd.guardadas = [...eq.creds]
    eq.esperaUI = false
    const quien = /automática/.test(d.message) ? 'central' : /reingresado/.test(d.message) ? 'reingreso' : 'login'
    this.marcar('login', `${quien} #${first.id} ${ladoTxt(first.direction)}`)
    this.observeAutoLogouts()
  }

  /** DriverSessionCoordinator.onLogoutSuccess */
  onLogoutSuccess(d) {
    const T = 'DriverSessionCoordinator'
    const eq = this.d.eq
    if (d.error) return this.log(T, `Error al cerrar sesión: ${d.message}`, 'error')
    const ent = this.d.bd.room.find(r => r.id === d.id)
    if (!ent) return this.log(T, `onLogoutSuccess: sesión ${d.id} no encontrada en BD`, 'error')

    ent.finalizado = true
    if (eq.sesion?.id === d.id) eq.sesion = null
    const autoRetorno = P.consumeAutoRetorno(eq.intents, d.id)
    this.log(T, `Logout confirmado: ${d.id} lado=${ladoTxt(ent.direction)} autoRetorno=${autoRetorno} '${d.title}'`, 'ok')
    this.marcar('logout', `cierre #${d.id}`)
    if (autoRetorno) this.autoRetornoAfterLogout(ent)
    eq.cerrando = false
    this.gps()
  }

  /** DriverLoginRepository.autoRetornoAfterLogout */
  autoRetornoAfterLogout(closed) {
    const dec = P.autoRetorno(closed, this.configs())
    if (dec.tipo === 'SinCredenciales') return this.log('DRIVERAUTO', 'Autoretorno: sin credenciales guardadas', 'auto')
    if (dec.tipo === 'NoConfigurado') return this.log('DRIVERAUTO', `Autoretorno no configurado (${dec.configName}) ruta=${closed.route}`, 'auto')
    this.d.eq.creds = [dec.dni, dec.password]
    this.enviar('driver_login', this.loginData(dec.dni, dec.password, dec.lado))
    this.log('DRIVERAUTO', `Autoretorno → abriendo lado ${ladoTxt(dec.lado)} (${dec.configName})`, 'auto')
  }

  /** SocketMessageDispatcher.processOperation (sesion | login-conductor | logout-conductor) */
  processOperation({ key, value }) {
    const T = 'SocketMessageDispatcher'
    this.log(T, `Processing operation: key=${key} value=${value}`)
    try {
      if (key === 'sesion') {
        const id = Number.parseInt(value, 10)
        if (Number.isNaN(id)) throw new Error('VALOR_INVALIDO')
        const c = P.cierreRemoto(this.d.bd.room.find(r => r.id === id))
        if (c.tipo === 'NoEncontrada') return this.log('DRIVERAUTO', `sesion remoto: ${id} no encontrada en BD`, 'error')
        if (c.tipo === 'YaFinalizada') return this.log('DRIVERAUTO', `sesion remoto: ${id} ya finalizada`, 'error')
        this.log('DRIVERAUTO', `Sesión encontrada para logout remoto: ${id}`)
        return this.logout(id)
      }
      if (key === 'login-conductor') {
        const cred = P.parseCredenciales(value)
        if (!cred) throw new Error('VALOR_INVALIDO')
        this.log(T, `👤 Operation login-conductor → dni='${cred[0]}'`)
        return this.performLogin(cred[0], cred[1], 'remoto')
      }
      if (key === 'logout-conductor') {
        const id = this.d.eq.sesion?.id ?? this.ultimaPendiente()?.id
        if (id == null) throw new Error('SIN_SESION_ACTIVA')
        this.log(T, `👤 Operation logout-conductor → sesión ${id}`)
        return this.logout(id)
      }
    } catch (e) {
      this.log('DRIVERAUTO', `Error procesando operation: ${e.message}`, 'error')
      this.d.eq.cerrando = false
    }
  }

  /** ProtectorViewModel.forceLogout */
  forceLogout(tag) {
    const s = this.d.eq.sesion
    if (!s) return this.log('ProtectorViewModel', `${tag}: sin sesión activa`)
    this.log('ProtectorViewModel', `${tag}: cerrando sesión ${s.id}`, 'error')
    this.hito('forzado', tag)
    this.logout(s.id, false)
  }

  /** ProtectorViewModel: batería crítica, ENERGY y cierre nocturno. */
  reglasEquipo() {
    const d = this.d
    const disp = d.disp
    if (!disp.encendido) return
    const T = 'ProtectorViewModel'
    const crit = disp.bateria <= BATERIA_CRITICA && !disp.cargando
    if (crit !== disp.critPrev) {
      disp.critPrev = crit
      if (crit) {
        this.log(T, `Bateria critica (${disp.bateria}%). Iniciando apagado.`, 'error')
        this.forceLogout('Bateria critica')
        disp.apagarAl = d.hora + ESPERA_APAGADO
      }
    }
    if (disp.apagarAl && (d.eq.sesion == null || d.hora >= disp.apagarAl)) {
      disp.apagarAl = null
      this.log(T, 'feitianManager.shutDownDevice()', 'error')
      this.programar(APAGADO_TARDA, { tipo: 'apagar', red: true })
    }

    const baja = disp.bateria <= BATERIA_ENERGY && !disp.cargando
    if (baja !== disp.bajaPrev) {
      disp.bajaPrev = baja
      if (baja) {
        this.log(T, `ENERGY: batería baja sin carga → esperando ${Math.round(ENERGY_DELAY / 60000)}min`)
        disp.energyAl = d.hora + ENERGY_DELAY
      } else if (disp.energyAl) {
        this.log(T, 'ENERGY: condición inactiva')
        disp.energyAl = null
      }
    }
    if (disp.energyAl && d.hora >= disp.energyAl) {
      disp.energyAl = null
      this.forceLogout('ENERGY')
    }

    const hm = ((d.hora % DIA) + DIA) % DIA
    const enRango = hm >= NOCHE_INI && hm < NOCHE_FIN
    if (enRango && !disp.nocheHecha) {
      if (d.eq.sesion) {
        this.log(T, 'NIGHT: dentro del rango 02:30-03:00 → cerrando sesión')
        this.forceLogout('NIGHT')
      } else this.log(T, 'NIGHT: dentro del rango 02:30-03:00 → sin sesión activa, nada que hacer')
      disp.nocheHecha = true
    } else if (!enRango && hm > NOCHE_FIN && disp.nocheHecha) {
      disp.nocheHecha = false
    }
  }

  apagar(motivo) {
    const d = this.d
    this.log('SISTEMA', `Equipo apagado (${motivo}): se pierde la memoria; Room y DataStore quedan`, 'bus')
    d.disp = { ...d.disp, encendido: false, critPrev: null, bajaPrev: null, energyAl: null, apagarAl: null, nocheHecha: false }
    d.eq = memoriaVacia()
    d.veh = null
    d.cola = d.cola.filter(e => !e.dev)
    this.marcar('apagado', 'apagado')
  }

  arranque() {
    const d = this.d
    if (!d.disp.encendido) return
    if (!d.disp.conectado) return this.log('SocketService', 'Sin conexión: el login del vehículo sale al reconectar', 'error')
    this.enviar('login', { serial: `SIM-${VEHICULO}` }, false)
  }

  // ── acciones del panel ──────────────────────────────────────────────────

  /** La pantalla de login solo se ve sin sesión (NavTicket: sessionDriver == null → NavLogin). */
  puedeLoguear() {
    return this.d.disp.encendido && !this.d.eq.sesion
  }

  /** LoginDriverViewModel.login (teclado) */
  loginTeclado(dni, clave) {
    this.accion(() => {
      if (!this.puedeLoguear()) return
      const T = 'LoginDriverViewModel'
      if (dni.length < MIN_DNI) return this.log(T, `DNI incompleto (mínimo ${MIN_DNI} dígitos)`, 'error')
      if (!clave) return this.log(T, 'Contraseña requerida', 'error')
      this.d.eq.esperaUI = true
      this.programar(ESPERA_SESION_UI, { tipo: 'timeoutUI', dev: true })
      this.performLogin(dni, clave, 'manual')
    })
  }

  /** Tarjeta NFC: la central resuelve la tarjeta y responde uid_driver con dni + key. */
  tarjeta(chofer) {
    this.accion(() => {
      if (!this.puedeLoguear()) return
      if (!this.d.disp.conectado) return this.log('SocketService', '[ERROR🔴] :No conectado (false)  ← lectura de tarjeta se pierde', 'error')
      this.log('LoginDriverViewModel', `Tarjeta leída (${chofer.nombre})`)
      this.alEquipo('uid_driver', { dni: chofer.dni, key: chofer.clave })
    })
  }

  terminarVenta() {
    this.accion(() => {
      const s = this.d.eq.sesion
      if (this.d.disp.encendido && s) this.logout(s.id)
    })
  }

  setEncendido(on) {
    this.accion(() => {
      const disp = this.d.disp
      if (on === disp.encendido) return
      if (!on) return this.apagar('a mano')
      disp.encendido = true
      this.log('SISTEMA', 'Equipo encendido: conectando y esperando el login del vehículo…', 'bus')
      this.marcar('encendido', 'encendido')
      this.programar(ARRANQUE, { tipo: 'arranque', red: true, dev: true })
      this.reglasEquipo()
    })
  }

  setConectado(on) {
    this.accion(() => {
      const d = this.d
      if (on === d.disp.conectado) return
      d.disp.conectado = on
      if (!d.disp.encendido) return
      if (!on) {
        this.log('GpsViewModel', 'No hay conexión. Se omite procesamiento.', 'error')
        if (d.eq.cerrando) {
          this.log('DriverLoginRepository', 'driver_logout: conexión perdida esperando respuesta', 'error')
          d.eq.cerrando = false
          d.cola = d.cola.filter(e => e.tipo !== 'timeoutLogout')
        }
      } else {
        this.log('SocketService', '✅ CONECTADO → reenvía el login del vehículo')
        this.enviar('login', { serial: `SIM-${VEHICULO}` }, false)
      }
    })
  }

  setGps(modo) {
    this.accion(() => {
      this.d.disp.gps = modo
      this.gps()
    })
  }

  setDatosRuta(on) {
    this.accion(() => {
      this.d.disp.datosRuta = on
      this.gps()
    })
  }

  setBateria(nivel, cargando) {
    this.accion(() => {
      this.d.disp.bateria = nivel
      this.d.disp.cargando = cargando
      this.reglasEquipo()
    })
  }

  setAutoB(on) {
    this.accion(() => (this.d.central.autoB = on))
  }

  setCanal(canal) {
    this.accion(() => (this.d.central.canal = canal))
  }

  setJugando(on) {
    this.seguirDesdeAqui()
    this.jugando = on
  }

  // ── central (reglas vistas en los logs) ───────────────────────────────────

  abiertaEnCentral() {
    return this.d.central.sesiones.find(s => s.abierta) ?? null
  }

  centralLog(msg) {
    this.log('CENTRAL', msg, 'central')
  }

  centralRecibe(tipo, data) {
    const c = this.d.central
    if (tipo === 'login') return this.alEquipo('login', { id: VEHICULO, route: this.m.ruta.id, trip: c.trip, state: 'R' })
    if (tipo === 'driver_login') return this.alEquipo('driver_login', this.centralLogin(data))
    if (tipo === 'driver_logout') return this.centralLogout(data)
    if (tipo === 'operation') {
      const antes = c.ops.length
      c.ops = c.ops.filter(o => o.id !== data.id)
      if (c.ops.length < antes) this.centralLog(`eco de operation ${data.id}: no se reenvía más`)
    }
  }

  payload(s) {
    return { id: s.id, driver_code: s.code, route: s.route, direction: s.direction, start_time: `día ${s.dia + 1} ${horaTxt(s.start)}`, _dia: s.dia, _start: s.start }
  }

  crearSesion(chofer, direction, route, auto = false) {
    const c = this.d.central
    const s = { id: ++c.seq, dni: chofer.dni, code: chofer.code, direction, route, abierta: true, auto, dia: this.dia, start: Math.round(this.d.hora) }
    c.sesiones.push(s)
    this.centralLog(`crea sesión ${s.id} lado ${ladoTxt(direction)} (${chofer.code})${auto ? ' automática' : ''}`)
    return s
  }

  centralLogin({ dni, key, direction, route }) {
    const err = (title, message) => {
      this.centralLog(`rechaza login ${dni}: ${message}`)
      return { sessions: [], error: true, title, message }
    }
    if (!/^\d{8}$/.test(String(dni ?? ''))) return err('Formulario Inválido', 'Ocurrió un error al procesar la solicitud')
    const chofer = CHOFERES.find(c => c.dni === dni)
    if (!chofer || chofer.clave !== key) return err('error', 'DNI y CLAVE inválidos')
    const abierta = this.abiertaEnCentral()
    if (abierta && abierta.dni !== dni) return err('error', `La unidad tiene una sesión abierta con otro conductor  - ${abierta.id}`)
    if (abierta) {
      const nota = abierta.direction !== direction ? ` (pidió ${ladoTxt(direction)}, devuelve ${ladoTxt(abierta.direction)})` : ''
      this.centralLog(`reingreso a sesión ${abierta.id}${nota}`)
      return { sessions: [this.payload(abierta)], error: false, title: 'Acceso permitido', message: 'Ha reingresado a su sesión anterior' }
    }
    const s = this.crearSesion(chofer, direction, route)
    return { sessions: [this.payload(s)], error: false, title: 'Acceso permitido', message: 'Se ha creado una nueva sesión' }
  }

  centralLogout({ session }) {
    const s = this.d.central.sesiones.find(x => x.id === session)
    const estaba = !!s?.abierta
    if (estaba) {
      s.abierta = false
      this.centralLog(`cierra sesión ${s.id} lado ${ladoTxt(s.direction)}`)
    }
    this.alEquipo('driver_logout', { id: session, error: false, title: estaba ? 'Sesión Cerrada' : 'Ya estaba cerrada', message: 'Se cerró la sesión correctamente' })
    // Visto en los logs: al cerrar una A abierta (por cualquier motivo) la central crea sola la B.
    if (estaba && !s.direction && this.d.central.autoB) this.programar(AUTO_B_DELAY, { tipo: 'autoB', red: true, cerrada: s.id })
  }

  centralAutoB(cerradaId) {
    if (this.abiertaEnCentral()) return
    const cerrada = this.d.central.sesiones.find(s => s.id === cerradaId)
    const chofer = CHOFERES.find(c => c.dni === cerrada.dni)
    const nueva = this.crearSesion(chofer, true, cerrada.route, true)
    this.alEquipo('driver_login', { sessions: [this.payload(nueva)], error: false, title: 'Acceso permitido', message: 'Se ha creado una nueva sesión automática' })
  }

  /** Orden remota: por `operation` (con id, eco y reenvío) o por `android_command` (sin id). */
  centralOrden(key, value) {
    this.accion(() => {
      const c = this.d.central
      this.centralLog(`envía ${c.canal} ${key}=${value}`)
      if (c.canal === 'android_command') return this.alEquipo('android_command', { key, value })
      const id = (0x5f1a0000 + ++c.opSeq).toString(16).padStart(24, '0')
      c.ops.push({ id, key, value, reenvios: 0 })
      this.alEquipo('operation', { id, key, value })
      this.programar(REENVIO_OP, { tipo: 'reenvioOp', opId: id })
    })
  }

  centralReenvio(opId) {
    const c = this.d.central
    const op = c.ops.find(o => o.id === opId)
    if (!op || op.reenvios >= 5) return
    op.reenvios++
    op.id = ID_REENVIO
    this.centralLog(`sin eco: reenvía operation ${op.key}=${op.value} (id ${op.id})`)
    this.alEquipo('operation', { id: op.id, key: op.key, value: op.value })
    this.programar(REENVIO_OP, { tipo: 'reenvioOp', opId: op.id })
  }

  cerrarDesdeCentral() {
    const abierta = this.abiertaEnCentral()
    if (!abierta) return this.accion(() => this.centralLog('no hay sesión abierta para cerrar'))
    this.centralOrden('sesion', String(abierta.id))
  }

  /** Nueva salida del vehículo: llega otro "login" con trip nuevo → el equipo vuelve a mirar Room. */
  nuevaSalida() {
    this.accion(() => {
      const c = this.d.central
      c.trip++
      this.centralLog(`nueva salida: trip ${c.trip}`)
      this.alEquipo('login', { id: VEHICULO, route: this.m.ruta.id, trip: c.trip, state: 'R' })
    })
  }
}
