import { useMemo, useState } from 'react'
import { diagnosticar, causaTxt } from '../analyzer/diagnose.js'
import { reproducir } from '../analyzer/replay.js'
import { PERFILES } from '../engine/device.js'
import { REGLAS_SERVIDOR } from '../engine/server.js'
import { stamp, hora, duracion } from '../engine/time.js'
import Timeline, { carrilesMundo } from './Timeline.jsx'
import MapView from './MapView.jsx'
import RUTA_124 from '../data/ruta124.js'

const EJEMPLOS = [
  ['124_2026-09-23_incidente.log', 'Padrón 124 · 23-09 · no abrió B y cierre remoto ignorado (1.0.66)', () => import('../../fixtures/124_2026-09-23_incidente.log?raw')],
  ['28_2026-08-13_unidad-ocupada.log', 'Padrón 28 · 12/13-08 · sesión huérfana: "otro conductor" toda la mañana', () => import('../../fixtures/28_2026-08-13_unidad-ocupada.log?raw')],
  ['130_2026-08-20_forzados.log', 'Padrón 130 · 20-08 · cierres ENERGY y batería crítica', () => import('../../fixtures/130_2026-08-20_forzados.log?raw')],
]
const lado = l => (l == null ? '?' : l ? 'B' : 'A')

export default function Diagnostico({ abrirEnSimulador }) {
  const [texto, setTexto] = useState(null)
  const [nombre, setNombre] = useState('')
  const [over, setOver] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [sel, setSel] = useState(null)
  const [error, setError] = useState(null)

  const diag = useMemo(() => {
    if (!texto) return null
    try {
      setError(null)
      return diagnosticar(texto)
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [texto])

  const abrir = (t, n) => {
    setTexto(t)
    setNombre(n)
    setSel(null)
  }
  const leerArchivo = f => {
    setCargando(true)
    f.text().then(t => {
      abrir(t, f.name)
      setCargando(false)
    })
  }

  return (
    <div className="diag">
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={e => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files[0]) leerArchivo(e.dataTransfer.files[0])
        }}
      >
        <div className="fila" style={{ justifyContent: 'center' }}>
          <b>Arrastra un log de LogManager</b>
          <span className="tenue">(el .txt que sube el equipo, en cualquier orden) o</span>
          <label className="btn prim">
            Elegir archivo
            <input type="file" accept=".txt,.log" hidden onChange={e => e.target.files[0] && leerArchivo(e.target.files[0])} />
          </label>
          <button className="btn" onClick={() => navigator.clipboard.readText().then(t => abrir(t, 'portapapeles'))}>
            Pegar del portapapeles
          </button>
        </div>
        <div className="fila" style={{ justifyContent: 'center', marginTop: 8 }}>
          <span className="tenue">Ejemplos reales (anonimizados):</span>
          {EJEMPLOS.map(([f, t, cargar]) => (
            <button key={f} className="btn peq" title={t} onClick={() => cargar().then(m => abrir(m.default, f))}>
              {t.split(' · ').slice(0, 2).join(' · ')}
            </button>
          ))}
        </div>
        {cargando && <div className="tenue">leyendo…</div>}
      </div>

      {error && <div className="riesgo" style={{ marginTop: 10 }}>No se pudo analizar: {error}</div>}
      {diag && <Resultado diag={diag} nombre={nombre} sel={sel} setSel={setSel} abrirEnSimulador={abrirEnSimulador} />}
    </div>
  )
}

