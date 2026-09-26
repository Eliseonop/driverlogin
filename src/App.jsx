import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { reconstruir } from './log/reconstruir.js'
import { ladoTxt } from './logica.js'
import ReproduccionLog from './ReproduccionLog.jsx'
import { CHOFERES, OPCIONES_GPS, OPCIONES_RETORNO, Simulador, VELOCIDADES, horaTxt } from './simulador.js'

const colorLado = lado => (lado == null ? 'var(--none)' : lado ? 'var(--b)' : 'var(--a)')

/** El simulador sigue vivo mientras se mira un log, pero su reloj se detiene (activo = false). */
function useSimulador(activo) {
  const ref = useRef(null)
  if (!ref.current) ref.current = new Simulador()
  const [, render] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (!activo) return
    let raf
    let prev = performance.now()
    const loop = now => {
      ref.current.tick(Math.min(100, now - prev))
      prev = now
      render()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [activo])
  const reiniciar = () => {
    const viejo = ref.current
    const nuevo = new Simulador(viejo.m.ruta)
    nuevo.mult = viejo.mult
    nuevo.m = { ...nuevo.m, geocercas: viejo.m.geocercas }
    ref.current = nuevo
  }
  return [ref.current, reiniciar]
}

/** Soltar un log en cualquier parte de la ventana (o elegirlo con el botón) lo abre en la reproducción. */
function useLogArrastrado() {
  const [rep, setRep] = useState(null)
  const [error, setError] = useState(null)
  const [encima, setEncima] = useState(false)
  const [cargando, setCargando] = useState(false)
  const abrir = async file => {
    if (!file) return
    setCargando(true)
    try {
      setRep(reconstruir(await file.text(), file.name))
      setError(null)
    } catch (e) {
      setError(`${file.name}: ${e.message}`)
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => {
    const hayArchivo = e => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const sobre = e => {
      if (!hayArchivo(e)) return
      e.preventDefault()
      setEncima(true)
    }
    const fuera = e => e.relatedTarget == null && setEncima(false)
    const soltar = e => {
      if (!hayArchivo(e)) return
      e.preventDefault()
      setEncima(false)
      abrir(e.dataTransfer.files[0])
    }
    window.addEventListener('dragover', sobre)
    window.addEventListener('dragleave', fuera)
    window.addEventListener('drop', soltar)
    return () => {
      window.removeEventListener('dragover', sobre)
      window.removeEventListener('dragleave', fuera)
      window.removeEventListener('drop', soltar)
    }
  }, [])
  return { rep, cerrar: () => setRep(null), abrir, error, cerrarError: () => setError(null), encima, cargando }
}

export default function App() {
  const log = useLogArrastrado()
  const [sim, reiniciar] = useSimulador(!log.rep)
  const [sel, setSel] = useState(null) // paradero seleccionado
  return (
    <>
      {log.rep ? (
        <ReproduccionLog key={log.rep.archivo + log.rep.desde} rep={log.rep} onCerrar={log.cerrar} />
      ) : (
        <div className="app">
          <Panel sim={sim} reiniciar={reiniciar} sel={sel} setSel={setSel} abrirLog={log.abrir} />
          <main className="main">
            <Estado sim={sim} />
            <Red sim={sim} />
            <Circuito sim={sim} sel={sel} setSel={setSel} />
            <Tiempo sim={sim} />
            <Log logs={sim.logsVisibles()} n={sim.logsVisibles().length} />
          </main>
        </div>
      )}
      {(log.encima || log.cargando) && <div className="soltar"><div>{log.cargando ? 'Leyendo el log…' : 'Suelta el log para reproducir lo que pasó'}</div></div>}
      {log.error && <div className="toast" onClick={log.cerrarError}>⚠ {log.error} <span className="sutil">(clic para cerrar)</span></div>}
    </>
  )
}

// ── panel lateral ────────────────────────────────────────────────────────────

function Seccion({ titulo, children, abierta = true }) {
  return (
    <details className="seccion" open={abierta}>
      <summary>{titulo}</summary>
      <div className="seccion-cuerpo">{children}</div>
    </details>
  )
}

function Panel({ sim, reiniciar, sel, setSel, abrirLog }) {
  const [chofer, setChofer] = useState(0)
  const [dni, setDni] = useState(CHOFERES[0].dni)
  const [clave, setClave] = useState(CHOFERES[0].clave)
  const r = sim.m.ruta
  const { disp, eq, central } = sim.d
  const numero = (campo, min, max) => e => {
    const v = Number(e.target.value)
    if (e.target.value !== '' && v >= min && v <= max) sim.setRuta({ [campo]: v })
  }
  const retorno = campo => (
    <select value={r[campo]} onChange={e => sim.setRuta({ [campo]: e.target.value })}>
      {OPCIONES_RETORNO.map(([v, txt]) => (
        <option key={v} value={v}>{txt}</option>
      ))}
    </select>
  )
  const elegirChofer = i => {
    setChofer(i)
    setDni(CHOFERES[i].dni)
    setClave(CHOFERES[i].clave)
  }
  const p = sel != null ? sim.m.paraderos.find(x => x.id === sel) : null
  const pantallaLogin = sim.puedeLoguear()

  return (
    <aside className="panel">
      <div className="cabecera">
        <h1>DriverLogin <span>simulador</span></h1>
        <p>La sesión del chofer en la ticketera, con la lógica del APK. <b>1.</b> Login · <b>2.</b> ▶ Play.</p>
      </div>

      <div className="controles">
        <div className="fila">
          <button className="primario grande" onClick={() => sim.setJugando(!sim.jugando)}>
            {sim.jugando ? '❚❚ Pausa' : '▶ Play'}
          </button>
          <button onClick={reiniciar}>⟲ Reiniciar</button>
        </div>
        <div className="seg">
          {VELOCIDADES.map(v => (
            <button key={v} className={sim.mult === v ? 'on' : ''} onClick={() => (sim.mult = v)}>x{v}</button>
          ))}
        </div>
        <label className="abrir-log">
          <input type="file" accept=".txt,.log,text/plain" onChange={e => { abrirLog(e.target.files[0]); e.target.value = '' }} />
          📄 Reproducir un log real… <span className="sutil">o arrástralo a la ventana</span>
        </label>
      </div>

      <Seccion titulo="Ruta" key={`ruta-${sim.vistas ?? 0}`}>
        <label>Nombre<input defaultValue={r.nombre} onChange={e => sim.setRuta({ nombre: e.target.value })} /></label>
        <div className="grid2">
          <label>Km por lado<input type="number" step="0.5" defaultValue={r.km} onChange={numero('km', 1, 30)} /></label>
          <label>Paraderos por lado<input type="number" defaultValue={r.paraderos} onChange={numero('paraderos', 3, 20)} /></label>
          <label>Radio paradero (m)<input type="number" step="5" defaultValue={r.radio} onChange={numero('radio', 10, 300)} /></label>
          <label>Radio terminal (m)<input type="number" step="10" defaultValue={r.radioTerminal} onChange={numero('radioTerminal', 20, 500)} /></label>
        </div>
        <div className="grid2">
          <label><code>retorno_auto_a</code>{retorno('retornoA')}</label>
          <label><code>retorno_auto_b</code>{retorno('retornoB')}</label>
        </div>
        <p className="nota">
          <code>retorno_auto_b</code> reabre B al cerrar A en su terminal; <code>retorno_auto_a</code> reabre A al cerrar B.
          Solo cuenta el booleano <code>true</code>.
        </p>
        <button onClick={() => sim.nuevasGeocercas()}>Otras 10 geocercas al azar</button>
      </Seccion>

      <Seccion titulo={p ? `Paradero · ${p.nombre}` : 'Paradero'}>
        {!p && <p className="nota">Haz clic en un paradero del circuito para editarlo.</p>}
        {p && (
          <>
            <p className="nota">Lado {ladoTxt(p.lado)} · orden {p.orden} · id {p.id}</p>
            <label>Radio (m)
              <input type="number" step="5" key={`${p.id}-${sim.vistas ?? 0}`} defaultValue={p.radio}
                onChange={e => e.target.value !== '' && sim.setParadero(p.id, { radio: Number(e.target.value) })} />
            </label>
            <div className="checks">
              <label className="check"><input type="checkbox" checked={p.terminal} onChange={e => sim.setParadero(p.id, { terminal: e.target.checked })} /> terminal</label>
              <label className="check"><input type="checkbox" checked={p.liquidar} onChange={e => sim.setParadero(p.id, { liquidar: e.target.checked })} /> liquidar</label>
              <label className="check"><input type="checkbox" checked={p.activo} onChange={e => sim.setParadero(p.id, { activo: e.target.checked })} /> activo</label>
            </div>
            <p className="nota">Cierra la sesión si el lado coincide y es <b>terminal</b> o <b>liquidar</b>. Un paradero inactivo no existe para el APK.</p>
            <button onClick={() => setSel(null)}>Listo</button>
          </>
        )}
      </Seccion>

      <Seccion titulo="Chofer">
        <div className="seg">
          {CHOFERES.map((c, i) => (
            <button key={c.dni} className={chofer === i ? 'on' : ''} onClick={() => elegirChofer(i)}>{c.nombre}</button>
          ))}
        </div>
        <div className="grid2">
          <label>DNI<input value={dni} onChange={e => setDni(e.target.value.trim())} /></label>
          <label>Clave<input value={clave} onChange={e => setClave(e.target.value.trim())} /></label>
        </div>
        <div className="botones">
          <button className="primario" disabled={!pantallaLogin} onClick={() => sim.loginTeclado(dni, clave)}>Login (teclado)</button>
          <button disabled={!pantallaLogin} onClick={() => sim.tarjeta(CHOFERES[chofer])}>Tarjeta NFC</button>
          <button disabled={!eq.sesion || !disp.encendido} onClick={() => sim.terminarVenta()}>Terminar venta</button>
        </div>
        {!pantallaLogin && disp.encendido && <p className="nota">Con sesión activa la ticketera no muestra la pantalla de login.</p>}
      </Seccion>

      <Seccion titulo="Equipo">
        <div className="fila">
          <button className={disp.encendido ? 'peligro' : 'primario'} onClick={() => sim.setEncendido(!disp.encendido)}>
            {disp.encendido ? 'Apagar equipo' : 'Encender equipo'}
          </button>
          <label className="check"><input type="checkbox" checked={disp.conectado} onChange={e => sim.setConectado(e.target.checked)} /> conexión</label>
        </div>
        <label>GPS
          <select value={disp.gps} onChange={e => sim.setGps(e.target.value)}>
            {OPCIONES_GPS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={disp.datosRuta} onChange={e => sim.setDatosRuta(e.target.checked)} /> datos de ruta cargados (paraderos + config)</label>
        <label>Batería: <b className="valor">{disp.bateria}%</b>
          <input type="range" min="0" max="100" value={disp.bateria} onChange={e => sim.setBateria(Number(e.target.value), disp.cargando)} />
        </label>
        <label className="check"><input type="checkbox" checked={disp.cargando} onChange={e => sim.setBateria(disp.bateria, e.target.checked)} /> cargando (bus encendido)</label>
        <p className="nota">Sin carga: ≤16% por 3 min cierra la sesión (ENERGY); ≤10% la cierra y apaga el equipo.</p>
        <div className="botones">
          <button onClick={() => sim.irAHora('02:29')}>Ir a las 02:29</button>
          <button onClick={() => sim.irAHora('05:00')}>Día siguiente 05:00</button>
        </div>
        <p className="nota">Entre 02:30 y 03:00 el equipo cierra la sesión (NIGHT). Al cambiar de día, la sesión que quedó abierta se cierra al restaurar.</p>
      </Seccion>

      <Seccion titulo="Central">
        <label className="check">
          <input type="checkbox" checked={central.autoB} onChange={e => sim.setAutoB(e.target.checked)} />
          <span>Crea sola la B al cerrar una A <small>(visto en los logs)</small></span>
        </label>
        <label>Canal de órdenes
          <select value={central.canal} onChange={e => sim.setCanal(e.target.value)}>
            <option value="operation">operation (eco + reenvío cada 5 min)</option>
            <option value="android_command">android_command (sin eco)</option>
          </select>
        </label>
        <div className="botones">
          <button onClick={() => sim.cerrarDesdeCentral()}>Cerrar sesión abierta</button>
          <button onClick={() => sim.centralOrden('login-conductor', `${dni} ${clave}`)}>login-conductor</button>
          <button onClick={() => sim.centralOrden('logout-conductor', '')}>logout-conductor</button>
          <button onClick={() => sim.nuevaSalida()}>Nueva salida (trip)</button>
        </div>
      </Seccion>
    </aside>
  )
}

// ── estado ───────────────────────────────────────────────────────────────────

function Sesion({ s, vacio }) {
  if (!s) return <span className="pill vacia"><i className="dot" style={{ background: 'var(--none)' }} />{vacio}</span>
  return (
    <span className="pill">
      <i className="dot" style={{ background: colorLado(s.direction) }} />#{s.id} · lado {ladoTxt(s.direction)}
    </span>
  )
}

function Estado({ sim }) {
  const { eq, bd, disp, veh, central, bus } = sim.d
  const abierta = sim.abiertaEnCentral()
  const geo = sim.geocercaActual()
  const enCamino = sim.d.enVuelo.length > 0 || eq.cerrando
  const pendientes = Object.entries(eq.intents.pendingAutoRetorno)
  const alertas = []
  if (abierta && abierta.id !== eq.sesion?.id && !enCamino)
    alertas.push(`La central tiene abierta la sesión #${abierta.id} (lado ${ladoTxt(abierta.direction)}) y el equipo ${!disp.encendido ? 'está apagado' : eq.sesion ? `usa la #${eq.sesion.id}` : 'no tiene sesión'}.`)
  if (eq.sesion && eq.sesion.direction !== bus.lado && bus.fase === 'ruta')
    alertas.push(`El bus va por el lado ${ladoTxt(bus.lado)} con una sesión del lado ${ladoTxt(eq.sesion.direction)}.`)
  if (eq.intents.blockIncomingLogin) alertas.push('Tras el logout forzado, el próximo driver_login que llegue se descarta (aunque sea el del chofer).')

  return (
    <>
      <div className="estado">
        <div className="card">
          <h3>Equipo (APK) {eq.cerrando && <em>cerrando…</em>}{!disp.encendido && <em>apagado</em>}</h3>
          <Sesion s={eq.sesion} vacio={disp.encendido ? 'Sin sesión' : 'Apagado'} />
          <div className="dato">Paradero actual: <b>{eq.paraderoActual?.nombre ?? '—'}</b></div>
          <div className="dato">
            Un login ahora iría al <b style={{ color: colorLado(eq.orden1?.lado ?? false) }}>lado {ladoTxt(eq.orden1?.lado ?? false)}</b>
            <span className="sutil"> ({eq.orden1 ? `orden 1 más cercano: ${eq.orden1.nombre}` : 'sin orden 1 → A'})</span>
          </div>
          <div className="dato">
            Memoria: credenciales <b>{eq.creds ? eq.creds[0] : 'no'}</b>
            {pendientes.length > 0 && <> · autoretorno pendiente <b>{pendientes.map(([id, v]) => `#${id}=${v}`).join(' ')}</b></>}
          </div>
          <div className="dato">Vehículo: <b>{veh ? `trip ${veh.trip} · ruta ${veh.route}` : 'sin login (protoLogin=null)'}</b></div>
          <div className="historial">
            <span className="sutil">Room:</span>
            {bd.room.length === 0 && <span className="sutil">vacío</span>}
            {bd.room.slice(-8).map(r => (
              <span key={r.id} className={`chip ${r.finalizado ? '' : 'abierta'}`} style={{ '--c': colorLado(r.direction) }} title={r.dni ? `creds ${r.dni}` : 'sin credenciales'}>
                #{r.id} {ladoTxt(r.direction)}{r.dni ? '' : ' ⚿'}
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Central <span className="sutil">trip {central.trip}</span></h3>
          <Sesion s={abierta} vacio="Ninguna abierta" />
          <div className="historial">
            {central.sesiones.slice(-10).map(s => (
              <span key={s.id} className={`chip ${s.abierta ? 'abierta' : ''}`} style={{ '--c': colorLado(s.direction) }}>
                #{s.id} {ladoTxt(s.direction)} {s.code}{s.auto ? ' auto' : ''}
              </span>
            ))}
            {central.sesiones.length === 0 && <span className="sutil">Todavía no hay sesiones.</span>}
          </div>
          {central.ops.length > 0 && <div className="dato">Órdenes sin eco: <b>{central.ops.map(o => `${o.key}=${o.value}`).join(', ')}</b></div>}
        </div>
        <div className="card">
          <h3>Bus <span className="hora">día {sim.dia + 1} · {horaTxt(sim.d.hora)}</span></h3>
          <span className="pill"><i className="dot" style={{ background: colorLado(bus.lado) }} />Va por el lado {ladoTxt(bus.lado)}</span>
          <div className="dato">
            <b>{(bus.s / 1000).toFixed(2)}</b> de {sim.m.ruta.km} km
            {bus.fase === 'terminal' && ' · detenido en el terminal'}{bus.fase === 'giro' && ' · dando la vuelta'}
          </div>
          <div className="dato">Geocerca: <b>{geo?.nombre ?? '—'}</b></div>
          <div className="dato">
            Conexión <b className={disp.conectado ? 'ok' : 'mal'}>{disp.conectado ? 'sí' : 'no'}</b> · GPS <b className={disp.gps === 'ok' ? 'ok' : 'mal'}>{disp.gps === 'ok' ? 'ok' : disp.gps === 'congelado' ? 'sin señal' : 'sin fix'}</b> · batería <b className={disp.bateria <= 16 && !disp.cargando ? 'mal' : ''}>{disp.bateria}%{disp.cargando ? ' ⚡' : ''}</b>
          </div>
        </div>
      </div>
      {alertas.map(a => <div key={a} className="alerta">⚠ {a}</div>)}
    </>
  )
}

function Red({ sim }) {
  return (
    <div className="red">
      <span>Equipo</span>
      <div className="cable">
        {sim.d.enVuelo.map(v => {
          const p = Math.min(1, (sim.d.hora - v.t0) / (v.t1 - v.t0))
          const sube = v.dir === 'sube'
          return (
            <span key={v.id} className={`paquete ${v.dir}`} style={{ left: `${6 + (sube ? p : 1 - p) * 88}%` }}>
              {sube ? `${v.tipo} →` : `← ${v.tipo}`}
            </span>
          )
        })}
      </div>
      <span>Central</span>
    </div>
  )
}

// ── el circuito ──────────────────────────────────────────────────────────────
// Arriba el lado A (ida, de izquierda a derecha); abajo el lado B (vuelta, de derecha a izquierda).
// Las curvas de los extremos son la vuelta del bus en cada terminal.

const XL = 150
const XR = 850
const YA = 128
const YB = 332
const R = (YB - YA) / 2
const YC = (YA + YB) / 2

/** Reparte las etiquetas de las marcas en filas para que no se pisen. */
function enFilas(marcas, xDe) {
  const fin = []
  return [...marcas]
    .map(m => ({ ...m, cx: xDe(m.s) }))
    .sort((a, b) => a.cx - b.cx)
    .map(m => {
      const ancho = m.texto.length * 5.8 + 12
      let fila = fin.findIndex(f => f < m.cx)
      if (fila < 0) fila = fin.length < 3 ? fin.length : 2
      fin[fila] = m.cx + ancho
      return { ...m, fila }
    })
}

function Circuito({ sim, sel, setSel }) {
  const svg = useRef(null)
  const arrastre = useRef(null)
  const L = sim.largo
  const { eq, bus, disp } = sim.d
  const xDe = (lado, s) => (lado ? XR - (s / L) * (XR - XL) : XL + (s / L) * (XR - XL))
  const geo = sim.geocercaActual()

  const sDe = (lado, e) => {
    const pt = svg.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse())
    const f = Math.max(0, Math.min(1, (p.x - XL) / (XR - XL)))
    return (lado ? 1 - f : f) * L
  }
  const soltar = () => {
    arrastre.current = null
    sim.arrastrando = false
  }

  // posición y giro del bus
  let bx
  let by
  let rot = bus.lado ? 180 : 0
  if (bus.fase === 'giro') {
    const t = bus.giro
    const th = bus.lado ? Math.PI / 2 + t * Math.PI : -Math.PI / 2 + t * Math.PI
    const cx = bus.lado ? XL : XR
    bx = cx + R * Math.cos(th)
    by = YC + R * Math.sin(th)
    rot = (bus.lado ? 180 : 0) + t * 180
  } else {
    bx = xDe(bus.lado, Math.min(bus.s, L))
    by = bus.lado ? YB : YA
  }
  const colorBus = !disp.encendido ? 'var(--apagado)' : colorLado(eq.sesion?.direction)
  const etiquetaBus = !disp.encendido ? 'equipo apagado' : eq.sesion ? `sesión #${eq.sesion.id} ${ladoTxt(eq.sesion.direction)}` : 'sin sesión'

  return (
    <div className="circuito">
      <svg ref={svg} className="mapa" viewBox="0 0 1000 460">
        <text className="titulo-lado" x={XL} y={34} fill="var(--a)">LADO A · ida →</text>
        <text className="titulo-lado" x={XR} y={446} fill="var(--b)" textAnchor="end">← vuelta · LADO B</text>
        <text className="ruta-nombre" x={(XL + XR) / 2} y={YC + 5} textAnchor="middle">{sim.m.ruta.nombre}</text>

        {/* la calle */}
        <path className="calle" d={`M ${XL} ${YA} L ${XR} ${YA} A ${R} ${R} 0 0 1 ${XR} ${YB} L ${XL} ${YB} A ${R} ${R} 0 0 1 ${XL} ${YA} Z`} />
        <path className="calle-centro" d={`M ${XL} ${YA} L ${XR} ${YA} A ${R} ${R} 0 0 1 ${XR} ${YB} L ${XL} ${YB} A ${R} ${R} 0 0 1 ${XL} ${YA} Z`} />
        <text className="curva-txt" x={XR + R + 12} y={YC + 4}>giro</text>
        <text className="curva-txt" x={XL - R - 12} y={YC + 4} textAnchor="end">giro</text>

        {[false, true].map(lado => {
          const y = lado ? YB : YA
          const afuera = lado ? 1 : -1 // hacia fuera del circuito
          const yS = y - afuera * 34 // pista de sesión, hacia dentro
          const pars = sim.m.paraderos.filter(p => p.lado === lado)
          const x = s => xDe(lado, s)
          return (
            <g key={String(lado)}>
              <rect
                className="hit"
                x={XL - 10}
                y={Math.min(y, yS) - 22}
                width={XR - XL + 20}
                height={Math.abs(yS - y) + 44}
                onPointerDown={e => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId)
                  } catch {}
                  arrastre.current = lado
                  sim.arrastrando = true
                  sim.moverA(lado, sDe(lado, e))
                }}
                onPointerMove={e => arrastre.current === lado && sim.moverA(lado, sDe(lado, e))}
                onPointerUp={soltar}
                onPointerCancel={soltar}
              />

              {sim.m.geocercas.filter(g => g.lado === lado).map(g => {
                const a = x(g.f * L - g.radio)
                const b = x(g.f * L + g.radio)
                const y0 = lado ? y - 14 : y - 68
                return (
                  <g key={g.id} className={`geo ${geo?.id === g.id ? 'activa' : ''}`}>
                    <rect x={Math.min(a, b)} y={y0} width={Math.abs(b - a)} height={82} rx={10} />
                    <text x={Math.min(a, b) + 5} y={lado ? y + 81 : y - 73}>G{g.id}</text>
                  </g>
                )
              })}

              {pars.map(p => {
                const a = x(p.s - p.radio)
                const b = x(p.s + p.radio)
                return <rect key={p.id} className="radio" x={Math.min(a, b)} width={Math.abs(b - a)} y={y - 9} height={18} rx={9} fill={colorLado(lado)} opacity={!p.activo ? 0.05 : p.terminal || p.liquidar ? 0.26 : 0.14} />
              })}

              <line className="pista-base" x1={XL} x2={XR} y1={yS} y2={yS} />
              {sim.d.pistas[+lado].map((t, i) => {
                if (t.key == null) return null
                const a = x(t.a)
                const b = x(t.b)
                const w = Math.max(1, Math.abs(b - a))
                const x0 = Math.min(a, b)
                const off = t.key === 'off'
                return (
                  <g key={i} className="pista">
                    <rect x={x0} y={yS - 5} width={w} height={10} rx={3} fill={off ? 'url(#rayas)' : colorLado(t.lado)} />
                    {w > 46 && !off && <text x={x0 + 5} y={yS + 3.5}>#{t.key} {ladoTxt(t.lado)}</text>}
                  </g>
                )
              })}

              {enFilas(sim.d.marcas[+lado], s => x(s)).map((m, i) => {
                const ty = yS - afuera * (20 + m.fila * 13) + (lado ? 0 : 4)
                const derecha = m.cx > XR - 80
                return (
                  <g key={i} className={`marca ${m.tipo}`}>
                    <line x1={m.cx} x2={m.cx} y1={yS} y2={ty + (lado ? 4 : -9)} />
                    <circle cx={m.cx} cy={yS} r={4} />
                    <text x={m.cx + (derecha ? -4 : 4)} y={ty} textAnchor={derecha ? 'end' : 'start'}>{m.texto}</text>
                  </g>
                )
              })}

              {pars.map(p => (
                <Parada key={p.id} p={p} cx={x(p.s)} y={y} afuera={afuera} actual={eq.paraderoActual?.id === p.id}
                  colorActual={colorLado(eq.sesion?.direction)} sel={sel === p.id} onSel={() => setSel(p.id)} />
              ))}
            </g>
          )
        })}

        <defs>
          <pattern id="rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#cbd5e1" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#64748b" strokeWidth="3" />
          </pattern>
        </defs>

        <g className="bus" transform={`translate(${bx} ${by}) rotate(${rot})`}>
          <rect x={-22} y={-11} width={44} height={22} rx={6} fill={colorBus} className="carroceria" />
          <rect x={12} y={-8} width={7} height={16} rx={2} className="ventana" />
          <rect x={-16} y={-8} width={24} height={4} rx={1.5} className="ventana" />
          <rect x={-16} y={4} width={24} height={4} rx={1.5} className="ventana" />
        </g>
        <text className="bus-tag" x={bx} y={bus.lado ? by - 20 : by + 25} fill={colorBus}>
          {etiquetaBus}{eq.cerrando ? ' · cerrando…' : ''}
        </text>
      </svg>
      <div className="leyenda">
        <span><i className="l-parada" /> paradero (número = orden)</span>
        <span><i className="l-term">T</i> terminal</span>
        <span><i className="l-liq">$</i> liquidar</span>
        <span><i className="l-radio" /> radio</span>
        <span><i className="l-geo" /> geocerca (el login no la usa)</span>
        <span><i className="l-ses" style={{ background: 'var(--a)' }} /><i className="l-ses" style={{ background: 'var(--b)' }} /> sesión del equipo · <i className="l-ses rayada" /> equipo apagado</span>
        <span>clic en un paradero para editarlo · arrastra el bus para moverlo</span>
      </div>
    </div>
  )
}

/** Paradero: letrero sobre un poste, hacia fuera del circuito. */
function Parada({ p, cx, y, afuera, actual, colorActual, sel, onSel }) {
  const esT = p.terminal
  const cy = y + afuera * 34 // centro del letrero
  const w = esT ? 30 : 22
  const h = 22
  const clase = `parada ${esT ? 'terminal' : ''} ${p.activo ? '' : 'inactiva'} ${sel ? 'sel' : ''}`
  const color = p.lado ? 'var(--b)' : 'var(--a)'
  return (
    <g className={clase} onPointerDown={e => e.stopPropagation()} onClick={onSel}>
      <title>{`${p.nombre} · lado ${ladoTxt(p.lado)} · orden ${p.orden} · radio ${p.radio} m${p.terminal ? ' · terminal' : ''}${p.liquidar ? ' · liquidar' : ''}${p.activo ? '' : ' · inactivo'}`}</title>
      <line className="poste" x1={cx} x2={cx} y1={y} y2={cy - afuera * (h / 2)} />
      <circle className="pie" cx={cx} cy={y} r={3.5} fill={color} />
      {actual && <rect className="anillo" x={cx - w / 2 - 5} y={cy - h / 2 - 5} width={w + 10} height={h + 10} rx={9} stroke={colorActual} />}
      <rect className="letrero" x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={esT ? 5 : 6} style={{ '--c': color }} />
      <text className="letrero-num" x={cx} y={cy + 4}>{esT ? 'T' : p.orden}</text>
      {p.liquidar && (
        <g className="liq">
          <circle cx={cx + w / 2} cy={cy - h / 2} r={7} />
          <text x={cx + w / 2} y={cy - h / 2 + 3.5}>$</text>
        </g>
      )}
      {(p.orden === 1 || esT) && <text className="cap" x={cx} y={cy + afuera * 22 + (afuera > 0 ? 4 : 0)}>{p.orden === 1 ? 'inicio' : 'terminal'}</text>}
    </g>
  )
}

// ── línea de tiempo ──────────────────────────────────────────────────────────

function Tiempo({ sim }) {
  const n = sim.hist.length
  const i = sim.cursor ?? n - 1
  // posición de cada hito en la línea de tiempo (primera foto que ya lo tiene)
  const hitos = useMemo(() => {
    const out = []
    let k = 0
    sim.hist.forEach((f, idx) => {
      while (k < f.nHitos) {
        out.push({ idx, ...f.din.hitos[k] })
        k++
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, sim.hist[n - 1]])
  const ir = j => sim.irA(j)
  const anterior = hitos.filter(h => h.idx < i).at(-1)
  const siguiente = hitos.find(h => h.idx > i)
  const pct = j => (n > 1 ? (j / (n - 1)) * 100 : 0)

  return (
    <div className={`tiempo ${sim.enPasado ? 'pasado' : ''}`}>
      <div className="tiempo-botones">
        <button title="Al principio" onClick={() => ir(0)}>⏮</button>
        <button title="Evento anterior" disabled={!anterior} onClick={() => ir(anterior.idx)}>◀</button>
        <button title="Evento siguiente" disabled={!siguiente} onClick={() => ir(siguiente.idx)}>▶</button>
        <button title="Volver al presente" className={sim.enPasado ? 'primario' : ''} onClick={() => ir(n - 1)}>⏭ ahora</button>
      </div>
      <div className="tiempo-barra">
        <div className="hitos">
          {hitos.map((h, k) => (
            <button key={k} className={`hito ${h.tipo}`} style={{ left: `${pct(h.idx)}%` }} title={`${horaTxt(h.hora)} · ${h.texto}`} onClick={() => ir(h.idx)} />
          ))}
        </div>
        <input type="range" min="0" max={Math.max(0, n - 1)} value={i} onChange={e => ir(Number(e.target.value))} />
      </div>
      <span className="tiempo-hora">{horaTxt(sim.d.hora)}</span>
      {sim.enPasado && (
        <div className="tiempo-aviso">
          Estás viendo el pasado. Play o cualquier acción sigue desde aquí y borra lo que venía después.
        </div>
      )}
    </div>
  )
}

// ── log ──────────────────────────────────────────────────────────────────────

const RUIDO = new Set(['ParaderoManager', 'BUS', '·'])

const Log = memo(function Log({ logs, n }) {
  const ref = useRef(null)
  const [todo, setTodo] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [n, todo])
  const visibles = (todo ? logs : logs.filter(l => !RUIDO.has(l.tag))).slice(-600)
  return (
    <div className="log-caja">
      <div className="log-barra">
        <span>Log del equipo <span className="sutil">(mismas líneas que LogManager) · violeta: la central · gris: notas del simulador</span></span>
        <label className="check">
          <input type="checkbox" checked={!todo} onChange={e => setTodo(!e.target.checked)} /> solo sesión
        </label>
      </div>
      <div className="log" ref={ref}>
        {visibles.map(l => (
          <div key={l.n} className={`l ${l.tipo}`}>
            <span className="h">{l.hora}</span>
            <span className="tag">{l.tag}</span>
            <span className="m">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
})
