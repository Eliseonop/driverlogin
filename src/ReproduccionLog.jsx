import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { duracion, fechaLog, horaLog, parseStamp } from './log/leer.js'
import { buscar, estadoEn, ladoTxt, tramoEn } from './log/reconstruir.js'
import ConsumoFrame, { useConsumo } from './ConsumoFrame.jsx'
import Cuadre from './Cuadre.jsx'
import Inspector from './Inspector.jsx'
import Recorrido from './Recorrido.jsx'

const colorLado = lado => (lado == null ? 'var(--none)' : lado ? 'var(--b)' : 'var(--a)')
const VELOCIDADES = [60, 300, 1200, 3600]
const ZOOMS = [
  ['todo', null],
  ['2 h', 2 * 3_600_000],
  ['30 min', 30 * 60_000],
  ['5 min', 5 * 60_000],
]
const PESTANAS = [
  ['sesion', 'Sesión', 'Login, cierre y conexión en el tiempo'],
  ['cuadre', 'Cuadre', 'Liquidación de cada sesión contra los boletos enviados'],
  ['ventas', 'Ventas e impresión', 'Toques, impresión, impresora y envío de boletos (app de consumo)'],
  ['inspector', 'Inspector', 'QR, boletos que pidió el inspector y boletos impresos sin toque del chofer'],
  ['recorrido', 'Recorrido', 'Mapa: GPS, geocercas y paraderos'],
  ['consumo', 'Consumo y red', 'Datos móviles, reinicios, versión y red (app de consumo)'],
]
/** Pestañas que muestran paneles de la app de consumo, y cuál grupo. */
const GRUPO_CONSUMO = { cuadre: 'sesiones', ventas: 'ventas', consumo: 'consumo' }
const CON_TIEMPO = new Set(['sesion', 'recorrido'])

/** Sesiones de la plataforma pegadas en Cuadre: se recuerdan por archivo de log en este navegador. */
function usePlataforma(archivo) {
  const clave = `driverlogin.plataforma.${archivo}`
  const [texto, setTexto] = useState(() => {
    try {
      return localStorage.getItem(clave) ?? ''
    } catch {
      return ''
    }
  })
  const guardar = t => {
    setTexto(t)
    try {
      if (t) localStorage.setItem(clave, t)
      else localStorage.removeItem(clave)
    } catch {}
  }
  return [texto, guardar]
}
const ESTADO_VIAJE ={ R: 'en ruta', E: 'espera', X: 'fuera de ruta', T: 'terminado' }
const TXT_CENTRAL = {
  confirmada: 'confirmada por la central',
  incierta: 'cierre enviado sin respuesta: no se sabe si la cerró',
  inferida: 'deducida: la central pidió cerrarla, nunca llegó al equipo',
}