function Resultado({ diag, nombre, sel, setSel, abrirEnSimulador }) {
  const { parse, sesiones, hallazgos, entradas } = diag
  const [perfil, setPerfil] = useState('actual')
  const [retorno, setRetorno] = useState({ b: true, a: true })
  const [autoSesion, setAutoSesion] = useState('tras_cerrar_a')
  const [rep, setRep] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [foco, setFoco] = useState(null)

  const cuenta = s => hallazgos.filter(h => h.severidad === s).length
  const track = useMemo(
    () =>
      parse.eventos
        .filter(e => e.tipo === 'tx' && e.header === 'report')
        .flatMap(e => (e.data.positions ?? []).map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })))
        .filter(p => p.lat && p.lng),
    [parse],
  )
  const paraderos = parse.paraderos.length > 1 ? parse.paraderos : RUTA_124.paraderos
  const hallazgoSel = sel != null ? hallazgos[sel] : null
  const marcasMapa = useMemo(() => {
    if (!hallazgoSel) return []
    return hallazgoSel.evid
      .map(i => parse.eventos.find(e => e.i === i))
      .filter(e => e?.tipo === 'paraderoActual')
      .map(e => paraderos.find(p => p.id === e.id))
      .filter(Boolean)
      .map(p => ({ lat: p.latitud, lng: p.longitud, color: '#ff5d5d' }))
  }, [hallazgoSel, parse, paraderos])

  const correr = () => setRep(reproducir(diag, { perfil, retorno, servidor: { autoSesion } }))

  const carrilReal = {
    nombre: 'Real',
    barras: sesiones
      .filter(s => Number.isFinite(s.id))
      .map(s => ({
        desde: s.inicio,
        hasta: s.fin,
        lado: s.lado,
        tenue: !!s.bloqueada,
        borde: s.bloqueada ? '#ff5d5d' : null,
        etiqueta: `${s.id} ${lado(s.lado)}`,
        titulo: `Real · ${s.id} lado ${lado(s.lado)} · ${hora(s.inicio)} → ${s.fin ? hora(s.fin) : 'abierta'} · abre: ${causaTxt(s.apertura)} · cierra: ${causaTxt(s.cierreCausa)}${s.bloqueada ? ' · DESCARTADA por el equipo' : ''}`,
      })),
    marcas: hallazgos.filter(h => h.t && h.severidad !== 'info').map(h => ({ t: h.t, color: `var(--${h.severidad})`, titulo: `${hora(h.t)} ${h.titulo}`, h })),
  }
  const carriles = rep ? [carrilReal, ...carrilesMundo(rep.world, { acciones: false }).map(c => ({ ...c, nombre: `Sim · ${c.nombre}` }))] : [carrilReal]

  const lineasFiltradas = useMemo(() => {
    if (!filtro) return []
    let re
    try {
      re = new RegExp(filtro, 'i')
    } catch {
      return []
    }
    return entradas.filter(e => re.test(`[${e.tag}] ${e.msg}`)).slice(0, 400)
  }, [filtro, entradas])

  const verLinea = i => setFoco(i)

  return (
    <div style={{ marginTop: 12 }}>
      <div className="tarjetas">
        <div className="tarjeta">
          <span className="tenue">Archivo</span>
          <b style={{ fontSize: 13 }}>{nombre}</b>
          <span className="tenue">
            {entradas.length} líneas · orden {parse.orden}
          </span>
        </div>
        <div className="tarjeta">
          <span className="tenue">Equipo</span>
          <b>
            padrón {parse.equipo.padron ?? '?'} · id {parse.equipo.id ?? '?'}
          </b>
          <span className="tenue">versión {parse.equipo.versiones.join(', ') || 'no aparece'}</span>
        </div>
        <div className="tarjeta">
          <span className="tenue">Rango</span>
          <b style={{ fontSize: 14 }}>
            {stamp(parse.desde).slice(0, 16)} → {stamp(parse.hasta).slice(11, 16)}
          </b>
          <span className="tenue">{duracion(parse.hasta - parse.desde)}</span>
        </div>
        <div className="tarjeta">
          <span className="tenue">Sesiones</span>
          <b>{sesiones.filter(s => Number.isFinite(s.id)).length}</b>
          <span className="tenue">{parse.paraderos.length} paraderos en el log</span>
        </div>
        <div className="tarjeta">
          <span className="tenue">Hallazgos</span>
          <b>
            <span style={{ color: 'var(--alta)' }}>{cuenta('alta')}</span> · <span style={{ color: 'var(--media)' }}>{cuenta('media')}</span> · <span style={{ color: 'var(--baja)' }}>{cuenta('baja')}</span>
          </b>
          <span className="tenue">alta · media · baja</span>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <Timeline desde={parse.desde} hasta={parse.hasta + (rep ? 60_000 : 0)} carriles={carriles} onClick={x => x.h && setSel(hallazgos.indexOf(x.h))} />
      </div>

      <div className="dos" style={{ marginTop: 10 }}>
        <div>
          <h3>Hallazgos</h3>
          {hallazgos.map((h, i) => (
            <div key={i} className={`hallazgo${sel === i ? ' sel' : ''}`} onClick={() => setSel(sel === i ? null : i)}>
              <div className="fila">
                <span className={`sev ${h.severidad}`}>{h.severidad}</span>
                <b>{h.titulo}</b>
              </div>
              <div className="tenue" style={{ marginTop: 3 }}>
                {h.t ? `${hora(h.t)} · ` : ''}
                {h.detalle}
              </div>
              {sel === i && h.evid.length > 0 && (
                <div className="visor" style={{ marginTop: 6 }}>
                  {h.evid.map(ix => (
                    <div key={ix} className="logs">
                      <div className="l" onClick={e => (e.stopPropagation(), verLinea(ix))} style={{ cursor: 'pointer' }}>
                        <span className="h">
                          #{entradas[ix].n} {stamp(entradas[ix].t)}{' '}
                        </span>
                        <span className={`tg tag-${entradas[ix].tag}`}>[{entradas[ix].tag}]</span> {entradas[ix].msg.slice(0, 400)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="col">
          <h3>Sesiones reconstruidas</h3>
          <div className="panel" style={{ padding: 0, maxHeight: 280, overflow: 'auto' }}>
            <TablaSesiones sesiones={sesiones} />
          </div>
          <h3 style={{ marginTop: 6 }}>Recorrido (posiciones de los report + paraderos del log)</h3>
          <div style={{ height: 340 }}>
            <MapView paraderos={paraderos} track={track} marcas={marcasMapa} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>Reproducir este día con otra lógica</h3>
        <p className="tenue" style={{ marginTop: 0 }}>
          Del log se toman el GPS (report, paradero actual, paradero más cercano), los logins manuales, las órdenes de la central, los reinicios, la señal y la batería. Lo que decidió la app (cierres en terminal, autoretorno, restauraciones) lo vuelve a decidir la lógica elegida.
        </p>
        <div className="fila">
          Lógica
          <select value={perfil} onChange={e => setPerfil(e.target.value)}>
            {Object.values(PERFILES).map(p => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          retorno_auto_b
          <select value={String(retorno.b)} onChange={e => setRetorno({ ...retorno, b: e.target.value === 'true' })}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          retorno_auto_a
          <select value={String(retorno.a)} onChange={e => setRetorno({ ...retorno, a: e.target.value === 'true' })}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          central
          <select value={autoSesion} onChange={e => setAutoSesion(e.target.value)}>
            {Object.entries(REGLAS_SERVIDOR.autoSesion).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
          <button className="btn prim" onClick={correr}>
            Reproducir
          </button>
          {rep && (
            <button className="btn" onClick={() => abrirEnSimulador(rep.world)}>
              Abrir la reproducción en el simulador
            </button>
          )}
        </div>
        {rep && (
          <div className="dos" style={{ marginTop: 10 }}>
            <div>
              <h3>Sesiones con la lógica "{PERFILES[perfil].nombre}"</h3>
              <div className="panel" style={{ padding: 0 }}>
                <TablaSesiones sesiones={rep.diagSim.sesiones} />
              </div>
              {rep.guion.avisos.map(a => (
                <div key={a} className="riesgo" style={{ marginTop: 6 }}>
                  {a}
                </div>
              ))}
            </div>
            <div>
              <h3>Qué detectaría el diagnóstico en la reproducción</h3>
              {rep.diagSim.hallazgos
                .filter(h => h.severidad !== 'info')
                .map((h, i) => (
                  <div key={i} className="fila">
                    <span className={`sev ${h.severidad}`}>{h.severidad}</span> {h.titulo}
                  </div>
                ))}
              {!rep.diagSim.hallazgos.some(h => h.severidad !== 'info') && <span className="tenue">nada relevante</span>}
              <div className="tenue" style={{ marginTop: 8 }}>
                {rep.guion.acciones.length} acciones reproducidas ({resumenAcciones(rep.guion.acciones)})
                {rep.errores.length ? ` · ${rep.errores.length} errores: ${rep.errores.slice(0, 2).join(' · ')}` : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>Buscar en el log</h3>
        <div className="fila">
          <input type="text" placeholder="regex, p. ej. driver_log|operation|Terminal" value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: 360 }} />
          {['driver_login|driver_logout', 'operation|android_command', 'Paradero actual', 'DRIVERAUTO', 'ProtectorVM', 'Inicialización'].map(f => (
            <button key={f} className="btn peq" onClick={() => setFiltro(f)}>
              {f}
            </button>
          ))}
          {filtro && <span className="tenue">{lineasFiltradas.length} (máx 400)</span>}
        </div>
        {filtro && (
          <div className="visor logs" style={{ marginTop: 6 }}>
            {lineasFiltradas.map(e => (
              <div key={e.i} className="l" onClick={() => verLinea(e.i)} style={{ cursor: 'pointer' }}>
                <span className="h">
                  #{e.n} {stamp(e.t)}{' '}
                </span>
                <span className={`tg tag-${e.tag}`}>[{e.tag}]</span> {e.msg.slice(0, 500)}
              </div>
            ))}
          </div>
        )}
        {foco != null && (
          <>
            <h3 style={{ marginTop: 10 }}>Contexto de la línea #{entradas[foco].n}</h3>
            <div className="visor logs">
              {entradas.slice(Math.max(0, foco - 15), foco + 16).map(e => (
                <div key={e.i} className={`l${e.i === foco ? ' marcada' : ''}`}>
                  <span className="h">
                    #{e.n} {stamp(e.t)}{' '}
                  </span>
                  <span className={`tg tag-${e.tag}`}>[{e.tag}]</span> {e.msg.slice(0, 500)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TablaSesiones({ sesiones }) {
  const ss = sesiones.filter(s => Number.isFinite(s.id))
  if (!ss.length) return <div className="tenue" style={{ padding: 8 }}>ninguna</div>
  return (
    <table className="t">
      <thead>
        <tr>
          <th>sesión</th>
          <th>lado</th>
          <th>desde</th>
          <th>hasta</th>
          <th>cómo se abrió</th>
          <th>cómo se cerró</th>
        </tr>
      </thead>
      <tbody>
        {ss.map(s => (
          <tr key={s.id}>
            <td>
              {s.id}
              {s.bloqueada && (
                <span className="sev alta" style={{ marginLeft: 4 }}>
                  descartada
                </span>
              )}
            </td>
            <td className={`lado-${lado(s.lado)}`}>{lado(s.lado)}</td>
            <td>{hora(s.inicio)}</td>
            <td>{s.fin ? hora(s.fin) : <b>abierta</b>}</td>
            <td>
              {causaTxt(s.apertura)}
              {s.ladoDistinto && <div className="tenue">pidió {lado(s.ladoDistinto.pedido)}</div>}
            </td>
            <td>{s.fin || s.cierreCausa ? causaTxt(s.cierreCausa) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function resumenAcciones(acciones) {
  const c = {}
  for (const a of acciones) c[a.tipo] = (c[a.tipo] ?? 0) + 1
  return Object.entries(c)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
}
