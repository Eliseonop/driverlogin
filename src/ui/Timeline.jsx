// Línea de tiempo en carriles: barras de sesiones (azul A / naranja B) y marcas de eventos.

import { useState } from 'react'
import { hora } from '../engine/time.js'

const PASOS = [5, 15, 30, 60, 120, 240, 480].map(m => m * 60_000)

export default function Timeline({ desde, hasta, carriles, ahora, onClick }) {
  const [tip, setTip] = useState(null)
  if (desde == null || hasta == null || hasta <= desde) return null
  const W = 1000
  const izq = 90
  const alto = 22
  const H = 18 + carriles.length * (alto + 6)
  const x = t => izq + ((t - desde) / (hasta - desde)) * (W - izq - 6)
  const paso = PASOS.find(p => (hasta - desde) / p <= 12) ?? 24 * 3600_000
  const ticks = []
  for (let t = Math.ceil(desde / paso) * paso; t <= hasta; t += paso) ticks.push(t)

  return (
    <div className="tl" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={12} y2={H} stroke="#2a3340" />
            <text x={x(t) + 2} y={10}>
              {hora(t).slice(0, 5)}
            </text>
          </g>
        ))}
        {carriles.map((c, i) => {
          const y = 16 + i * (alto + 6)
          return (
            <g key={c.nombre}>
              <text x={2} y={y + 14} style={{ fill: '#c3cbd6' }}>
                {c.nombre}
              </text>
              <rect x={izq} y={y} width={W - izq - 6} height={alto} fill="#11161c" />
              {c.barras.map((b, j) => {
                const x1 = x(Math.max(b.desde, desde))
                const x2 = x(Math.min(b.hasta ?? hasta, hasta))
                return (
                  <g
                    key={j}
                    onMouseEnter={e => setTip({ texto: b.titulo, x: e.nativeEvent.offsetX })}
                    onMouseLeave={() => setTip(null)}
                    onClick={() => onClick?.(b)}
                    style={{ cursor: onClick ? 'pointer' : 'default' }}
                  >
                    <rect x={x1} y={y + 2} width={Math.max(x2 - x1, 2)} height={alto - 4} rx={3} fill={b.lado == null ? '#555' : b.lado ? 'var(--B)' : 'var(--A)'} fillOpacity={b.tenue ? 0.35 : 0.85} stroke={b.borde ?? 'none'} strokeWidth={b.borde ? 2 : 0} strokeDasharray={b.rayado ? '4 3' : ''} />
                    {x2 - x1 > 40 && (
                      <text x={x1 + 4} y={y + 15} style={{ fill: '#0b0e12', fontWeight: 600 }}>
                        {b.etiqueta}
                      </text>
                    )}
                  </g>
                )
              })}
              {(c.marcas ?? []).map((m, j) => (
                <g key={`m${j}`} onMouseEnter={e => setTip({ texto: m.titulo, x: e.nativeEvent.offsetX })} onMouseLeave={() => setTip(null)} onClick={() => onClick?.(m)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
                  <line x1={x(m.t)} x2={x(m.t)} y1={y} y2={y + alto} stroke={m.color ?? '#fff'} strokeWidth={2} />
                  <circle cx={x(m.t)} cy={y + 3} r={3} fill={m.color ?? '#fff'} />
                </g>
              ))}
            </g>
          )
        })}
        {ahora != null && <line x1={x(ahora)} x2={x(ahora)} y1={12} y2={H} stroke="#b18cff" strokeWidth={1.5} />}
      </svg>
      {tip?.texto && (
        <div className="mapa-tip" style={{ left: Math.min(tip.x, 700), bottom: '100%' }}>
          {tip.texto}
        </div>
      )}
    </div>
  )
}

/** Carriles del mundo simulado: central (sesiones del servidor), equipo (sesión activa) y acciones. */
export function carrilesMundo(w, { acciones = true } = {}) {
  const lado = l => (l ? 'B' : 'A')
  const central = w.server.sesiones.map(s => ({
    desde: s.inicio,
    hasta: s.fin,
    lado: s.direction,
    rayado: s.automatica,
    etiqueta: `${s.id} ${lado(s.direction)}`,
    titulo: `Central · sesión ${s.id} lado ${lado(s.direction)} ${s.automatica ? '(automática)' : ''} ${hora(s.inicio)} → ${s.fin ? hora(s.fin) : 'abierta'}`,
  }))
  const equipo = []
  w.historial.forEach((h, i) => {
    if (h.id == null) return
    const sig = w.historial[i + 1]
    equipo.push({ desde: h.t, hasta: sig?.t ?? null, lado: h.lado, etiqueta: `${h.id} ${lado(h.lado)}`, titulo: `Equipo · sesión activa ${h.id} lado ${lado(h.lado)} desde ${hora(h.t)}` })
  })
  const COLOR = { accion: '#7ee0b1', bloqueado: '#ff5d5d', perdido: '#ff8b8b', servidor: '#b18cff' }
  const marcas = w.eventos.filter(e => (acciones && e.tipo === 'accion') || e.tipo === 'bloqueado' || e.tipo === 'perdido').map(e => ({ t: e.t, color: COLOR[e.tipo], titulo: `${hora(e.t)} ${e.texto}` }))
  return [
    { nombre: 'Central', barras: central },
    { nombre: 'Equipo', barras: equipo },
    { nombre: 'Eventos', barras: [], marcas },
  ]
}
