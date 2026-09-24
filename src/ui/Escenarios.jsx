import { useMemo, useState } from 'react'
import { ESCENARIOS, GRUPOS, correrEscenario } from '../engine/scenarios.js'
import { PERFILES } from '../engine/device.js'
import Timeline, { carrilesMundo } from './Timeline.jsx'
import LogView from './LogView.jsx'

const fmtPaso = ([accion, p]) => (p && Object.keys(p).length ? `${accion} ${JSON.stringify(p).replace(/"(\w+)":/g, '$1: ')}` : accion)

export default function Escenarios({ abrirEnSimulador }) {
  const [perfil, setPerfil] = useState('')
  const resultados = useMemo(() => ESCENARIOS.map(e => correrEscenario(e, perfil ? { perfil } : {})), [perfil])
  const [selId, setSelId] = useState(ESCENARIOS[0].id)
  const [soloRiesgos, setSoloRiesgos] = useState(false)
  const sel = resultados.find(r => r.esc.id === selId) ?? resultados[0]
  const ok = resultados.filter(r => r.ok).length
  const riesgos = resultados.filter(r => r.esc.riesgo).length

  return (
    <div className="esc">
      <div className="lista">
        <div className="fila" style={{ marginBottom: 8 }}>
          <span className={`chip ${ok === resultados.length ? 'ok' : 'mal'}`}>
            {ok}/{resultados.length} verificaciones OK
          </span>
          <span className="chip" style={{ borderColor: 'var(--media)', color: 'var(--media)' }}>
            {riesgos} riesgos documentados
          </span>
        </div>
        <div className="fila" style={{ marginBottom: 8 }}>
          <label className="fila">
            Forzar lógica
            <select value={perfil} onChange={e => setPerfil(e.target.value)}>
              <option value="">la de cada escenario</option>
              {Object.values(PERFILES).map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="fila">
            <input type="checkbox" checked={soloRiesgos} onChange={e => setSoloRiesgos(e.target.checked)} /> solo riesgos
          </label>
        </div>
        {perfil && <div className="tenue" style={{ marginBottom: 8 }}>Con otra lógica muchas verificaciones fallan a propósito: sirve para ver qué cambia entre versiones.</div>}
        {GRUPOS.map(g => {
          const rs = resultados.filter(r => r.esc.grupo === g && (!soloRiesgos || r.esc.riesgo))
          if (!rs.length) return null
          return (
            <div key={g} style={{ marginBottom: 10 }}>
              <h3>{g}</h3>
              {rs.map(r => (
                <div key={r.esc.id} className={`it${r.esc.id === sel.esc.id ? ' sel' : ''}`} onClick={() => setSelId(r.esc.id)}>
                  <span>{r.ok ? '✅' : '❌'}</span>
                  <span style={{ flex: 1 }}>
                    {r.esc.titulo}
                    {r.esc.riesgo && (
                      <span className="sev media" style={{ marginLeft: 6 }}>
                        riesgo
                      </span>
                    )}
                    <div className="tenue mono">{r.esc.id}</div>
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="detalle">
        <div className="fila">
          <h2 style={{ fontSize: 17 }}>{sel.esc.titulo}</h2>
          <span style={{ flex: 1 }} />
          <button className="btn prim" onClick={() => abrirEnSimulador(sel.world)}>
            Abrir en el simulador y seguir jugando
          </button>
        </div>
        {sel.esc.descripcion && <p style={{ margin: 0 }}>{sel.esc.descripcion}</p>}
        {sel.esc.riesgo && <div className="riesgo">⚠ {sel.esc.riesgo}</div>}
        <div className="dos">
          <div className="panel">
            <h3>Guion</h3>
            <pre className="pasos">
              {sel.esc.config ? `config ${JSON.stringify(sel.esc.config, (k, v) => (k === 'ruta' ? v.nombre : v))}\n\n` : ''}
              {sel.esc.pasos.map(fmtPaso).join('\n')}
            </pre>
          </div>
          <div className="panel">
            <h3>Qué se espera</h3>
            {sel.checks.map((c, i) => (
              <div key={i} className="check">
                <span>{c.ok ? '✅' : '❌'}</span>
                <span>{c.texto}</span>
              </div>
            ))}
            <h3 style={{ marginTop: 10 }}>Final</h3>
            <div className="tenue">
              Equipo: {sel.world.sesion ? `sesión ${sel.world.sesion.id} lado ${sel.world.sesion.direction ? 'B' : 'A'}` : 'sin sesión'} · Central: {sel.world.abiertasServidor().map(s => `${s.id}${s.direction ? 'B' : 'A'}`).join(', ') || 'ninguna abierta'} · {sel.world.server.sesiones.length} sesiones creadas
            </div>
          </div>
        </div>
        <Timeline desde={sel.world.cfg.inicio} hasta={sel.world.now} carriles={carrilesMundo(sel.world)} />
        <div style={{ height: 420, border: '1px solid var(--borde)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          <LogView logs={sel.world.logs} eventos={sel.world.eventos} ver={sel.esc.id + perfil} exportar={() => sel.world.exportarLog('desc')} nombreArchivo={`ESC_${sel.esc.id}.txt`} />
        </div>
      </div>
    </div>
  )
}
