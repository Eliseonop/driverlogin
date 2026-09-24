// Mapa SVG sin teselas: proyección equirectangular de los paraderos. Rueda = zoom, arrastrar = mover,
// clic = llevar el bus ahí, clic en un paradero = ir a ese paradero.

import { useEffect, useMemo, useRef, useState } from 'react'

const M_POR_GRADO = 111_320

export function useProyeccion(paraderos, extra = []) {
  return useMemo(() => {
    const pts = [...paraderos.map(p => [p.latitud, p.longitud]), ...extra.map(p => [p.lat, p.lng])].filter(([a, b]) => a && b)
    if (!pts.length) pts.push([-12, -77])
    const lats = pts.map(p => p[0])
    const lngs = pts.map(p => p[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const ancho = Math.max((maxLng - minLng) * cos, 0.002)
    const alto = Math.max(maxLat - minLat, 0.002)
    const escala = 1000 / Math.max(ancho, alto)
    const pad = 60
    const W = ancho * escala + pad * 2
    const H = alto * escala + pad * 2
    return {
      W,
      H,
      xy: (lat, lng) => [pad + (lng - minLng) * cos * escala, pad + (maxLat - lat) * escala],
      latlng: (x, y) => ({ lat: maxLat - (y - pad) / escala, lng: minLng + (x - pad) / (cos * escala) }),
      metros: m => (m / M_POR_GRADO) * escala,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paraderos])
}

export default function MapView({ paraderos, bus, sesionLado, actualId, orden1Id, onMover, onIrA, track = [], marcas = [], seguir = false }) {
  const proy = useProyeccion(paraderos, bus ? [bus] : [])
  const { W, H, xy, latlng, metros } = proy
  const [vb, setVb] = useState(null)
  const [tip, setTip] = useState(null)
  const svgRef = useRef(null)
  const drag = useRef(null)
  const [px, setPx] = useState({ w: 800, h: 500 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setPx({ w: e.contentRect.width || 800, h: e.contentRect.height || 500 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  let view = vb ?? { x: 0, y: 0, w: W, h: H }
  if (seguir && bus) {
    const [bx, by] = xy(bus.lat, bus.lng)
    const w = Math.min(view.w, W / 6)
    view = { x: bx - w / 2, y: by - (w * H) / W / 2, w, h: (w * H) / W }
  }
  // unidades SVG por pixel de pantalla: los tamaños de marcadores y textos quedan en px
  const k = Math.max(view.w / px.w, view.h / px.h)

  const aSvg = e => {
    const r = svgRef.current.getBoundingClientRect()
    const escala = Math.max(view.w / r.width, view.h / r.height)
    const offX = (r.width * escala - view.w) / 2
    const offY = (r.height * escala - view.h) / 2
    return [view.x - offX + (e.clientX - r.left) * escala, view.y - offY + (e.clientY - r.top) * escala]
  }

  const rueda = e => {
    const [mx, my] = aSvg(e)
    const f = e.deltaY > 0 ? 1.25 : 0.8
    const w = Math.min(Math.max(view.w * f, 20), W * 1.5)
    const h = (w * view.h) / view.w
    setVb({ x: mx - ((mx - view.x) * w) / view.w, y: my - ((my - view.y) * h) / view.h, w, h })
  }

  const abajo = e => {
    drag.current = { x0: e.clientX, y0: e.clientY, v: view, movio: false }
  }
  const mover = e => {
    const d = drag.current
    if (!d) return
    const r = svgRef.current.getBoundingClientRect()
    const escala = Math.max(d.v.w / r.width, d.v.h / r.height)
    const dx = (e.clientX - d.x0) * escala
    const dy = (e.clientY - d.y0) * escala
    if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4) d.movio = true
    if (d.movio) setVb({ ...d.v, x: d.v.x - dx, y: d.v.y - dy })
  }
  const arriba = e => {
    const d = drag.current
    drag.current = null
    if (d && !d.movio && onMover) {
      const [x, y] = aSvg(e)
      onMover(latlng(x, y))
    }
  }

  const linea = lado =>
    paraderos
      .filter(p => p.lado === lado)
      .sort((a, b) => a.orden - b.orden)
      .map(p => xy(p.latitud, p.longitud).join(','))
      .join(' ')

  const busXY = bus ? xy(bus.lat, bus.lng) : null
  const colorBus = sesionLado == null ? '#8b96a5' : sesionLado ? 'var(--B)' : 'var(--A)'

  return (
    <div className="mapa-wrap">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={rueda}
        onMouseDown={abajo}
        onMouseMove={mover}
        onMouseUp={arriba}
        onMouseLeave={() => {
          drag.current = null
          setTip(null)
        }}
      >
        <polyline points={linea(false)} fill="none" stroke="var(--A)" strokeOpacity=".45" strokeWidth={2.2 * k} />
        <polyline points={linea(true)} fill="none" stroke="var(--B)" strokeOpacity=".45" strokeWidth={2.2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
        {track.length > 1 && <polyline points={track.map(p => xy(p.lat, p.lng).join(',')).join(' ')} fill="none" stroke="#b18cff" strokeOpacity=".6" strokeWidth={1.6 * k} />}
        {paraderos.map(p => {
          const [x, y] = xy(p.latitud, p.longitud)
          const color = p.lado ? 'var(--B)' : 'var(--A)'
          const esTerm = p.terminal || p.liquidar
          const actual = p.id === actualId
          return (
            <g
              key={`${p.id}-${p.lado}`}
              onMouseDown={e => e.stopPropagation()}
              onMouseUp={e => {
                e.stopPropagation()
                onIrA?.(p)
              }}
              onMouseEnter={e => setTip({ p, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setTip(null)}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={x} cy={y} r={Math.max(metros(p.radio), 0.8 * k)} fill={color} fillOpacity={esTerm ? 0.16 : 0.06} stroke={color} strokeOpacity={esTerm ? 0.7 : 0.25} strokeWidth={0.8 * k} strokeDasharray={esTerm ? '' : `${2 * k} ${2 * k}`} />
              <circle cx={x} cy={y} r={(p.orden === 1 ? 5 : 3) * k} fill={p.orden === 1 ? '#fff' : color} stroke={color} strokeWidth={p.orden === 1 ? 2.2 * k : 0} />
              {esTerm && <rect x={x - 3.5 * k} y={y - 3.5 * k} width={7 * k} height={7 * k} fill="none" stroke="#fff" strokeWidth={1.2 * k} />}
              {actual && <circle cx={x} cy={y} r={9 * k} fill="none" stroke="#fff" strokeWidth={1.6 * k} />}
              {p.id === orden1Id && <circle cx={x} cy={y} r={12 * k} fill="none" stroke="#3ecf8e" strokeWidth={1.2 * k} strokeDasharray={`${3 * k} ${2 * k}`} />}
              {(view.w < W / 3 || p.orden === 1 || esTerm) && (
                <text x={x + 7 * k} y={y - 6 * k} fontSize={10 * k} fill={color} style={{ pointerEvents: 'none' }}>
                  {p.nombre} · {p.lado ? 'B' : 'A'}{p.orden}
                </text>
              )}
            </g>
          )
        })}
        {marcas.map((m, i) => {
          const [x, y] = xy(m.lat, m.lng)
          return <circle key={i} cx={x} cy={y} r={4 * k} fill={m.color ?? '#ff5d5d'} stroke="#000" strokeWidth={0.6 * k} />
        })}
        {busXY && (
          <g transform={`translate(${busXY[0]} ${busXY[1]})`} style={{ pointerEvents: 'none' }}>
            <circle r={11 * k} fill={colorBus} fillOpacity=".25" />
            <circle r={6.5 * k} fill={colorBus} stroke="#fff" strokeWidth={1.8 * k} />
            <text y={3.5 * k} fontSize={9 * k} textAnchor="middle" fill="#000" fontWeight="700">
              🚌
            </text>
          </g>
        )}
      </svg>
      <div className="mapa-herr">
        <button className="btn peq" onClick={() => setVb(null)}>
          Encuadrar
        </button>
      </div>
      <div className="mapa-leyenda">
        <span className="lado-A">━ lado A</span>
        <span className="lado-B">┅ lado B</span>
        <span>◯ blanco = orden 1</span>
        <span>▢ terminal/liquidar (círculo = radio real)</span>
        <span style={{ color: '#3ecf8e' }}>◌ orden 1 más cercano</span>
        <span className="tenue">rueda: zoom · arrastrar: mover · clic: llevar el bus</span>
      </div>
      {tip && (
        <div className="mapa-tip" style={{ left: 12, top: 12 }}>
          <b className={tip.p.lado ? 'lado-B' : 'lado-A'}>{tip.p.nombre}</b> · id {tip.p.id} · lado {tip.p.lado ? 'B' : 'A'} · orden {tip.p.orden}
          <br />
          radio {Math.round(tip.p.radio)} m{tip.p.terminal ? ' · terminal' : ''}
          {tip.p.liquidar ? ' · liquidar' : ''}
        </div>
      )}
    </div>
  )
}
