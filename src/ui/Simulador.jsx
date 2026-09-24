import { useMemo, useState } from 'react'
import MapView from './MapView.jsx'
import Timeline, { carrilesMundo } from './Timeline.jsx'
import LogView from './LogView.jsx'
import { configPorDefecto, CHOFERES_DEMO } from '../engine/world.js'
import { PERFILES } from '../engine/device.js'
import { REGLAS_SERVIDOR } from '../engine/server.js'
import { stamp, hora, parseStamp, fecha } from '../engine/time.js'
import { guionDesdeAcciones, guionComoTexto } from '../engine/guion.js'

const lado = l => (l == null ? '—' : l ? 'B' : 'A')
const Lado = ({ l }) => (l == null ? <span className="tenue">—</span> : <span className={`lado-${lado(l)}`}>{lado(l)}</span>)
const OPC_RETORNO = [
  [true, 'true (booleano)'],
  [false, 'false'],
  ['texto', '"true" (texto)'],
  ['ausente', 'no viene'],
]

export default function Simulador({ sim }) {
  const { w, ver } = sim
  const snap = useMemo(() => w.snapshot(), [w, ver])
  const d = snap.device
  const m = d.mem
  const paraderos = w.cfg.paraderos
  const [seguir, setSeguir] = useState(false)

  return (
    <div className="sim">
      <div className="izq">
        <Controles sim={sim} snap={snap} />
      </div>

      <div className="centro">
        <div className="estado-sim">
          <span className="reloj">
            {fecha(snap.now)} {hora(snap.now)}
          </span>
          <span className={`chip ${m.sessionDriver ? lado(m.sessionDriver.direction) : ''}`}>
            {m.sessionDriver ? `sesión ${m.sessionDriver.id} · lado ${lado(m.sessionDriver.direction)}` : 'sin sesión'}
          </span>
          <span className={`chip ${d.conectado ? 'ok' : 'mal'}`}>{d.encendido ? (d.conectado ? 'socket conectado' : 'sin socket') : 'equipo apagado'}</span>
          {d.busy > 0 && <span className="chip mal">dispatcher ocupado · cola: {d.inbox.join(', ') || '—'}</span>}
          {m.blockIncomingLogin && <span className="chip mal">blockIncomingLogin armado</span>}
          {m.loadingLogout && <span className="chip">esperando driver_logout…</span>}
          <span className="chip">{PERFILES[d.perfil].nombre}</span>
          {sim.conduciendo && <span className="chip">🚌 conduciendo {sim.conduciendo}</span>}
          <span style={{ flex: 1 }} />
          <label className="fila">
            <input type="checkbox" checked={seguir} onChange={e => setSeguir(e.target.checked)} /> seguir al bus
          </label>
        </div>
        {sim.error && <div className="riesgo">⚠ {sim.error}</div>}
        <MapView
          paraderos={paraderos}
          bus={snap.bus}
          sesionLado={m.sessionDriver?.direction ?? null}
          actualId={m.paraderoActual?.id}
          orden1Id={m.paraderoMasCercanoOrden1?.id}
          seguir={seguir}
          onMover={p => sim.accion('mover', p, 0)}
          onIrA={p => sim.accion('irA', { paradero: p.id }, 0)}
        />
        <Timeline desde={w.cfg.inicio} hasta={Math.max(snap.now, w.cfg.inicio + 60_000)} ahora={snap.now} carriles={carrilesMundo(w)} />
      </div>

      <div className="der">
        <Estado snap={snap} />
      </div>

      <div className="abajo">
        <LogView logs={w.logs} eventos={w.eventos} ver={ver} exportar={() => w.exportarLog('desc')} nombreArchivo={`SIM_${stamp(snap.now).replace(/[: ]/g, '_')}.txt`} />
      </div>
    </div>
  )
}