export default function ReproduccionLog({ rep, onCerrar }) {
  const [t, setT] = useState(() => rep.hallazgos.find(h => h.nivel === 'error')?.t ?? rep.desde)
  const [jugando, setJugando] = useState(false)
  const [mult, setMult] = useState(300)
  const [zoom, setZoom] = useState('2 h')
  const [vista, setVista] = useState('sesion')
  const [sesionCuadre, setSesionCuadre] = useState(null)
  const [rango, setRango] = useState([rep.desde, rep.hasta])
  const [plataforma, setPlataforma] = usePlataforma(rep.archivo)
  const consumo = useConsumo(rep, plataforma)
  const noCuadran = rep.cuadre.sesiones.filter(s => s.estado === 'no-cuadra').length
  const st = useMemo(() => estadoEn(rep, t), [rep, t])
  // Vista recortada: barra de tiempo, carriles, hitos, hallazgos, Play y recorrido solo miran [desde, hasta].
  const vr = useMemo(() => {
    const [desde, hasta] = rango
    const dentro = x => x.t >= desde && x.t <= hasta
    return { ...rep, desde, hasta, hitos: rep.hitos.filter(dentro), hallazgos: rep.hallazgos.filter(dentro), log: rep }
  }, [rep, rango])
  const cambiarRango = (a, b) => {
    const desde = Math.max(rep.desde, a)
    const hasta = Math.min(rep.hasta, b)
    if (!(hasta - desde >= 60_000)) return
    setRango([desde, hasta])
    setT(x => Math.max(desde, Math.min(hasta, x)))
  }

  useEffect(() => {
    if (!jugando) return
    let raf
    let prev = performance.now()
    const loop = now => {
      const dt = Math.min(100, now - prev)
      prev = now
      setT(x => {
        const y = x + dt * mult
        if (y >= vr.hasta) setJugando(false)
        return Math.min(y, vr.hasta)
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [jugando, mult, vr])

  const ir = x => {
    setJugando(false)
    setT(Math.max(vr.desde, Math.min(vr.hasta, x)))
  }
  const verEnSesion = x => {
    if (x < vr.desde || x > vr.hasta) setRango([rep.desde, rep.hasta])
    setVista('sesion')
    setJugando(false)
    setT(x)
  }
  const abrirHallazgo = h => {
    if (h.vista === 'cuadre') {
      setSesionCuadre(h.sesion)
      setVista('cuadre')
    } else if (h.vista === 'inspector') setVista('inspector')
    else if (!CON_TIEMPO.has(vista)) setVista('sesion')
    ir(h.t)
  }

  return (
    <div className="app">
      <PanelLog rep={vr} t={t} ir={ir} abrirHallazgo={abrirHallazgo} jugando={jugando} setJugando={setJugando} mult={mult} setMult={setMult} onCerrar={onCerrar} />
      <main className="main">
        <div className="barra-vista">
          <div className="pestanas">
            {PESTANAS.map(([k, txt, ayuda]) => (
              <button key={k} className={vista === k ? 'on' : ''} onClick={() => setVista(k)} title={ayuda}>
                {txt}
                {k === 'cuadre' && noCuadran > 0 && <span className="pest-alerta">{noCuadran}</span>}
                {k === 'inspector' && rep.inspector.filas.length > 0 && <span className="pest-alerta info">{rep.inspector.filas.length}</span>}
              </button>
            ))}
          </div>
          <div className="barra-acciones">
            {CON_TIEMPO.has(vista) && <Rango rep={rep} rango={rango} cambiar={cambiarRango} t={t} />}
            <div className="informe-botones">
              <button onClick={() => consumo.informe(false)} title="Informe de boletos de la app de consumo (impresos, cobrados sin papel, fallas, envío a la central)">📄 Informe de boletos</button>
              <button onClick={() => consumo.informe(true)} title="Imprimir o guardar el informe como PDF">🖨️</button>
            </div>
          </div>
        </div>
        {CON_TIEMPO.has(vista) && <SliderRango rep={rep} rango={rango} cambiar={cambiarRango} t={t} />}
        {vista === 'sesion' && (
          <>
            <EstadoLog rep={rep} st={st} />
            <CircuitoLog rep={rep} st={st} />
            <BarraTiempo rep={vr} t={t} ir={ir} />
            <Carriles rep={vr} t={t} ir={ir} zoom={zoom} setZoom={setZoom} />
            <div className="dos-col">
              <Secuencia rep={rep} t={t} ir={ir} />
              <LogReal rep={rep} linea={st.linea} ir={ir} seguir={jugando} />
            </div>
          </>
        )}
        {vista === 'cuadre' && <Cuadre rep={rep} sel={sesionCuadre} setSel={setSesionCuadre} verEnSesion={verEnSesion} plataforma={plataforma} setPlataforma={setPlataforma} />}
        {vista === 'inspector' && <Inspector rep={rep} verEnSesion={verEnSesion} />}
        {vista === 'recorrido' && (
          <>
            <BarraTiempo rep={vr} t={t} ir={ir} />
            <Recorrido rep={rep} desde={vr.desde} hasta={vr.hasta} t={t} ir={ir} log={<LogReal rep={rep} linea={st.linea} ir={ir} seguir={jugando} filtroInicial="todo" />} />
          </>
        )}
        <ConsumoFrame c={consumo} grupo={GRUPO_CONSUMO[vista]} plataforma={plataforma} />
      </main>
    </div>
  )
}

// ── rango de la vista (global para todas las pestañas) ─────────────────────────

const aInput = ms => new Date(ms).toISOString().slice(0, 19)

/** Un viaje por trip; si llegó su "salida", se nombra por la hora de salida programada (como la pide la plataforma). */
function viajesDe(rep) {
  const salida = new Map()
  for (const e of rep.eventos) if (e.tipo === 'rx' && e.header === 'salida') salida.set(String(e.data.id), parseStamp(e.data.inicio))
  const porTrip = new Map()
  for (const v of rep.viaje) {
    const x = porTrip.get(v.trip)
    if (x) x.hasta = Math.max(x.hasta, v.hasta)
    else porTrip.set(v.trip, { trip: v.trip, lado: v.lado, desde: v.desde, hasta: v.hasta, salida: salida.get(String(v.trip)) })
  }
  return [...porTrip.values()].sort((a, b) => a.desde - b.desde)
}

function Rango({ rep, rango, cambiar, t }) {
  const viajes = useMemo(() => viajesDe(rep), [rep])
  const [d, h] = rango
  const completo = d === rep.desde && h === rep.hasta
  const leer = (e, cual) => {
    const x = parseStamp(e.target.value)
    if (x != null) cual === 'd' ? cambiar(x, h) : cambiar(d, x)
  }
  return (
    <div className={`rango ${completo ? '' : 'recortado'}`}>
      <span className="rango-tit">Rango</span>
      <input type="datetime-local" step="1" min={aInput(rep.desde)} max={aInput(rep.hasta)} value={aInput(d)} onChange={e => leer(e, 'd')} />
      <span className="sutil">→</span>
      <input type="datetime-local" step="1" min={aInput(rep.desde)} max={aInput(rep.hasta)} value={aInput(h)} onChange={e => leer(e, 'h')} />
      <span className="sutil rango-dur">{duracion(h - d)}</span>
      <button onClick={() => cambiar(t, h)} title={`Empezar el rango en ${horaLog(t)}`}>desde aquí</button>
      <button onClick={() => cambiar(d, t)} title={`Terminar el rango en ${horaLog(t)}`}>hasta aquí</button>
      <select value="" onChange={e => { const v = viajes.find(x => String(x.trip) === e.target.value); if (v) cambiar(v.desde, v.hasta) }}>
        <option value="">Viaje…</option>
        {viajes.map(v => (
          <option key={v.trip} value={v.trip}>
            {v.salida != null ? `salida ${fechaLog(v.salida) !== fechaLog(v.desde) ? `${fechaLog(v.salida).slice(0, 5)} ` : ''}${horaLog(v.salida).slice(0, 5)} · ` : ''}trip {v.trip} · {ladoTxt(v.lado)} · {horaLog(v.desde).slice(0, 5)}–{horaLog(v.hasta).slice(0, 5)}
          </option>
        ))}
      </select>
      <button disabled={completo} onClick={() => cambiar(rep.desde, rep.hasta)}>Todo</button>
    </div>
  )
}

/**
 * Todo el log en una barra con dos manijas: inicio y fin del rango (arrastrar la franja la mueve entera).
 * Mientras se arrastra solo se previsualiza; el rango se aplica al soltar para no recalcular el mapa a cada píxel.
 */
function SliderRango({ rep, rango, cambiar, t }) {
  const barra = useRef(null)
  const arrastre = useRef(null)
  const [previa, setPrevia] = useState(null)
  const [d, h] = previa ?? rango
  const span = rep.hasta - rep.desde
  const pct = x => ((x - rep.desde) / span) * 100
  const tDe = e => {
    const r = barra.current.getBoundingClientRect()
    return rep.desde + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span
  }
  const calcular = (a, x) => {
    if (a.modo === 'd') return [Math.min(x, a.h - 60_000), a.h]
    if (a.modo === 'h') return [a.d, Math.max(x, a.d + 60_000)]
    const w = a.h - a.d
    const nd = Math.max(rep.desde, Math.min(rep.hasta - w, a.d + x - a.x0))
    return [nd, nd + w]
  }
  const empezar = (e, modo) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      barra.current.setPointerCapture(e.pointerId)
    } catch {}
    const x = tDe(e)
    const [rd, rh] = rango
    // Clic en la barra fuera de las manijas: mueve la manija más cercana hasta ahí.
    const m = modo ?? (Math.abs(x - rd) <= Math.abs(x - rh) ? 'd' : 'h')
    arrastre.current = { modo: m, x0: x, d: rd, h: rh, previa: null }
    if (!modo) mover(e)
  }
  const mover = e => {
    const a = arrastre.current
    if (!a) return
    a.previa = calcular(a, tDe(e))
    setPrevia(a.previa)
  }
  const soltar = () => {
    const a = arrastre.current
    if (!a) return
    arrastre.current = null
    if (a.previa) cambiar(a.previa[0], a.previa[1])
    setPrevia(null)
  }
  const paso = pasoEje(span)
  const ticks = []
  for (let k = Math.ceil(rep.desde / paso) * paso; k <= rep.hasta; k += paso) ticks.push(k)
  const huecos = rep.conexion.huecos
  return (
    <div className="slider-rango">
      <span className="sr-tit">Rango<br /><span className="sutil">{duracion(h - d)}</span></span>
      <div className="sr-barra" ref={barra} onPointerDown={e => empezar(e, null)} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
        <div className="sr-pista" />
        {ticks.map(k => (
          <span key={k} className="sr-tick" style={{ left: `${pct(k)}%` }}>{horaLog(k).slice(0, 5)}</span>
        ))}
        {huecos.map((x, k) => (
          <span key={k} className="sr-hueco" style={{ left: `${pct(x.desde)}%`, width: `${Math.max(0.2, pct(x.hasta) - pct(x.desde))}%` }} title={`sin conexión ${horaLog(x.desde)}–${horaLog(x.hasta)} (${duracion(x.hasta - x.desde)})`} />
        ))}
        <div className="sr-sel" style={{ left: `${pct(d)}%`, width: `${pct(h) - pct(d)}%` }} onPointerDown={e => empezar(e, 'mover')} title="Arrastra para mover el rango entero" />
        {t >= rep.desde && t <= rep.hasta && <span className="sr-t" style={{ left: `${pct(t)}%` }} />}
        {/* La hora va hacia afuera de la franja, salvo pegada al borde: ahí va hacia adentro para no salirse. */}
        <span className={`sr-manija ini ${pct(d) < 7 ? 'borde' : ''}`} style={{ left: `${pct(d)}%` }} onPointerDown={e => empezar(e, 'd')} title="Inicio del rango">
          <b>{horaLog(d)}</b>
        </span>
        <span className={`sr-manija fin ${pct(h) > 93 ? 'borde' : ''}`} style={{ left: `${pct(h)}%` }} onPointerDown={e => empezar(e, 'h')} title="Fin del rango">
          <b>{horaLog(h)}</b>
        </span>
      </div>
    </div>
  )
}

// ── panel ────────────────────────────────────────────────────────────────────

function PanelLog({ rep, t, ir, abrirHallazgo, jugando, setJugando, mult, setMult, onCerrar }) {
  const { info } = rep
  const [abierto, setAbierto] = useState(0)
  const anterior = rep.hitos.filter(h => h.t < t - 500).at(-1)
  const siguiente = rep.hitos.find(h => h.t > t + 500)
  return (
    <aside className="panel">
      <div className="cabecera">
        <h1>DriverLogin <span>log real</span></h1>
        <p className="archivo" title={rep.archivo}>{rep.archivo}</p>
        <div className="chips-info">
          {info.padron != null && <span className="chip">padrón {info.padron}</span>}
          {info.unidad != null && <span className="chip">unidad {info.unidad}</span>}
          {info.placa && <span className="chip">{info.placa}</span>}
          {info.versiones.map(v => <span key={v} className="chip">v{v}</span>)}
          {info.modelo && <span className="chip">{info.modelo}</span>}
        </div>
        <p>{fechaLog(rep.log.desde)} · {horaLog(rep.log.desde)} → {horaLog(rep.log.hasta)} · {rep.entradas.length.toLocaleString()} líneas</p>
        {(rep.desde !== rep.log.desde || rep.hasta !== rep.log.hasta) && <p>Viendo {horaLog(rep.desde)} → {horaLog(rep.hasta)} ({duracion(rep.hasta - rep.desde)})</p>}
      </div>

      <div className="controles">
        <div className="fila">
          <button className="primario grande" onClick={() => setJugando(!jugando)}>{jugando ? '❚❚ Pausa' : '▶ Play'}</button>
          <button onClick={onCerrar} title="Volver al simulador">✕ Cerrar log</button>
        </div>
        <div className="seg">
          {VELOCIDADES.map(v => <button key={v} className={mult === v ? 'on' : ''} onClick={() => setMult(v)}>x{v}</button>)}
        </div>
        <div className="fila">
          <button disabled={!anterior} onClick={() => ir(anterior.t)} title={anterior?.texto}>◀ evento</button>
          <span className="hora-grande">{horaLog(t)}</span>
          <button disabled={!siguiente} onClick={() => ir(siguiente.t)} title={siguiente?.texto}>evento ▶</button>
        </div>
      </div>

      <Seccion titulo={`Hallazgos (${rep.hallazgos.length})`}>
        {rep.hallazgos.length === 0 && <p className="nota">No se encontró nada raro en el flujo de sesión.</p>}
        <ol className="hallazgos">
          {rep.hallazgos.map((h, k) => (
            <li key={k} className={`hallazgo ${h.nivel} ${abierto === k ? 'abierto' : ''}`}>
              <button onClick={() => { setAbierto(k); abrirHallazgo(h) }}>
                <span className="h-hora">{horaLog(h.t)}</span>
                <span className="h-titulo">{h.titulo}</span>
                {h.vista === 'cuadre' && <span className="h-ir">Cuadre ▸</span>}
                {h.vista === 'inspector' && <span className="h-ir">Inspector ▸</span>}
              </button>
              {abierto === k && h.detalle.length > 0 && <ul>{h.detalle.map(d => <li key={d}>{d}</li>)}</ul>}
            </li>
          ))}
        </ol>
      </Seccion>

      <Seccion titulo="Cómo leerlo" abierta={false}>
        <p className="nota">Todo sale de las líneas del log: no corre la lógica del simulador, así sirve para cualquier versión.</p>
        <p className="nota"><b>Equipo</b>: la sesión que la app tiene en memoria (con la que vende y cierra en terminal). <b>Central</b>: la que la central tiene abierta según sus respuestas; rayada = sin confirmar, punteada = deducida.</p>
        <p className="nota">Arrastra otro log sobre la ventana para cambiarlo.</p>
      </Seccion>
    </aside>
  )
}

function Seccion({ titulo, children, abierta = true }) {
  return (
    <details className="seccion" open={abierta}>
      <summary>{titulo}</summary>
      <div className="seccion-cuerpo">{children}</div>
    </details>
  )
}

// ── estado ───────────────────────────────────────────────────────────────────

function Pill({ s, vacio }) {
  if (!s) return <span className="pill vacia"><i className="dot" style={{ background: 'var(--none)' }} />{vacio}</span>
  return <span className="pill"><i className="dot" style={{ background: colorLado(s.lado) }} />#{s.sesion} · lado {ladoTxt(s.lado)}</span>
}

function EstadoLog({ rep, st }) {
  const { equipo, central, conexion, viaje, esperandoLogout: esp } = st
  const conSesion = equipo ? st.boletos.filter(b => b.sesion === equipo.sesion) : []
  const ignoradas = rep.mensajes.filter(m => m.dir === 'rx' && m.procesada === false && m.t <= st.t)
  const alertas = []
  if (equipo && viaje && equipo.lado != null && equipo.lado !== viaje.lado && viaje.estado === 'R')
    alertas.push(`El bus va por el lado ${ladoTxt(viaje.lado)} (trip ${viaje.trip}) y el equipo vende con la sesión #${equipo.sesion} de lado ${ladoTxt(equipo.lado)}.`)
  if (equipo && central && equipo.sesion !== central.sesion)
    alertas.push(`El equipo usa la #${equipo.sesion} y la central ${central.estado === 'confirmada' ? 'tiene' : 'tendría'} la #${central.sesion}.`)
  if (st.gps?.estado === 'mudo')
    alertas.push(`GPS mudo desde las ${horaLog(st.gps.desde)} (${duracion(st.t - st.gps.desde)}): la app sigue usando esa posición para el lado y el paradero.`)
  const apagado = rep.apagados.find(a => a.t <= st.t && st.t < a.vuelve)
  if (apagado) alertas.push(`${apagado.titulo}. Apagado ${horaLog(apagado.t)} → vuelve ${horaLog(apagado.vuelve)} (${duracion(apagado.fuera)}).`)
  if (esp) alertas.push(`Esperando la respuesta de driver_logout #${esp.sesion} (${duracion(st.t - esp.t)})…${esp.sinRespuesta ? ' no va a llegar.' : ''}`)

  return (
    <>
      <div className="estado">
        <div className="card">
          <h3>Equipo (APK) {esp && <em>cerrando…</em>}</h3>
          <Pill s={equipo} vacio="Sin sesión" />
          <div className="dato">
            {equipo ? <>Desde {horaLog(equipo.desde)} · {FUENTE[equipo.fuente] ?? equipo.fuente}</> : 'Sin sesión en memoria'}
          </div>
          <div className="dato">Boletos con esta sesión: <b>{conSesion.length}</b>{conSesion.length > 0 && <> · S/ {(conSesion.reduce((a, b) => a + b.precio, 0) / 100).toFixed(2)}</>}</div>
          <div className="dato">
            Socket: {conexion ? <b className="ok">SID {conexion.sid}</b> : <b className="mal">sin conexión</b>}
            {conexion && <span className="sutil"> desde {horaLog(conexion.desde)}{conexion.causa && ` · se cierra ${horaLog(conexion.hasta)} (${conexion.causa})`}</span>}
          </div>
          {st.estado && <div className="dato">Batería <b>{st.estado.data.battery}%</b>{st.estado.data.charging ? ' ⚡' : ''} · señal {st.estado.data.cell_signal} · {st.estado.data.view}</div>}
        </div>
        <div className="card">
          <h3>Central</h3>
          <Pill s={central} vacio="Sin datos" />
          <div className="dato">{central ? TXT_CENTRAL[central.estado] : 'El log no dice qué tenía abierto.'}</div>
          {central?.cerro != null && <div className="dato">Implica que cerró la <b>#{central.cerro}</b> hacia las {horaLog(central.desde)}</div>}
          {ignoradas.length > 0 && <div className="dato">Órdenes ignoradas hasta ahora: <b className="mal">{ignoradas.length}</b></div>}
        </div>
        <div className="card">
          <h3>Bus <span className="hora">{horaLog(st.t)}</span></h3>
          <span className="pill"><i className="dot" style={{ background: colorLado(st.bus.lado) }} />Lado {ladoTxt(st.bus.lado)}{viaje ? ` · trip ${viaje.trip}` : ''}</span>
          <div className="dato">Viaje: <b>{viaje ? ESTADO_VIAJE[viaje.estado] ?? viaje.estado : '—'}</b></div>
          <div className="dato">Paradero: <b>{st.paradero?.nombre ?? '—'}</b>{st.paradero && <span className="sutil"> ({horaLog(st.paradero.t)})</span>}</div>
          <div className="dato">Geocerca: <b>{st.marca?.nombre ?? '—'}</b>{st.marca && <span className="sutil"> ({horaLog(st.marca.t)})</span>}</div>
          <div className="dato">
            GPS: {st.ultimoFix ? <><b className={st.gps?.estado === 'mudo' ? 'mal' : 'ok'}>último fix hace {duracion(st.t - st.ultimoFix.t)}</b><span className="sutil"> ({horaLog(st.ultimoFix.t)})</span></> : <b className="mal">sin fix</b>}
          </div>
        </div>
      </div>
      {alertas.map(a => <div key={a} className="alerta">⚠ {a}</div>)}
    </>
  )
}

const FUENTE = {
  driver_login: 'llegó por driver_login',
  memoria: 'vista en memoria ("Primera sesión obtenida")',
  boletos: 'deducida por los boletos',
  previa: 'ya estaba al empezar el log',
  restaurada: 'restaurada de la BD',
}

// ── circuito con la ruta real ─────────────────────────────────────────────────

const XL = 110
const XR = 890
const YA = 150
const YB = 346
const FILA = 22 // separación entre filas de letreros cuando los paraderos están muy juntos
const R = (YB - YA) / 2
const YC = (YA + YB) / 2
const xDe = (lado, f) => (lado ? XR - f * (XR - XL) : XL + f * (XR - XL))

/** Reparte en filas lo que no cabe lado a lado: devuelve la fila de cada item (0 = la más cercana a la calle). */
function acomodar(items, max) {
  const fin = []
  return items.map(({ x, ancho }) => {
    let fila = fin.findIndex(f => f + 3 < x - ancho / 2)
    if (fila < 0) fila = fin.length < max ? fin.length : max - 1
    fin[fila] = x + ancho / 2
    return fila
  })
}

/** Posición de letreros y nombres de un lado sin que se pisen. */
function disponer(paraderos, lado, actualId) {
  const ps = paraderos.map(p => ({ p, x: xDe(lado, p.f), ancho: p.terminal ? 26 : 20 })).sort((a, b) => a.x - b.x)
  const filas = acomodar(ps, 3)
  const nFilas = Math.max(1, ...filas.map(f => f + 1))
  const conNombre = ps.filter(o => o.p.orden === 1 || o.p.terminal || o.p.id === actualId).map(o => ({ ...o, ancho: o.p.nombre.length * 5.6 + 8 }))
  const filasNombre = acomodar(conNombre, 3)
  const nombre = new Map(conNombre.map((o, k) => [o.p.id, filasNombre[k]]))
  return ps.map((o, k) => ({ ...o, fila: filas[k], nombreFila: nombre.get(o.p.id), nFilas }))
}

/** Tramos seguidos del mismo lado (una "pasada" por lado). */
function pasadas(viaje) {
  const out = []
  for (const v of viaje) {
    const ult = out.at(-1)
    if (ult && ult.lado === v.lado && v.desde - ult.hasta < 60_000) ult.hasta = v.hasta
    else out.push({ lado: v.lado, desde: v.desde, hasta: v.hasta })
  }
  return out
}

function CircuitoLog({ rep, st }) {
  const vueltas = useMemo(() => pasadas(rep.viaje), [rep])
  const marcasSesion = useMemo(
    () =>
      rep.hitos
        .filter(h => ['login', 'logout', 'sin-respuesta', 'logout-tx', 'ignorada', 'terminal'].includes(h.tipo))
        .map(h => ({ ...h, pos: estadoEn(rep, h.t).bus })),
    [rep],
  )
  const { bus, equipo } = st
  const bx = xDe(bus.lado, bus.f)
  const by = bus.lado ? YB : YA
  const colorBus = colorLado(equipo?.lado)

  return (
    <div className="circuito">
      <svg className="mapa" viewBox="0 0 1000 500">
        <text className="titulo-lado" x={14} y={22} fill="var(--a)">LADO A · ida →</text>
        <text className="titulo-lado" x={986} y={492} fill="var(--b)" textAnchor="end">← vuelta · LADO B</text>
        <text className="ruta-nombre" x={(XL + XR) / 2} y={YC + 5} textAnchor="middle">
          Ruta {rep.info.ruta ?? '?'} · {Math.round((rep.cat.lados[false].largo + rep.cat.lados[true].largo) / 1000)} km
        </text>
        <path className="calle" d={`M ${XL} ${YA} L ${XR} ${YA} A ${R} ${R} 0 0 1 ${XR} ${YB} L ${XL} ${YB} A ${R} ${R} 0 0 1 ${XL} ${YA} Z`} />
        <path className="calle-centro" d={`M ${XL} ${YA} L ${XR} ${YA} A ${R} ${R} 0 0 1 ${XR} ${YB} L ${XL} ${YB} A ${R} ${R} 0 0 1 ${XL} ${YA} Z`} />

        {[false, true].map(lado => {
          const y = lado ? YB : YA
          const afuera = lado ? 1 : -1
          const yS = y - afuera * 34
          const pas = vueltas.filter(v => v.lado === lado && v.desde <= st.t).at(-1)
          const fin = pas ? Math.min(pas.hasta, st.t) : null
          const muestras = pas ? rep.posiciones.filter(p => p.lado === lado && p.t >= pas.desde && p.t <= fin) : []
          const marcas = pas ? marcasSesion.filter(m => m.t >= pas.desde && m.t <= fin && m.pos.lado === lado) : []
          return (
            <g key={String(lado)}>
              <line className="pista-base" x1={XL} x2={XR} y1={yS} y2={yS} />
              {muestras.slice(1).map((p, k) => {
                const a = muestras[k]
                const ses = tramoEn(rep.equipo, a.t)
                if (!ses) return null
                const x0 = xDe(lado, a.f)
                const x1 = xDe(lado, p.f)
                return <rect key={k} x={Math.min(x0, x1)} width={Math.max(1.5, Math.abs(x1 - x0))} y={yS - 5} height={10} rx={2} fill={colorLado(ses.lado)} opacity={0.9} />
              })}
              {agrupar(marcas, lado).map((g, k) => {
                const derecha = g.cx > XR - 160
                const y0 = yS - afuera * (20 + g.desplazo * 13) + (lado ? 0 : 4)
                const yLinea = k => y0 - afuera * k * 13
                return (
                  <g key={k} className={`marca ${CLASE_MARCA[g.tipo]}`}>
                    <line x1={g.cx} x2={g.cx} y1={yS} y2={y0 + (lado ? 4 : -9)} />
                    <circle cx={g.cx} cy={yS} r={4} />
                    {g.lineas.map((m, j) => (
                      <text key={j} className={`marca-txt ${CLASE_MARCA[m.tipo] ?? ''}`} x={g.cx + (derecha ? -4 : 4)} y={yLinea(j)} textAnchor={derecha ? 'end' : 'start'}>
                        {m.resto ? `+${m.resto} más` : `${horaLog(m.t).slice(0, 5)} ${m.texto}`}
                      </text>
                    ))}
                  </g>
                )
              })}
              {disponer(rep.cat.lados[lado].paraderos, lado, st.paradero?.id).sort((a, b) => b.fila - a.fila).map(o => (
                <ParadaLog key={o.p.id} {...o} y={y} afuera={afuera} actual={st.paradero?.id === o.p.id} />
              ))}
            </g>
          )
        })}

        <g className="bus" transform={`translate(${bx} ${by}) rotate(${bus.lado ? 180 : 0})`}>
          <rect x={-22} y={-11} width={44} height={22} rx={6} fill={colorBus} className="carroceria" />
          <rect x={12} y={-8} width={7} height={16} rx={2} className="ventana" />
          <rect x={-16} y={-8} width={24} height={4} rx={1.5} className="ventana" />
          <rect x={-16} y={4} width={24} height={4} rx={1.5} className="ventana" />
        </g>
        <text className="bus-tag" x={bx} y={bus.lado ? by - 20 : by + 25} fill={colorBus}>
          {equipo ? `sesión #${equipo.sesion} ${ladoTxt(equipo.lado)}` : 'sin sesión'}{st.esperandoLogout ? ' · cerrando…' : ''}{st.gps?.estado === 'mudo' ? ' · GPS mudo' : ''}
        </text>
      </svg>
      <div className="leyenda">
        <span><i className="l-parada" /> paradero del log (número = orden)</span>
        <span><i className="l-term">T</i> terminal</span>
        <span><i className="l-liq">$</i> liquidar</span>
        <span><i className="l-ses" style={{ background: 'var(--a)' }} /><i className="l-ses" style={{ background: 'var(--b)' }} /> sesión del equipo en la última pasada por ese lado</span>
        <span>posición: reports, device_status y paraderos cercanos</span>
      </div>
    </div>
  )
}

const GRAVEDAD = ['sin-respuesta', 'ignorada', 'logout', 'logout-tx', 'terminal', 'login']

/** Junta las marcas que caen en el mismo punto y apila los bloques de texto que se pisarían. */
function agrupar(marcas, lado) {
  const grupos = []
  for (const m of [...marcas].sort((a, b) => a.t - b.t)) {
    const cx = xDe(lado, m.pos.f)
    const g = grupos.find(x => Math.abs(x.cx - cx) < 14)
    if (g) g.items.push(m)
    else grupos.push({ cx, items: [m] })
  }
  const ocupado = []
  return grupos
    .sort((a, b) => a.cx - b.cx)
    .map(g => {
      const lineas = g.items.length > 4 ? [...g.items.slice(-3), { resto: g.items.length - 3 }] : g.items
      const ancho = Math.max(...lineas.map(m => (m.texto?.length ?? 6) * 5.8 + 40))
      const derecha = g.cx > XR - 160
      const [a, b] = derecha ? [g.cx - ancho, g.cx] : [g.cx, g.cx + ancho]
      const desplazo = ocupado.filter(o => o.a < b && a < o.b).reduce((d, o) => Math.max(d, o.desplazo + o.n), 0)
      ocupado.push({ a, b, desplazo, n: lineas.length })
      const tipo = GRAVEDAD.find(t => g.items.some(m => m.tipo === t)) ?? g.items[0].tipo
      return { cx: g.cx, lineas, desplazo, tipo }
    })
}

const CLASE_MARCA = { login: 'login', logout: 'logout', 'sin-respuesta': 'error', 'logout-tx': 'logout', ignorada: 'descartada', terminal: 'apagado' }

function ParadaLog({ p, x: cx, fila, nombreFila, nFilas, y, afuera, actual }) {
  const esT = p.terminal
  const cy = y + afuera * (32 + fila * FILA)
  const w = esT ? 26 : 20
  const h = 20
  const color = p.lado ? 'var(--b)' : 'var(--a)'
  return (
    <g className={`parada ${esT ? 'terminal' : ''}`}>
      <title>{`${p.nombre} · lado ${ladoTxt(p.lado)} · orden ${p.orden} · radio ${Math.round(p.radio)} m${p.terminal ? ' · terminal' : ''}${p.liquidar ? ' · liquidar' : ''}`}</title>
      <line className="poste" x1={cx} x2={cx} y1={y} y2={cy - afuera * (h / 2)} />
      <circle className="pie" cx={cx} cy={y} r={3} fill={color} />
      {actual && <rect className="anillo" x={cx - w / 2 - 5} y={cy - h / 2 - 5} width={w + 10} height={h + 10} rx={9} stroke="var(--ink)" />}
      <rect className="letrero" x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={5} style={{ '--c': color }} />
      <text className="letrero-num" x={cx} y={cy + 4}>{esT ? 'T' : p.orden}</text>
      {p.liquidar && (
        <g className="liq">
          <circle cx={cx + w / 2} cy={cy - h / 2} r={6.5} />
          <text x={cx + w / 2} y={cy - h / 2 + 3.2}>$</text>
        </g>
      )}
      {nombreFila != null && (
        <text className={`cap ${actual ? 'actual' : ''}`} x={cx} y={y + afuera * (32 + (nFilas - 1) * FILA + 22 + nombreFila * 12) + (afuera > 0 ? 4 : 0)}>{p.nombre}</text>
      )}
    </g>
  )
}

// ── barra de tiempo (todo el log) ──────────────────────────────────────────────

function BarraTiempo({ rep, t, ir }) {
  const span = rep.hasta - rep.desde
  const pct = x => ((x - rep.desde) / span) * 100
  return (
    <div className="tiempo">
      <div className="tiempo-botones">
        <button onClick={() => ir(rep.desde)} title="Al principio">⏮</button>
        <button onClick={() => ir(rep.hasta)} title="Al final">⏭</button>
      </div>
      <div className="tiempo-barra">
        <div className="hitos">
          {rep.hitos.map((h, k) => <button key={k} className={`hito ${h.tipo}`} style={{ left: `${pct(h.t)}%` }} title={`${horaLog(h.t)} · ${h.texto}`} onClick={() => ir(h.t)} />)}
        </div>
        <input type="range" min={rep.desde} max={rep.hasta} step={1000} value={t} onChange={e => ir(Number(e.target.value))} />
      </div>
      <span className="tiempo-hora">{horaLog(t)}</span>
    </div>
  )
}

// ── carriles ─────────────────────────────────────────────────────────────────

const W = 1000
const X0 = 104
const X1 = W - 8
const AX = 22
const LH = 24
const GAP = 7
const CARRILES = ['Viaje', 'Conexión', 'Equipo', 'Central', 'Mensajes', 'Boletos', 'GPS']
const yDe = k => AX + k * (LH + GAP)
const ALTO = yDe(CARRILES.length) + 4

function pasoEje(span) {
  for (const m of [1, 2, 5, 10, 15, 30, 60, 120, 180]) if (span / (m * 60_000) <= 12) return m * 60_000
  return 360 * 60_000
}

function Carriles({ rep, t, ir, zoom, setZoom }) {
  const svg = useRef(null)
  const fijo = useRef(null)
  const ancho = ZOOMS.find(z => z[0] === zoom)[1]
  let v0 = rep.desde
  let v1 = rep.hasta
  if (ancho && ancho < rep.hasta - rep.desde) {
    v0 = Math.max(rep.desde, Math.min(rep.hasta - ancho, t - ancho / 2))
    v1 = v0 + ancho
  }
  if (fijo.current) [v0, v1] = fijo.current
  const x = tt => X0 + ((tt - v0) / (v1 - v0)) * (X1 - X0)
  const dentro = s => s.hasta > v0 && s.desde < v1
  const rect = (s, k, y, props) => {
    const a = x(Math.max(s.desde, v0))
    const b = x(Math.min(s.hasta, v1))
    return <rect key={k} x={a} y={y} width={Math.max(1, b - a)} height={LH} {...props} />
  }
  const etiqueta = (s, y, txt, color = '#fff') => {
    const a = x(Math.max(s.desde, v0))
    const b = x(Math.min(s.hasta, v1))
    return b - a > txt.length * 6.2 + 8 ? <text className="c-txt" x={a + 4} y={y + 16} fill={color}>{txt}</text> : null
  }

  const tDe = e => {
    const pt = svg.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse())
    const [a, b] = fijo.current ?? [v0, v1]
    return a + ((Math.max(X0, Math.min(X1, p.x)) - X0) / (X1 - X0)) * (b - a)
  }

  const paso = pasoEje(v1 - v0)
  const ticks = []
  for (let k = Math.ceil(v0 / paso) * paso; k <= v1; k += paso) ticks.push(k)
  const ladoSesion = new Map(rep.equipo.map(s => [s.sesion, s.lado]))
  const cruces = []
  for (const e of rep.equipo) for (const v of rep.viaje) {
    const a = Math.max(e.desde, v.desde)
    const b = Math.min(e.hasta, v.hasta)
    if (b > a && e.lado != null && e.lado !== v.lado && v.estado === 'R') cruces.push({ desde: a, hasta: b })
  }

  return (
    <div className="carriles">
      <div className="carriles-barra">
        <span>Línea de tiempo <span className="sutil">· clic o arrastra para moverte</span></span>
        <div className="seg chico">
          {ZOOMS.map(([z]) => <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>{z}</button>)}
        </div>
      </div>
      <svg
        ref={svg}
        className="carriles-svg"
        viewBox={`0 0 ${W} ${ALTO}`}
        onPointerDown={e => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {}
          fijo.current = [v0, v1]
          ir(tDe(e))
        }}
        onPointerMove={e => fijo.current && ir(tDe(e))}
        onPointerUp={() => (fijo.current = null)}
        onPointerCancel={() => (fijo.current = null)}
      >
        <defs>
          <pattern id="p-rayas" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#fff" strokeWidth="3" strokeOpacity="0.55" />
          </pattern>
          <pattern id="p-cruce" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--err)" strokeWidth="2.5" />
          </pattern>
        </defs>

        {ticks.map(k => (
          <g key={k} className="eje">
            <line x1={x(k)} x2={x(k)} y1={AX - 4} y2={ALTO} />
            <text x={x(k) + 3} y={AX - 8}>{horaLog(k).slice(0, 5)}</text>
          </g>
        ))}
        {CARRILES.map((c, k) => (
          <g key={c}>
            <rect className="carril-fondo" x={X0} y={yDe(k)} width={X1 - X0} height={LH} />
            <text className="carril-nombre" x={X0 - 8} y={yDe(k) + 16} textAnchor="end">{c}</text>
          </g>
        ))}

        {rep.viaje.filter(dentro).map((v, k) => (
          <g key={k}>
            <title>{`trip ${v.trip} · lado ${ladoTxt(v.lado)} · ${ESTADO_VIAJE[v.estado] ?? v.estado} · ${horaLog(v.desde)}–${horaLog(v.hasta)}`}</title>
            {rect(v, 'r', yDe(0), { fill: colorLado(v.lado), opacity: v.estado === 'R' ? 0.9 : 0.35, rx: 3 })}
            {etiqueta(v, yDe(0), `${ladoTxt(v.lado)} · ${v.trip}${v.estado !== 'R' ? ` ${v.estado}` : ''}`)}
          </g>
        ))}

        {rep.conexion.huecos.filter(dentro).map((h, k) => (
          <g key={`h${k}`}>
            <title>{`sin conexión ${horaLog(h.desde)}–${horaLog(h.hasta)} (${duracion(h.hasta - h.desde)})${h.intentos ? ` · ${h.intentos} intentos fallidos` : ''}`}</title>
            {rect(h, 'r', yDe(1), { className: 'c-hueco' })}
          </g>
        ))}
        {rep.conexion.segmentos.filter(dentro).map((s, k) => (
          <g key={k}>
            <title>{`SID ${s.sid} · ${horaLog(s.desde)}–${horaLog(s.hasta)} · ${s.rx} mensajes recibidos${s.causa ? ` · cierre: ${s.causa}` : ''}`}</title>
            {rect(s, 'r', yDe(1), { className: 'c-socket' })}
            {etiqueta(s, yDe(1), `SID ${s.sid}`, 'var(--ink)')}
            {s.causa && s.hasta < v1 && s.hasta > v0 && <path className={`c-corte ${s.causa === 'watchdog' ? 'wd' : ''}`} d={`M ${x(s.hasta)} ${yDe(1) - 1} l -4 -6 h 8 z`} />}
          </g>
        ))}
        {v1 - v0 <= 3 * 3_600_000 && rep.conexion.rx.filter(r => r >= v0 && r <= v1).map((r, k) => <line key={`rx${k}`} className="c-rx" x1={x(r)} x2={x(r)} y1={yDe(1) + LH - 5} y2={yDe(1) + LH} />)}

        {rep.equipo.filter(dentro).map((s, k) => (
          <g key={k}>
            <title>{`equipo: #${s.sesion} lado ${ladoTxt(s.lado)} · ${horaLog(s.desde)}–${horaLog(s.hasta)} · ${FUENTE[s.fuente] ?? s.fuente}`}</title>
            {rect(s, 'r', yDe(2), { fill: colorLado(s.lado), rx: 3 })}
            {etiqueta(s, yDe(2), `#${s.sesion} ${ladoTxt(s.lado)}`)}
          </g>
        ))}
        {cruces.filter(dentro).map((c, k) => (
          <g key={`x${k}`}>
            <title>{`sesión de un lado distinto al del viaje ${horaLog(c.desde)}–${horaLog(c.hasta)}`}</title>
            {rect(c, 'r', yDe(2) + LH - 6, { fill: 'url(#p-cruce)', height: 6 })}
          </g>
        ))}

        {rep.central.filter(dentro).map((s, k) => (
          <g key={k}>
            <title>{`central: #${s.sesion} · ${TXT_CENTRAL[s.estado]} · ${horaLog(s.desde)}–${horaLog(s.hasta)}`}</title>
            {rect(s, 'r', yDe(3), { fill: colorLado(s.lado), rx: 3, className: `c-central ${s.estado}` })}
            {s.estado !== 'confirmada' && rect(s, 'p', yDe(3), { fill: 'url(#p-rayas)', rx: 3 })}
            {etiqueta(s, yDe(3), `#${s.sesion} ${ladoTxt(s.lado)}${s.estado === 'confirmada' ? '' : ` · ${s.estado}`}`)}
          </g>
        ))}

        {rep.mensajes.filter(m => m.t >= v0 && m.t <= v1).map((m, k) => {
          const cx = x(m.t)
          const y = yDe(4)
          const mal = m.sinRespuesta || m.perdido || m.procesada === false
          const clase = `c-msg ${m.dir} ${mal ? 'mal' : ''} ${m.procesada === false ? 'ignorada' : ''}`
          return (
            <g key={k} className={clase} onPointerDown={e => { e.stopPropagation(); ir(m.t) }}>
              <title>{textoMensaje(m)}</title>
              {m.dir === 'tx' ? <path d={`M ${cx} ${y + 3} l 6 9 h -12 z`} /> : <path d={`M ${cx} ${y + LH - 3} l 6 -9 h -12 z`} />}
              {mal && <text x={cx} y={m.dir === 'tx' ? y + 22 : y + 9} textAnchor="middle">✕</text>}
            </g>
          )
        })}

        {rep.boletos.filter(b => b.t >= v0 && b.t <= v1).map((b, k) => {
          const c = tramoEn(rep.central, b.t)
          const cerrada = c && c.sesion !== b.sesion
          return (
            <line key={k} className={`c-boleto ${cerrada ? 'mal' : ''}`} x1={x(b.t)} x2={x(b.t)} y1={yDe(5) + 3} y2={yDe(5) + LH - 3} stroke={colorLado(ladoSesion.get(b.sesion))}>
              <title>{`boleto ${b.correlativo} · sesión #${b.sesion} · S/ ${(b.precio / 100).toFixed(2)} · ${horaLog(b.t)}${cerrada ? ` · la central ya no tenía la #${b.sesion}` : ''}`}</title>
            </line>
          )
        })}

        {rep.gps.sinDatos && <text className="c-txt" fill="var(--muted)" x={X0 + 6} y={yDe(6) + 16}>el log no tiene líneas del callback de ubicación ni reports</text>}
        {rep.gps.tramos.filter(dentro).map((s, k) => (
          <g key={`g${k}`}>
            <title>{`${s.estado === 'mudo' ? 'GPS mudo' : 'GPS dando posiciones'} · ${horaLog(s.desde)}–${horaLog(s.hasta)} (${duracion(s.hasta - s.desde)})${s.ultimoFix ? ` · último fix ${horaLog(s.ultimoFix.t)} (${s.ultimoFix.fuente})` : ''}`}</title>
            {rect(s, 'r', yDe(6), { className: `c-gps ${s.estado}`, rx: 3 })}
            {s.estado === 'mudo' && etiqueta(s, yDe(6), `sin GPS ${duracion(s.hasta - s.desde)}`, 'var(--err)')}
          </g>
        ))}
        {v1 - v0 <= 3 * 3_600_000 && rep.gps.fixes.filter(f => f.t >= v0 && f.t <= v1).map((f, k) => <line key={`f${k}`} className="c-fix" x1={x(f.t)} x2={x(f.t)} y1={yDe(6) + LH - 6} y2={yDe(6) + LH} />)}
        {rep.gps.rancios.filter(r => r.t >= v0 && r.t <= v1).map((r, k) => (
          <g key={`rl${k}`} className="c-rancio" onPointerDown={e => { e.stopPropagation(); ir(r.t) }}>
            <title>{`${horaLog(r.t)} lado ${ladoTxt(r.lado)} calculado con la posición de hace ${r.edad != null ? duracion(r.edad) : '?'} → driver_login lado ${ladoTxt(r.lado)}`}</title>
            <path d={`M ${x(r.t)} ${yDe(6) + 3} l 7 9 l -7 9 l -7 -9 z`} />
          </g>
        ))}

        {t >= v0 && t <= v1 && (
          <g className="cursor">
            <line x1={x(t)} x2={x(t)} y1={AX - 14} y2={ALTO} />
            <circle cx={x(t)} cy={AX - 14} r={3.5} />
          </g>
        )}
      </svg>
      <div className="leyenda">
        <span><i className="l-ses" style={{ background: 'var(--a)' }} /><i className="l-ses" style={{ background: 'var(--b)' }} /> lado A / B</span>
        <span><i className="l-socket" /> socket (SID) · <b className="wd-txt">▼</b> cierre por watchdog · <i className="l-hueco" /> sin conexión</span>
        <span><i className="l-rayada" /> central sin confirmar / deducida</span>
        <span><i className="l-cruce" /> sesión de otro lado que el viaje</span>
        <span>▲ enviado · ▼ recibido · <b className="mal">✕</b> sin respuesta / ignorado</span>
        <span><i className="l-boleto" /> boleto con sesión que la central ya no tenía</span>
        <span><i className="l-gps" /> GPS da posiciones · <i className="l-gps mudo" /> GPS mudo (+7 min sin fix) · <b className="mal">◆</b> login con posición vieja</span>
      </div>
    </div>
  )
}

function textoMensaje(m) {
  const h = horaLog(m.t)
  const d = m.data
  if (m.header === 'driver_logout' && m.dir === 'tx') {
    const s = d.session ?? d.sesion
    if (m.perdido) return `${h} → driver_logout #${s}: no salió (sin socket)`
    if (m.respuesta) return `${h} → driver_logout #${s} por SID ${m.sid}: respondido en ${duracion(m.respuesta.t - m.t)} (${m.respuesta.data.title})`
    return `${h} → driver_logout #${s} por SID ${m.sid}: SIN RESPUESTA${m.corte ? ` · socket cerrado ${m.corte.causa} ${horaLog(m.corte.t)}` : ''}`
  }
  if (m.header === 'driver_logout') return `${h} ← driver_logout #${d.id}: ${d.title}`
  if (m.header === 'driver_login' && m.dir === 'tx') return `${h} → driver_login dni ${String(d.dni ?? '').slice(0, 3)}… lado ${ladoTxt(d.direction)}${m.sinRespuesta ? ' · SIN RESPUESTA' : ''}`
  if (m.header === 'driver_login') {
    const s = d.sessions?.[0]
    return `${h} ← driver_login ${d.error ? `rechazado: ${d.message}` : `#${s?.id} lado ${ladoTxt(s?.direction)} · ${d.message ?? d.title}`}${m.espontanea ? ' (sin pedirlo)' : ''}`
  }
  if (m.header === 'operation' || m.header === 'android_command')
    return `${h} ← ${m.header} ${d.key}=${d.value}${d.id ? ` id ${d.id}` : ''} · ${m.procesada ? m.resultado ?? 'procesada' : 'IGNORADA por la app'}`
  return `${h} ${m.dir === 'tx' ? '→' : '←'} ${m.header}`
}

// ── secuencia de mensajes de sesión ──────────────────────────────────────────

function Secuencia({ rep, t, ir }) {
  const items = useMemo(() => {
    const out = rep.mensajes.map(m => ({ t: m.t, i: m.i, tipo: 'msg', m }))
    const cerca = tt => rep.mensajes.some(m => Math.abs(m.t - tt) <= 120_000)
    for (const s of rep.conexion.segmentos) {
      if (cerca(s.desde)) out.push({ t: s.desde, i: s.iIni, tipo: 'conecta', texto: `conecta SID ${s.sid}` })
      if (s.causa && cerca(s.hasta)) out.push({ t: s.hasta, i: s.iFin, tipo: 'corte', texto: `se cierra SID ${s.sid} (${s.causa})` })
    }
    for (const m of rep.mensajes) if (m.sinRespuesta && m.header === 'driver_logout' && !m.corte) out.push({ t: m.t + 60_000, i: m.i + 0.5, tipo: 'timeout', texto: `60 s sin respuesta a driver_logout #${m.sesion}: la app deja de esperar` })
    return out.sort((a, b) => a.t - b.t || a.i - b.i)
  }, [rep])
  const k = items.findLastIndex(x => x.t <= t)
  const visibles = items.slice(Math.max(0, k - 11), k + 5)
  return (
    <div className="secuencia">
      <div className="sec-cabeza"><span>Equipo</span><span>mensajes de sesión</span><span>Central</span></div>
      {items.length === 0 && <p className="nota">No hay mensajes de sesión en este log.</p>}
      {visibles.map(x => {
        const futuro = x.t > t
        if (x.tipo !== 'msg') return <div key={`${x.tipo}${x.i}`} className={`sec-fila sep ${x.tipo} ${futuro ? 'futuro' : ''}`} onClick={() => ir(x.t)}><span className="h">{horaLog(x.t)}</span><span className="sep-txt">{x.texto}</span></div>
        const m = x.m
        const mal = m.sinRespuesta || m.perdido || m.procesada === false
        return (
          <div key={m.i} className={`sec-fila ${m.dir} ${mal ? 'mal' : ''} ${futuro ? 'futuro' : ''}`} onClick={() => ir(m.t)}>
            <span className="h">{horaLog(m.t)}</span>
            <span className="flecha">
              <span className="linea" />
              <span className="etq">{m.header}{m.sid ? <small> SID {m.sid}</small> : null}</span>
            </span>
            <span className="res">{resumen(m)}</span>
          </div>
        )
      })}
    </div>
  )
}

function resumen(m) {
  const d = m.data
  if (m.header === 'driver_logout' && m.dir === 'tx') return m.perdido ? `#${d.session} no salió` : m.respuesta ? `#${m.sesion} ✓ ${duracion(m.respuesta.t - m.t)}` : `#${m.sesion} ✕ sin respuesta`
  if (m.header === 'driver_logout') return `${d.title} #${d.id}`
  if (m.header === 'driver_login' && m.dir === 'tx') return `lado ${ladoTxt(d.direction)}${m.sinRespuesta ? ' ✕' : ''}`
  if (m.header === 'driver_login') return d.error ? `rechazado` : `#${d.sessions?.[0]?.id} ${ladoTxt(d.sessions?.[0]?.direction)}${m.espontanea ? ' (sola)' : ''}`
  if (m.header === 'operation' || m.header === 'android_command') return `${d.key}=${d.value} ${m.procesada ? '✓' : '✕ ignorada'}`
  return ''
}

// ── log real ─────────────────────────────────────────────────────────────────

const TAGS_SESION = /^(DRIVERAUTO|DriverSessionCoordinator|DriverLoginRepository|ParaderoManager|Arranque|GpsViewModel|LocationTrackingService)$/
const esDeSesion = e =>
  TAGS_SESION.test(e.tag) ||
  (/^Protector/.test(e.tag) && /cerrando sesión|Bateria critica|ENERGY|NIGHT/.test(e.msg)) ||
  (/SocketService/.test(e.tag) && !/\[(ENVIADO|RECIBIDO)\]/.test(e.msg)) ||
  /(driver_login|driver_logout|operation|android_command|uid_driver|tickets) \[DATA\]/.test(e.msg) ||
  (e.tag === 'SocketMessageDispatcher' && /operation|Login confirmado/.test(e.msg))

const ladoDeTexto = v => (v === 'true' ? 'B' : 'A')
/** Resume los volcados de data class largos (Paradero, SessionDriver) para leer el log de un vistazo. */
const compacto = msg =>
  msg
    .replace(
      /Paradero\(id=(\d+), lado=(true|false),.*?nombre=([^,]*), orden=(\d+),.*?liquidar=(true|false),.*?terminal=(true|false), audio=[^)]*\)/gs,
      (_, id, l, nombre, orden, liq, term) => `Paradero #${id} ${nombre} (lado ${ladoDeTexto(l)}, orden ${orden}${term === 'true' ? ', terminal' : ''}${liq === 'true' ? ', liquidar' : ''})`,
    )
    .replace(/SessionDriver\(id=(\d+),.*?direction=(true|false),.*?\)/gs, (_, id, d) => `SessionDriver #${id} lado ${ladoDeTexto(d)}`)
