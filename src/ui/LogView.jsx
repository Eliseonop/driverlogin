// Consola con el log en formato LogManager (+ eventos de simulación opcionales en cursiva).

import { useEffect, useMemo, useRef, useState } from 'react'
import { stamp } from '../engine/time.js'

const MAX = 2500

export function descargar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export default function LogView({ logs, eventos = [], nombreArchivo = 'LOG_simulado.txt', exportar, ver, marcar }) {
  const [filtro, setFiltro] = useState('')
  const [conEventos, setConEventos] = useState(true)
  const [sinRuido, setSinRuido] = useState(true)
  const [desc, setDesc] = useState(false)
  const [pegado, setPegado] = useState(true)
  const cuerpo = useRef(null)

  const filas = useMemo(() => {
    const re = filtro ? safeRe(filtro) : null
    let f = logs.map(l => ({ t: l.t, k: `l${l.i}`, tag: l.tag, msg: l.msg }))
    if (sinRuido) f = f.filter(x => !/^Paradero más cercano: |^TERMINAL |^Mensaje: Header: login/.test(x.msg))
    if (conEventos) f = f.concat(eventos.map((e, i) => ({ t: e.t, k: `e${i}`, ev: e.tipo, msg: e.texto })))
    f.sort((a, b) => a.t - b.t || (a.ev ? 1 : 0) - (b.ev ? 1 : 0))
    if (re) f = f.filter(x => re.test(`[${x.tag ?? x.ev}] ${x.msg}`))
    if (desc) f.reverse()
    return f.length > MAX ? (desc ? f.slice(0, MAX) : f.slice(-MAX)) : f
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, eventos, filtro, conEventos, sinRuido, desc, ver, logs.length, eventos.length])

  useEffect(() => {
    if (pegado && cuerpo.current && !desc) cuerpo.current.scrollTop = cuerpo.current.scrollHeight
  }, [filas, pegado, desc])

  return (
    <div className="logs">
      <div className="herr">
        <b>Log</b>
        <input type="text" placeholder="filtrar (texto o /regex/)" value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: 220 }} />
        <label className="fila">
          <input type="checkbox" checked={conEventos} onChange={e => setConEventos(e.target.checked)} /> eventos de simulación
        </label>
        <label className="fila">
          <input type="checkbox" checked={sinRuido} onChange={e => setSinRuido(e.target.checked)} /> ocultar ruido de GPS
        </label>
        <label className="fila">
          <input type="checkbox" checked={desc} onChange={e => setDesc(e.target.checked)} /> más nuevo arriba
        </label>
        <label className="fila">
          <input type="checkbox" checked={pegado} onChange={e => setPegado(e.target.checked)} /> seguir
        </label>
        <span className="tenue">{filas.length} líneas</span>
        <span style={{ flex: 1 }} />
        {exportar && (
          <>
            <button className="btn peq" onClick={() => navigator.clipboard.writeText(exportar())}>
              Copiar log
            </button>
            <button className="btn peq" onClick={() => descargar(nombreArchivo, exportar())}>
              Descargar .txt
            </button>
          </>
        )}
      </div>
      <div className="cuerpo" ref={cuerpo}>
        {filas.map(f =>
          f.ev ? (
            <div key={f.k} className={`l ev ${f.ev}`}>
              <span className="h">{stamp(f.t).slice(11)} </span>· {f.msg}
            </div>
          ) : (
            <div key={f.k} className={`l${marcar?.(f) ? ' marcada' : ''}`}>
              <span className="h">{stamp(f.t)} </span>
              <span className={`tg tag-${f.tag}`}>[{f.tag}]</span> {f.msg}
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function safeRe(s) {
  try {
    const m = /^\/(.*)\/([a-z]*)$/.exec(s)
    return m ? new RegExp(m[1], m[2] || 'i') : new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  } catch {
    return /$^/
  }
}