function Controles({ sim, snap }) {
  const { w } = sim
  const cfg = w.cfg
  const [perfil, setPerfil] = useState(cfg.perfil)
  const [logsNuevos, setLogsNuevos] = useState(cfg.logsNuevos)
  const [inicio, setInicio] = useState(stamp(cfg.inicio).slice(11, 16))
  const [inicioEn, setInicioEn] = useState(() => {
    const p0 = w.paradero(cfg.inicioEn)
    return p0 ? paraderoRef(p0) : paraderoRef(cfg.paraderos[0])
  })
  const [latencia, setLatencia] = useState(cfg.red.subidaMs)
  const [chofer, setChofer] = useState(0)
  const [dni, setDni] = useState(CHOFERES_DEMO[0].dni)
  const [clave, setClave] = useState(CHOFERES_DEMO[0].clave)
  const [destino, setDestino] = useState(paraderoRef(cfg.paraderos[0]))
  const [fuera, setFuera] = useState(0)
  const [hasta, setHasta] = useState('')
  const [kmh, setKmh] = useState(30)
  const [via, setVia] = useState('operation')
  const [sesionObj, setSesionObj] = useState('activa')
  const [ladoViaje, setLadoViaje] = useState('')
  const [guion, setGuion] = useState(null)

  const nuevoMundo = () =>
    sim.reiniciar(
      configPorDefecto({
        perfil,
        logsNuevos,
        inicio: parseStamp(`${fecha(cfg.inicio)} ${inicio}:00`),
        inicioEn,
        red: { subidaMs: latencia, bajadaMs: latencia },
        retorno: cfg.retorno,
        servidor: { ...cfg.servidor },
        ruta: cfg.ruta,
      }),
    )

  const elegirChofer = i => {
    setChofer(i)
    if (CHOFERES_DEMO[i]) {
      setDni(CHOFERES_DEMO[i].dni)
      setClave(CHOFERES_DEMO[i].clave)
    }
  }
  const ordenados = [...cfg.paraderos].sort((a, b) => a.lado - b.lado || a.orden - b.orden)
  const deLado = l => ordenados.filter(p => p.lado === l)

  return (
    <div>
      <div className="seccion">
        <h3>Mundo (se aplica al crear uno nuevo)</h3>
        <div className="col">
          <label className="fila">
            Lógica del equipo
            <select value={perfil} onChange={e => setPerfil(e.target.value)}>
              {Object.values(PERFILES).map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="fila" title="Los logs que se agregaron en la rama para diagnosticar">
            <input type="checkbox" checked={logsNuevos} onChange={e => setLogsNuevos(e.target.checked)} /> incluir logs nuevos de diagnóstico
          </label>
          <div className="fila">
            Hora
            <input type="time" value={inicio} onChange={e => setInicio(e.target.value)} />
            Bus en
            <select value={inicioEn} onChange={e => setInicioEn(e.target.value)} style={{ maxWidth: 140 }}>
              {ordenados.map(p => (
                <option key={p.id} value={paraderoRef(p)}>
                  {lado(p.lado)}{p.orden} {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <label className="fila">
            Latencia de red
            <input type="number" value={latencia} min={0} step={50} onChange={e => setLatencia(+e.target.value)} style={{ width: 70 }} /> ms
          </label>
          <div className="fila">
            <button className="btn prim" onClick={nuevoMundo}>
              Nuevo mundo
            </button>
            <span className="tenue">{cfg.ruta.nombre}</span>
          </div>
        </div>
      </div>

      <div className="seccion">
        <h3>Config de la ruta (routes-data)</h3>
        {[
          ['b', 'retorno_auto_b', 'cerrar A → abrir B'],
          ['a', 'retorno_auto_a', 'cerrar B → abrir A'],
        ].map(([k, nombre, ayuda]) => (
          <div className="fila" key={k}>
            <code style={{ width: 110 }}>{nombre}</code>
            <select value={String(cfg.retorno[k])} onChange={e => sim.accion('config', { [k]: parseRetorno(e.target.value) }, 0)}>
              {OPC_RETORNO.map(([v, t]) => (
                <option key={String(v)} value={String(v)}>
                  {t}
                </option>
              ))}
            </select>
            <span className="tenue">{ayuda}</span>
          </div>
        ))}
      </div>

      <div className="seccion">
        <h3>Central (servidor)</h3>
        <div className="col">
          <label className="col">
            Sesión automática tras un logout
            <select value={cfg.servidor.autoSesion} onChange={e => sim.accion('servidor', { autoSesion: e.target.value }, 0)}>
              {Object.entries(REGLAS_SERVIDOR.autoSesion).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="fila">
            <input type="checkbox" checked={cfg.servidor.autoSesionUsaConfig} onChange={e => sim.accion('servidor', { autoSesionUsaConfig: e.target.checked }, 0)} /> la automática respeta la config de retorno
          </label>
          <label className="fila">
            <input type="checkbox" checked={cfg.servidor.configComoTexto} onChange={e => sim.accion('servidor', { configComoTexto: e.target.checked }, 0)} /> la central acepta "true" como texto
          </label>
          <label className="fila">
            <input type="checkbox" checked={cfg.servidor.idReenvioFijo} onChange={e => sim.accion('servidor', { idReenvioFijo: e.target.checked }, 0)} /> reenvía operations con id fijo
          </label>
          <label className="fila">
            Lado de sesiones nuevas
            <select value={cfg.servidor.ladoForzado == null ? '' : String(cfg.servidor.ladoForzado)} onChange={e => sim.accion('servidor', { ladoForzado: e.target.value === '' ? null : e.target.value === 'true' }, 0)}>
              <option value="">el que pide el equipo</option>
              <option value="false">siempre A</option>
              <option value="true">siempre B</option>
            </select>
          </label>
        </div>
      </div>

      <div className="seccion">
        <h3>Chofer</h3>
        <div className="fila">
          <select value={chofer} onChange={e => elegirChofer(+e.target.value)}>
            {CHOFERES_DEMO.map((c, i) => (
              <option key={c.dni} value={i}>
                {c.nombre} ({c.code})
              </option>
            ))}
            <option value={-1}>otro / errado</option>
          </select>
          <input type="text" value={dni} onChange={e => setDni(e.target.value)} style={{ width: 86 }} title="DNI" />
          <input type="text" value={clave} onChange={e => setClave(e.target.value)} style={{ width: 56 }} title="Clave" />
        </div>
        <div className="fila">
          <button className="btn prim" onClick={() => sim.accion('login', { dni, clave })}>
            Login manual
          </button>
          <button className="btn" onClick={() => sim.accion('nfc', { dni })}>
            Tarjeta NFC
          </button>
          <button className="btn" onClick={() => sim.accion('terminarVenta')} disabled={!snap.device.mem.sessionDriver}>
            Terminar venta
          </button>
        </div>
      </div>

      <div className="seccion">
        <h3>Bus y GPS</h3>
        <div className="fila">
          <select value={destino} onChange={e => setDestino(e.target.value)} style={{ maxWidth: 170 }}>
            {ordenados.map(p => (
              <option key={p.id} value={paraderoRef(p)}>
                {lado(p.lado)}{p.orden} {p.nombre}{p.terminal || p.liquidar ? ' ▢' : ''}
              </option>
            ))}
          </select>
          <select value={fuera} onChange={e => setFuera(+e.target.value)} title="Dónde queda el bus respecto del radio">
            <option value={0}>en el paradero</option>
            <option value={20}>20 m fuera del radio</option>
            <option value={80}>80 m fuera del radio</option>
          </select>
          <button className="btn" onClick={() => sim.accion('irA', { paradero: destino, fuera: fuera || undefined }, 0)}>
            Ir
          </button>
        </div>
        <div className="fila">
          Conducir
          <select value={hasta} onChange={e => setHasta(e.target.value)} style={{ maxWidth: 130 }}>
            <option value="">hasta el final</option>
            {ordenados.map(p => (
              <option key={p.id} value={`${p.lado ? 'B' : 'A'}|${p.nombre}`}>
                hasta {lado(p.lado)}{p.orden} {p.nombre}
              </option>
            ))}
          </select>
          <input type="number" value={kmh} min={5} max={120} onChange={e => setKmh(+e.target.value)} style={{ width: 52 }} /> km/h
        </div>
        <div className="fila">
          {['A', 'B'].map(l => (
            <button key={l} className="btn" onClick={() => sim.conducir(l, hasta && hasta.startsWith(l) ? hasta.split('|')[1] : undefined, kmh)}>
              Conducir lado {l}
            </button>
          ))}
          <button className="btn" onClick={sim.detener} disabled={!sim.conduciendo}>
            Detener
          </button>
        </div>
        <div className="fila">
          <button className="btn" onClick={() => sim.accion('gpsFix', { on: !snap.device.gpsFix }, 0)}>
            {snap.device.gpsFix ? 'Quitar fix GPS' : 'Devolver fix GPS'}
          </button>
          <span className="tenue">{deLado(false).length} paraderos A · {deLado(true).length} B</span>
        </div>
      </div>

      <div className="seccion">
        <h3>La central envía</h3>
        <div className="fila">
          por
          <select value={via} onChange={e => setVia(e.target.value)}>
            <option value="operation">operation (con reenvío)</option>
            <option value="android_command">android_command</option>
          </select>
        </div>
        <div className="fila">
          <button className="btn" onClick={() => sim.accion('cerrarRemoto', { via, sesion: sesionObj })}>
            Cerrar sesión
          </button>
          <input type="text" value={sesionObj} onChange={e => setSesionObj(e.target.value)} style={{ width: 70 }} title='"activa" o un id' />
          <button className="btn" onClick={() => sim.accion('cerrarEnServidor', { sesion: sesionObj })} title="Un operador la cierra en la web; el equipo no se entera">
            Cerrar solo en BD
          </button>
        </div>
        <div className="fila">
          <button className="btn" onClick={() => sim.accion('logoutConductor', { via })}>
            logout-conductor
          </button>
          <button className="btn" onClick={() => sim.accion('loginConductor', { via, value: `${dni} ${clave}` })}>
            login-conductor
          </button>
        </div>
        <div className="fila">
          <button className="btn" onClick={() => sim.accion('viaje', ladoViaje === '' ? {} : { direction: ladoViaje === 'B' })}>
            Cambio de viaje
          </button>
          <select value={ladoViaje} onChange={e => setLadoViaje(e.target.value)} title="Lado del viaje (solo lo usa la 1.0.66 para el paradero actual)">
            <option value="">mismo lado de viaje</option>
            <option value="A">viaje lado A</option>
            <option value="B">viaje lado B</option>
          </select>
        </div>
      </div>

      <div className="seccion">
        <h3>Equipo</h3>
        <div className="fila">
          <button className="btn" onClick={() => sim.accion('reiniciar', {}, 12_000)}>
            Reiniciar app
          </button>
          {snap.device.encendido ? (
            <button className="btn peligro" onClick={() => sim.accion('apagar', {}, 0)}>
              Apagar
            </button>
          ) : (
            <button className="btn" onClick={() => sim.accion('encender', {}, 12_000)}>
              Encender
            </button>
          )}
          <button className="btn" onClick={() => sim.accion('red', { on: !snap.redArriba })}>
            {snap.redArriba ? 'Cortar señal' : 'Volver señal'}
          </button>
        </div>
        <div className="fila">
          <button className="btn peligro" onClick={() => sim.accion('bateriaCritica', {}, 15_000)}>
            Batería crítica
          </button>
          <button className="btn" onClick={() => sim.accion('energy', {}, 0)} title="16% sin cargar: a los 200 s cierra la sesión">
            ENERGY 16%
          </button>
          <button className="btn" onClick={() => sim.accion('cargar', {}, 0)}>
            Cargador
          </button>
        </div>
        <div className="fila">
          <button className="btn" onClick={() => sim.accion('noche', {}, 90_000)}>
            Ir a 02:31
          </button>
          <button className="btn" onClick={() => sim.accion('hora', { hora: '05:00' }, 0)}>
            Día siguiente 05:00
          </button>
        </div>
      </div>

      <div className="seccion">
        <h3>Tiempo</h3>
        <div className="fila">
          <button className="btn prim" onClick={() => sim.setPlay(!sim.play)}>
            {sim.play ? '⏸ Pausa' : '▶ Play'}
          </button>
          <select value={sim.vel} onChange={e => sim.setVel(+e.target.value)}>
            {[1, 5, 10, 30, 60, 300, 1200].map(v => (
              <option key={v} value={v}>
                ×{v}
              </option>
            ))}
          </select>
        </div>
        <div className="fila">
          {[
            [10_000, '+10 s'],
            [60_000, '+1 min'],
            [240_000, '+4 min'],
            [600_000, '+10 min'],
            [3_600_000, '+1 h'],
          ].map(([ms, t]) => (
            <button key={ms} className="btn peq" onClick={() => sim.avanzar(ms)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="seccion">
        <h3>Guion</h3>
        <div className="fila">
          <button className="btn" onClick={() => setGuion(guionComoTexto(guionDesdeAcciones(w.acciones)))}>
            Convertir lo hecho en escenario
          </button>
        </div>
        {guion && (
          <div className="col" style={{ marginTop: 6 }}>
            <pre className="pasos" style={{ maxHeight: 220, overflow: 'auto' }}>
              {guion}
            </pre>
            <div className="fila">
              <button className="btn peq" onClick={() => navigator.clipboard.writeText(guion)}>
                Copiar
              </button>
              <span className="tenue">pégalo en src/engine/scenarios.js y corre npm test</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Estado({ snap }) {
  const d = snap.device
  const m = d.mem
  const s = m.sessionDriver
  return (
    <div>
      <div className="panel">
        <h3>Memoria del equipo</h3>
        <table className="t">
          <tbody>
            <Fila k="sessionDriver" v={s ? <>{s.id} · lado <Lado l={s.direction} /> · autoLogin={String(s.autoLogin)}</> : '—'} />
            <Fila k="paraderoActual" v={m.paraderoActual ? `${m.paraderoActual.nombre} (${lado(m.paraderoActual.lado)}${m.paraderoActual.orden})` : '—'} />
            <Fila k="orden 1 más cercano" v={m.paraderoMasCercanoOrden1 ? <>{m.paraderoMasCercanoOrden1.nombre} → login pide <Lado l={m.paraderoMasCercanoOrden1.lado} /></> : '— → login pide A'} />
            <Fila k="ubicación usada" v={m.ubicacion ? `${m.ubicacion.lat.toFixed(5)}, ${m.ubicacion.lng.toFixed(5)}` : <span style={{ color: 'var(--mal)' }}>(0,0) sin fix desde el arranque</span>} />
            <Fila k="lastCredentials" v={m.lastCredentials ? m.lastCredentials.join(' / ') : '—'} />
            <Fila k="blockIncomingLogin" v={m.blockIncomingLogin ? <b style={{ color: 'var(--mal)' }}>true</b> : 'false'} />
            <Fila k="autoRetorno pendiente" v={Object.keys(m.pendingAutoRetorno).length ? JSON.stringify(m.pendingAutoRetorno) : '—'} />
            <Fila k="loadingLogout" v={String(m.loadingLogout)} />
            <Fila k="viaje (trip)" v={m.trip ?? '—'} />
            <Fila k="ops atendidas" v={m.opsAtendidas.length ? m.opsAtendidas.join(', ') : '—'} />
            <Fila k="batería" v={`${d.bateria.nivel}% ${d.bateria.cargando ? 'cargando' : 'sin cargar'}`} />
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Room · session_driver</h3>
        {d.room.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>id</th>
                <th>lado</th>
                <th>inicio</th>
                <th>fin</th>
                <th>dni</th>
                <th>autoLogin</th>
              </tr>
            </thead>
            <tbody>
              {d.room.map(e => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>
                    <Lado l={e.direction} />
                  </td>
                  <td>{e.start_time?.slice(11, 19)}</td>
                  <td>{e.finalizado ? e.end_time?.slice(11, 19) ?? '✓' : <b>abierta</b>}</td>
                  <td>{e.dni ?? <span style={{ color: 'var(--mal)' }}>null</span>}</td>
                  <td>{String(e.autoLogin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span className="tenue">vacía</span>
        )}
        <div className="tenue" style={{ marginTop: 4 }}>
          DataStore: {d.dataStore.dni ? `${d.dataStore.dni} / ${d.dataStore.password}` : '—'}
        </div>
      </div>

      <div className="panel">
        <h3>Central · sesiones</h3>
        {snap.server.sesiones.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>id</th>
                <th>lado</th>
                <th>chofer</th>
                <th>estado</th>
              </tr>
            </thead>
            <tbody>
              {snap.server.sesiones.map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>
                    <Lado l={s.direction} />
                  </td>
                  <td>{s.driver_code}</td>
                  <td>
                    {s.open ? <b style={{ color: 'var(--ok)' }}>abierta</b> : `cerrada ${hora(s.fin)}`}
                    {s.automatica ? ' · automática' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span className="tenue">ninguna</span>
        )}
        {snap.server.ops.some(o => !o.acked) && (
          <div style={{ marginTop: 6 }}>
            <h3>Operations sin eco (se reenvían)</h3>
            {snap.server.ops
              .filter(o => !o.acked)
              .map(o => (
                <div key={o.id} className="mono">
                  {o.key}={o.value} · {o.envios} envío(s)
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

const Fila = ({ k, v }) => (
  <tr>
    <td className="tenue" style={{ width: 130 }}>
      {k}
    </td>
    <td>{v}</td>
  </tr>
)

const paraderoRef = p => `${p.nombre}@${p.lado ? 'B' : 'A'}`
const parseRetorno = v => (v === 'true' ? true : v === 'false' ? false : v)