const recortar = m => (m.length > 400 ? `${m.slice(0, 400)}…` : m)

function claseLinea(e) {
  if (/Iniciando apagado|power event: F|type=SHUTDOWN|disparo: SHUTDOWN/.test(e.msg)) return 'apagado'
  if (/MyApp\.onCreate|power event: O/.test(e.msg)) return 'arranque'
  if (/ERROR/.test(e.tag) || /❌|sin respuesta|conexión perdida|no enviado/.test(e.msg)) return 'error'
  if (/\[ENVIADO\]/.test(e.msg)) return 'enviado'
  if (/\[RECIBIDO\]/.test(e.msg)) return 'recibido'
  if (/Watchdog|Limpiando|CONECTADO/.test(e.msg)) return 'auto'
  if (/DRIVERAUTO|DriverSession/.test(e.tag)) return 'ok'
  return 'info'
}

const esDeSocket = e => /SocketService|SocketMessageDispatcher|ERROR/.test(e.tag) || /Watchdog|CONECTADO|Conectando|onFailure|onClosed|No hay conexión/.test(e.msg)
/** Lo que explica qué le pasó al equipo: apagados, arranques, energía, cortes de red/socket, sesión y errores. */
const IMPORTANTE =
  /Iniciando apagado|Bateria critica|power event|type=SHUTDOWN|disparo: (SHUTDOWN|arranque|carga=)|MyApp\.onCreate|ENERGY|NIGHT|BUS ON|APAGANDO|Watchdog|onFailure|onClosed|TIMEOUT conexión|✅ CONECTADO|Red perdida|Red disponible|GPS mudo|GPS volvió|driver_login \[DATA\]|driver_logout|Sesión activada|Logout confirmado|Login rechazado|❌/
const esImportante = e => /^ERROR/.test(e.tag) || IMPORTANTE.test(e.msg)
const FILTROS = [
  ['todo', 'todas las líneas', () => true],
  ['importante', 'eventos importantes', esImportante],
  ['sesion', 'sesión y conexión', esDeSesion],
  ['socket', 'solo socket / red', esDeSocket],
]
const ALTO_LINEA = 19 // alto fijo de cada línea: permite listar el log entero (miles de líneas) dibujando solo las visibles

export const LogReal = memo(function LogReal({ rep, linea, ir, seguir, filtroInicial = 'sesion' }) {
  const [modo, setModo] = useState(filtroInicial)
  const [texto, setTexto] = useState('')
  const [sel, setSel] = useState(null)
  const [scroll, setScroll] = useState({ top: 0, alto: 400 })
  const caja = useRef(null)
  const propio = useRef(false)
  const q = useDeferredValue(texto.trim().toLowerCase())
  const lista = useMemo(() => {
    const f = FILTROS.find(x => x[0] === modo)[2]
    return rep.entradas.filter(e => f(e) && (q.length < 2 || `[${e.tag}] ${e.msg}`.toLowerCase().includes(q)))
  }, [rep, modo, q])
  const k = buscar(lista, linea, 'i')
  const tActual = rep.entradas[linea]?.t
  const resumir = modo === 'sesion'

  useEffect(() => {
    const box = caja.current
    if (!box) return
    const medir = () => setScroll({ top: box.scrollTop, alto: box.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    // Un clic en el propio log no lo mueve; si la hora cambió desde afuera (mapa, carriles, Play) centra esa línea.
    if (propio.current) {
      propio.current = false
      return
    }
    setSel(null)
    const box = caja.current
    if (!box || k < 0) return
    box.scrollTo({ top: k * ALTO_LINEA - (box.clientHeight - ALTO_LINEA) / 2, behavior: seguir ? 'auto' : 'smooth' })
  }, [linea, lista, seguir]) // eslint-disable-line react-hooks/exhaustive-deps

  const desde = Math.max(0, Math.floor(scroll.top / ALTO_LINEA) - 15)
  const hasta = Math.min(lista.length, Math.ceil((scroll.top + scroll.alto) / ALTO_LINEA) + 15)
  const elegida = rep.entradas[sel ?? linea]
  return (
    <div className="log-caja">
      <div className="log-barra">
        <span>Log real <span className="sutil">· {lista.length.toLocaleString()} de {rep.entradas.length.toLocaleString()} líneas · línea {elegida?.n} del archivo</span></span>
        <select value={modo} onChange={e => setModo(e.target.value)}>
          {FILTROS.map(([k, txt]) => <option key={k} value={k}>{txt}</option>)}
        </select>
      </div>
      <div className="log-filtro">
        <input value={texto} placeholder="filtrar: Watchdog, onFailure, driver_login, SID:12…" onChange={e => setTexto(e.target.value)} />
        {texto && <button onClick={() => setTexto('')} title="Limpiar">✕</button>}
        <button onClick={() => caja.current?.scrollTo({ top: k * ALTO_LINEA - (caja.current.clientHeight - ALTO_LINEA) / 2 })} title="Volver a la línea de la hora elegida">◎ hora actual</button>
      </div>
      <div className="log" ref={caja} onScroll={e => setScroll({ top: e.currentTarget.scrollTop, alto: e.currentTarget.clientHeight })}>
        {lista.length === 0 && <p className="nota">Ninguna línea coincide.</p>}
        <div style={{ height: lista.length * ALTO_LINEA, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: desde * ALTO_LINEA }}>
            {lista.slice(desde, hasta).map(e => (
              <div
                key={e.i}
                className={`l ${claseLinea(e)} ${e.i === lista[k]?.i ? 'actual' : ''} ${e.t === tActual ? 'mismo' : ''} ${e.i > linea ? 'futuro' : ''} ${e.i === sel ? 'sel' : ''}`}
                title={e.msg.length > 160 ? 'clic para ver la línea completa abajo' : undefined}
                onClick={() => {
                  propio.current = true
                  setSel(e.i)
                  ir(e.t)
                }}
              >
                <span className="h">{horaLog(e.t)}</span>
                <span className="tag">{e.tag}</span>
                <span className="m">{recortar(resumir ? compacto(e.msg) : e.msg)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {elegida && (
        <div className="log-detalle">
          <div className="sutil">{fechaLog(elegida.t)} {horaLog(elegida.t)} · línea {elegida.n} · [{elegida.tag}]</div>
          <pre>{elegida.msg}</pre>
        </div>
      )}
    </div>
  )
})
