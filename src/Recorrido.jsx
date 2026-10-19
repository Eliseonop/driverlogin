import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { duracion, fechaLog, horaLog } from './log/leer.js'
import { libroXlsx, XLSX_MIME } from './log/excel.js'
import { aCsv, buscarEnLog, desfase, estadoMarca, excelViaje, porQueSeCorta, posicionEn, recortar, recorrido } from './log/recorrido.js'

const COLOR = { ok: '#16a34a', mal: '#dc2626', sin: '#94a3b8' }
const COLOR_VIAJE = ['#2563eb', '#0d9488', '#ca8a04', '#0891b2', '#475569'] // sin morado: es el color de la búsqueda
const hm = t => horaLog(t).slice(0, 5)
// Atajos del buscador: el texto apunta a la línea que de verdad registra el comando (no al eco del dispatcher).
const ATAJOS = [
  ['driver_login', 'driver_login [DATA]'],
  ['driver_logout', 'driver_logout [DATA]'],
  ['operation', 'operation [DATA]'],
  ['android_command', 'android_command [DATA]'],
  ['login', '| login [DATA]'],
  ['salida', '| salida [DATA]'],
  ['mark', '| mark [DATA]'],
  ['venta impresa', '[VENTA] IMPRESA'],
  ['watchdog socket', 'Watchdog'],
  ['arranque app', 'MyApp.onCreate'],
]
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export default function Recorrido({ rep, desde, hasta, t, ir, log }) {
  const completo = useMemo(() => recorrido(rep), [rep])
  const r = useMemo(() => recortar(completo, desde, hasta), [completo, desde, hasta])
  const [foco, setFoco] = useState(null)
  const [consulta, setConsulta] = useState('')
  const [ancho, setAncho] = useState(false)
  const diferida = useDeferredValue(consulta)
  const busqueda = useMemo(() => buscarEnLog(rep.entradas, completo.pos, diferida, desde, hasta), [rep, completo, diferida, desde, hasta])
  const elegir = x => {
    ir(x)
    setFoco({ t: x })
  }
  const elegirPin = h => {
    ir(h.t)
    setFoco({ t: h.t, pin: h.n })
  }
  const elegirCorte = c => {
    ir(c.t)
    setFoco({ t: c.t, corte: true })
  }
  if (!r.pos.length)
    return (
      <>
        <div className="alerta">{completo.pos.length ? 'No hay posiciones enviadas en el rango elegido.' : 'Este log no tiene posiciones enviadas (report con positions): no hay recorrido que dibujar.'}</div>
        <div className="recorrido-solo-log">{log}</div>
      </>
    )
  return (
    <div className="recorrido">
      <div className={`recorrido-arriba ${ancho ? 'ancho' : ''}`}>
        <Mapa r={r} t={t} ir={ir} foco={foco} hallados={busqueda.hallados} ancho={ancho} setAncho={setAncho} />
        {!ancho && <div className="recorrido-log">{log}</div>}
      </div>
      <div className="recorrido-abajo">
        <Apagados apagados={r.apagados} elegir={a => (ir(a.t), setFoco({ t: a.t, apagado: true }))} />
        <Cortes cortes={r.cortes} t={t} elegir={elegirCorte} />
        <Buscador consulta={consulta} setConsulta={setConsulta} busqueda={busqueda} elegir={elegirPin} encuadrar={() => setFoco({ todos: Date.now() })} />
        <Cobertura r={r} rep={rep} desde={desde} hasta={hasta} />
        <ExportarViaje r={completo} rep={rep} t={t} />
        <Veredicto v={r.veredicto} />
        {r.viajes.map(v => <TablaViaje key={v.trip} v={v} t={t} ir={elegir} />)}
        {r.sinMarca.length > 0 && (
          <div className="card">
            <h3>Entradas del equipo sin marca de la central</h3>
            <table className="tabla-geo"><tbody>
              {r.sinMarca.map(g => (
                <tr key={g.t} onClick={() => elegir(g.t)}><td>{horaLog(g.t)}</td><td>{g.nombre}</td><td className="sutil">{g.salida ? `sale ${horaLog(g.salida.t)}` : ''}</td></tr>
              ))}
            </tbody></table>
          </div>
        )}
        {r.paradas.length > 0 && (
          <div className="card">
            <h3>Detenciones ≥ 1 min <span className="sutil">{r.paradas.length}</span></h3>
            <table className="tabla-geo"><tbody>
              {r.paradas.map(p => (
                <tr key={p.a.t} onClick={() => elegir(p.a.t)}><td>{horaLog(p.a.t)} → {horaLog(p.b.t)}</td><td>{duracion(p.b.t - p.a.t)}</td></tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  )
}

const RAPIDA = 5000 // reconexión en menos de esto: el socket se cae y vuelve casi al instante
const graveCorte = c => c.fuera >= 30_000 || c.vuelve == null

/** Lista de cada caída del socket en el rango: hora, por qué, cuánto estuvo sin conexión y dónde estaba el bus. */
function Cortes({ cortes, t, elegir }) {
  const [rapidas, setRapidas] = useState(true)
  const lista = rapidas ? cortes : cortes.filter(c => c.fuera >= RAPIDA)
  const sinConexion = cortes.reduce((a, c) => a + c.fuera, 0)
  const actual = lista.filter(c => c.t <= t).at(-1)
  return (
    <div className="card cortes">
      <h3>
        Cortes de conexión <span className="sutil">{cortes.length} en el rango · {duracion(sinConexion)} sin socket</span>
      </h3>
      {cortes.length === 0 ? (
        <p className="nota">El socket no se cayó en este rango.</p>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={rapidas} onChange={e => setRapidas(e.target.checked)} /> incluir las que reconectan en menos de 5 s</label>
          <div className="cortes-tabla">
            <table className="tabla-geo">
              <thead><tr><th>Se cae</th><th>Por qué</th><th>Sin conexión</th><th>Vuelve</th><th>Señal</th><th>Bus</th></tr></thead>
              <tbody>
                {lista.map(c => (
                  <tr key={c.t} className={`${c === actual ? 'actual' : ''} ${graveCorte(c) ? 'grave' : ''}`} onClick={() => elegir(c)}>
                    <td>{horaLog(c.t)} <span className="sutil">SID {c.sid}</span></td>
                    <td className="nombre">
                      {porQueSeCorta(c)}
                      {c.pista && <b className="mal"> · {c.pista}</b>}
                      {c.intentos > 0 && <span className="sutil"> · {c.intentos} intentos fallidos{c.motivos.length ? `: ${c.motivos.join(' / ')}` : ''}</span>}
                    </td>
                    <td className={graveCorte(c) ? 'mal' : ''}>{duracion(c.fuera)}</td>
                    <td>{c.vuelve != null ? `${horaLog(c.vuelve)}${c.sidNuevo ? ` SID ${c.sidNuevo}` : ''}` : <b className="mal">no vuelve</b>}</td>
                    <td>{c.senal != null ? `${c.senal} dBm` : '—'}</td>
                    <td>{c.p ? `${c.p.vel} km/h` : <span className="sutil">sin posición</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function popupCorte(c) {
  const fila = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`
  const lineas = c.lineas
    .map(e => `<div class="${e.propia ? 'propia' : ''}"><span>${horaLog(e.t)}</span> [${esc(e.tag)}] ${esc(e.msg)}</div>`)
    .join('')
  return `<b style="color:${graveCorte(c) ? '#dc2626' : '#d97706'}">Se corta el socket SID ${c.sid} · ${horaLog(c.t)}</b><table>
    ${fila('Por qué', `<b>${esc(porQueSeCorta(c))}</b>`)}
    ${c.pista ? fila('Pista', `<b style="color:#dc2626">${esc(c.pista)}</b>`) : ''}
    ${fila('Último msj. servidor', c.ultimoRx ? `${horaLog(c.ultimoRx)} (${duracion(c.t - c.ultimoRx)} antes)` : '—')}
    ${fila('Sin conexión', `<b>${duracion(c.fuera)}</b>`)}
    ${fila('Reconecta', c.vuelve != null ? `${horaLog(c.vuelve)}${c.sidNuevo ? ` · SID ${c.sidNuevo}` : ''}` : '<b>no vuelve hasta el fin del log</b>')}
    ${c.intentos ? fila('Intentos fallidos', `${c.intentos}${c.motivos.length ? ` · ${esc(c.motivos.join(' / '))}` : ''}`) : ''}
    ${fila('Equipo', `${c.senal != null ? `señal ${c.senal} dBm` : 'señal ?'} · batería ${c.bateria ?? '?'}%${c.online === false ? ' · <b>online=false</b>' : ''}`)}
    ${c.p ? fila('Bus', `${horaLog(c.p.t)} · ${c.p.vel} km/h`) : ''}
    </table><div class="pin-log">${lineas}</div><div class="sutil">El log de la derecha queda en esta línea.</div>`
}

function popupApagado(a) {
  const color = a.tipo === 'reinicio' ? '#d97706' : '#7f1d1d'
  return `<b style="color:${color}">⏻ ${esc(a.titulo)}</b><div class="sutil">${horaLog(a.t)} → vuelve ${horaLog(a.vuelve)} · ${duracion(a.fuera)} sin equipo</div>
    <ul class="pin-detalle">${a.detalle.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`
}

/** Apagados del equipo y reinicios de la app en el rango, con el porqué. */
function Apagados({ apagados, elegir }) {
  if (!apagados.length) return null
  return (
    <div className="card apagados">
      <h3>Apagados y reinicios del equipo <span className="sutil">{apagados.length} en el rango</span></h3>
      <table className="tabla-geo">
        <thead><tr><th>Se apaga</th><th>Qué pasó</th><th>Apagado</th><th>Vuelve</th><th>Batería</th></tr></thead>
        <tbody>
          {apagados.map(a => (
            <tr key={a.t} className={a.tipo === 'reinicio' ? '' : 'grave'} onClick={() => elegir(a)} title={a.detalle.join('\n')}>
              <td>{horaLog(a.t)}</td>
              <td className="nombre"><b className={a.tipo === 'reinicio' ? '' : 'mal'}>{a.titulo}</b><div className="sutil">{a.detalle[0]}</div></td>
              <td>{duracion(a.fuera)}</td>
              <td>{horaLog(a.vuelve)}</td>
              <td>
                {a.bateria != null ? `${a.bateria}%${a.cargaba === false ? ' sin cargar' : a.cargaba ? ' cargando' : ''}` : '—'}
                {a.bateriaVuelve != null && <span className="sutil"> → {a.bateriaVuelve}%{a.cargaVuelve ? ' cargando' : ''}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "[RECIBIDO]| #81 | SID:1 | 25B | mark [DATA]: {...}" → "← mark {...}" para que se lea lo importante. */
const corto = msg => msg.replace(/^\[RECIBIDO\]\| #\d+ \| SID:\d+ \| \d+B \| (\w+) \[DATA\]: /, '← $1 ').replace(/^\[ENVIADO\] \| \[NUEVO\] \(\d+B\) \[KEY\]: (\w+) \[DATA\]: /, '→ $1 ')

function Buscador({ consulta, setConsulta, busqueda, elegir, encuadrar }) {
  const { hallados, total } = busqueda
  return (
    <div className="card buscador">
      <h3>Buscar en el log <span className="sutil">{consulta.trim().length >= 3 ? `${total} en el rango` : 'comando o texto'}</span></h3>
      <div className="fila">
        <input value={consulta} placeholder="driver_login, operation, Watchdog, un id…" onChange={e => setConsulta(e.target.value)} />
        {consulta && <button onClick={() => setConsulta('')} title="Limpiar">✕</button>}
      </div>
      <div className="atajos">
        {ATAJOS.map(([txt, q]) => <button key={q} className={consulta === q ? 'on' : ''} onClick={() => setConsulta(consulta === q ? '' : q)}>{txt}</button>)}
      </div>
      {hallados.length > 0 && (
        <>
          <div className="fila">
            <button onClick={encuadrar}>Ver todos en el mapa</button>
            {total > hallados.length && <span className="sutil">se muestran los primeros {hallados.length}</span>}
          </div>
          <ol className="hallados">
            {hallados.map(h => (
              <li key={h.n} onClick={() => elegir(h)} title={h.msg}>
                <span className="pin-num">{h.n}</span>
                <span className="h">{horaLog(h.t)}</span>
                <span className="m"><b>{h.tag}</b> {corto(h.msg).slice(0, 160)}</span>
                {!h.p && <span className="sutil">sin posición</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

/** Pines numerados de la búsqueda; los que caen en la misma posición comparten pin. */
function pinesBusqueda(hallados, ir) {
  const capa = L.layerGroup()
  const refs = {}
  const grupos = new Map()
  for (const h of hallados) if (h.p) grupos.set(h.p, [...(grupos.get(h.p) ?? []), h])
  for (const [p, hs] of grupos) {
    const icono = L.divIcon({ className: 'pin-busqueda', html: `<span>${hs[0].n}${hs.length > 1 ? `+${hs.length - 1}` : ''}</span>`, iconSize: null, iconAnchor: [2, 26], popupAnchor: [10, -24] })
    const lineas = hs.map(h => `<div class="pin-linea"><b>#${h.n} ${horaLog(h.t)}</b> [${esc(h.tag)}] ${esc(corto(h.msg).slice(0, 220))}</div>`).join('')
    const m = L.marker([p.lat, p.lng], { icon: icono, zIndexOffset: 1000 })
      .bindPopup(`${lineas}<div class="sutil">bus a las ${horaLog(p.t)} · ${p.vel} km/h</div>`, { maxWidth: 420 })
      .on('click', () => ir(hs[0].t))
      .addTo(capa)
    for (const h of hs) refs[h.n] = m
  }
  return { capa, refs }
}

function descargar(datos, tipo, nombre) {
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

/** ¿Hay recorrido en el rango? Cuántas posiciones, desde/hasta cuándo, huecos, y bajarlo en CSV. */
function Cobertura({ r, rep, desde, hasta }) {
  const { pos, huecos } = r
  const sinGps = huecos.reduce((a, h) => a + Math.min(h.b.t, hasta) - Math.max(h.a.t, desde), 0)
  const bajar = () =>
    descargar(aCsv(pos), 'text/csv', `recorrido_${rep.info.padron ?? 'equipo'}_${new Date(desde).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '_')}-${horaLog(hasta).replace(/:/g, '').slice(0, 4)}.csv`)
  return (
    <div className="card">
      <h3>Cobertura del rango <button onClick={bajar}>⬇ CSV ({pos.length})</button></h3>
      <div className="dato"><b>{pos.length}</b> posiciones · primera <b>{horaLog(pos[0].t)}</b> · última <b>{horaLog(pos.at(-1).t)}</b></div>
      <div className="dato">
        {huecos.length ? <>Huecos &gt; 2 min: <b className="mal">{huecos.length}</b> ({duracion(sinGps)} sin posiciones)</> : <b className="ok">Sin huecos de más de 2 min</b>}
        {pos[0].t - desde > 120_000 && <span className="sutil"> · empieza {duracion(pos[0].t - desde)} después del inicio del rango</span>}
      </div>
    </div>
  )
}

const diaHora = t => `${fechaLog(t).slice(0, 5)} ${hm(t)}`
const etiquetaViaje = v =>
  [
    `Viaje ${v.trip}`,
    v.salida && `lado ${v.salida.lado ? 'B' : 'A'}${v.salida.inicio != null ? ` · salida ${diaHora(v.salida.inicio)}` : ''}`,
    `${v.n} posiciones`,
    v.desde != null && (fechaLog(v.desde) === fechaLog(v.hasta) ? `${diaHora(v.desde)}–${hm(v.hasta)}` : `${diaHora(v.desde)} – ${diaHora(v.hasta)}`),
  ]
    .filter(Boolean)
    .join(' · ')

/** Elegir un viaje (de todo el log, no solo del rango) y bajar sus posiciones en Excel. */
function ExportarViaje({ r, rep, t }) {
  const [elegido, setElegido] = useState(null)
  if (!r.trips.length) return null
  const enCursor = String(r.pos[posicionEn(r.pos, t, Infinity)]?.trip)
  const v = r.trips.find(x => x.trip === (elegido ?? enCursor)) ?? r.trips[0]
  const bajar = () => descargar(libroXlsx(excelViaje(r, v.trip)), XLSX_MIME, `viaje_${v.trip}_padron_${rep.info.padron ?? 'equipo'}.xlsx`)
  return (
    <div className="card exportar-viaje">
      <h3>Exportar viaje a Excel <span className="sutil">{r.trips.length} viajes con posiciones en el log</span></h3>
      <div className="fila">
        <select value={v.trip} onChange={e => setElegido(e.target.value)}>
          {r.trips.map(x => <option key={x.trip} value={x.trip}>{etiquetaViaje(x)}</option>)}
        </select>
        <button onClick={bajar}>⬇ Excel</button>
      </div>
      <div className="dato">
        Una fila por posición enviada, con la geocerca que vio el equipo y la hora que estampó la central
        {r.viajes.some(x => x.trip === v.trip) ? '; segunda hoja con el viaje geocerca por geocerca.' : '.'}
        {v.adelantadas > 0 && <> <b className="mal">{v.adelantadas} con hora adelantada</b> (en rojo).</>}
      </div>
    </div>
  )
}

function Veredicto({ v }) {
  if (!v.total) return <div className="card"><h3>Geocercas</h3><p className="nota">La central no envió ninguna marca (<code>mark</code>) en este log.</p></div>
  const titulo = { ninguno: 'Marcas correctas', central: 'Desfase de la CENTRAL', revisar: 'Desfase: revisar el equipo' }[v.culpa]
  return (
    <div className={`card veredicto ${v.culpa}`}>
      <h3>{titulo} <span className="sutil">{v.buenas} bien · {v.malas} desfasadas · {v.total} marcas</span></h3>
      {v.malas > 0 && (
        <ul>
          <li>Offset {v.offset.dispersion <= 60_000 ? 'constante' : 'variable'} <b>{desfase(v.offset.mediana)}</b> (dispersión {duracion(v.offset.dispersion)}) entre la entrada del equipo y la hora que estampó la central.</li>
          <li>Reloj del equipo <b className={v.relojOk ? 'ok' : 'mal'}>{v.relojOk ? 'bien' : 'sospechoso'}</b>: las posiciones salen entre {duracion(v.reloj.min)} y {duracion(v.reloj.max)} después de su hora GPS{v.reloj.tarde ? `, ${v.reloj.tarde} con más de 1 min` : ''}.</li>
          <li>{v.nuncaEnviada ? <><b className="ok">El equipo nunca envió</b> una posición con la hora errónea.</> : <><b className="mal">Hay posiciones enviadas</b> cerca de la hora errónea.</>}</li>
          <li>El equipo no marca: manda <code>events=[]</code> y la central calcula la marca (<code>mark</code>).</li>
          <li><code>forward_datero</code>: {v.sinDateros}/{v.malas} desfasadas sin dateros · {v.conDateros}/{v.buenas} correctas con dateros.</li>
        </ul>
      )}
    </div>
  )
}

function TablaViaje({ v, t, ir }) {
  const actual = v.filas.filter(f => f.marca?.entrada && f.marca.entrada.t <= t).at(-1)
  return (
    <div className="card">
      <h3>Viaje {v.trip} <span className="sutil">salida {hm(v.inicio)} · lado {v.lado ? 'B' : 'A'} · conductor {v.conductor}</span></h3>
      <table className="tabla-geo">
        <thead><tr><th>#</th><th>Geocerca</th><th>Prog</th><th>Equipo</th><th>Central</th><th>Δ</th><th>Vol</th><th>Dat</th></tr></thead>
        <tbody>
          {v.filas.map(f => {
            const m = f.marca
            const st = estadoMarca(m)
            return (
              <tr key={f.orden} className={`${m?.entrada ? 'clic' : ''} ${f === actual ? 'actual' : ''}`} onClick={() => m?.entrada && ir(m.entrada.t)}>
                <td>{f.orden}</td>
                <td className="nombre">{f.nombre ?? <span className="sutil">#{f.geocerca}</span>}</td>
                <td>{hm(f.prog)}</td>
                <td>{m?.entrada ? horaLog(m.entrada.t) : '—'}</td>
                <td className={st}>{m?.hora != null ? horaLog(m.hora) : '—'}</td>
                <td className={st}>{m?.delta != null ? desfase(m.delta) : ''}</td>
                <td>{m?.volada ?? ''}</td>
                <td>{m?.dateros ? m.dateros.length : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function popupGeocerca(g, r) {
  const m = g.marca
  const st = estadoMarca(m)
  const p = g.p
  const fila = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`
  return `<b>${esc(g.nombre)}</b>${m ? ` · geocerca ${m.geocerca}` : ''}<table>
    ${fila('Equipo entra', `<b>${horaLog(g.t)}</b> (acc ${g.acc} m)`)}
    ${fila('Equipo sale', g.salida ? horaLog(g.salida.t) : '—')}
    ${fila('Central marca', m ? `<b style="color:${COLOR[st]}">${horaLog(m.hora)}</b> (llegó ${horaLog(m.t)})` : '<i>sin marca</i>')}
    ${m ? fila('Diferencia', `<b style="color:${COLOR[st]}">${desfase(m.delta)}</b>`) + fila('Volada', m.volada) + fila('Dateros', m.dateros ? m.dateros.join(' ') || '<i>vacío</i>' : '—') : ''}
    ${fila('Posición', `${p.lat}, ${p.lng} · ${p.vel} km/h`)}</table>`
}

function capas(r, ir) {
  const c = { ruta: L.layerGroup(), puntos: L.layerGroup(), paraderos: L.layerGroup(), geo: L.layerGroup(), casi: L.layerGroup(), paradas: L.layerGroup(), huecos: L.layerGroup(), ventas: L.layerGroup(), cortes: L.layerGroup() }
  const viajes = [...new Set(r.pos.map(p => p.trip))]
  viajes.forEach((trip, k) => {
    const color = COLOR_VIAJE[k % COLOR_VIAJE.length]
    const pts = r.pos.filter(p => p.trip === trip)
    let tramo = []
    const cerrar = () => {
      if (tramo.length < 2) return
      L.polyline(tramo, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }).addTo(c.ruta)
      L.polyline(tramo, { color, weight: 4.5, opacity: 0.95 }).bindTooltip(`Viaje ${trip}`, { sticky: true }).addTo(c.ruta)
    }
    pts.forEach((p, i) => {
      if (i && p.t - pts[i - 1].t > 120_000) (cerrar(), (tramo = []))
      tramo.push([p.lat, p.lng])
      L.circleMarker([p.lat, p.lng], { radius: 2.5, color, weight: 1, fillOpacity: 0.9 })
        .bindPopup(`<b>${horaLog(p.t)}</b> · viaje ${p.trip} · ${p.estado}<br>${p.vel} km/h · acc ${p.acc} m · ${p.ang}°<br>enviada ${horaLog(p.enviada)}`)
        .on('click', () => ir(p.t))
        .addTo(c.puntos)
    })
    cerrar()
  })
  for (const p of r.paraderos) {
    const color = p.lado ? '#ea580c' : '#64748b'
    L.circle([p.lat, p.lng], { radius: p.radio, color, weight: 1, dashArray: '3 3', fillOpacity: 0.05, interactive: false }).addTo(c.paraderos)
    L.circleMarker([p.lat, p.lng], { radius: 3, color, fillOpacity: 1 })
      .bindPopup(`<b>Paradero ${esc(p.nombre)}</b><br>lado ${p.lado ? 'B' : 'A'} · orden ${p.orden} · radio ${p.radio} m${p.terminal ? ' · terminal' : ''}${p.liquidar ? ' · liquidar' : ''}`)
      .addTo(c.paraderos)
  }
  const refs = {}
  for (const g of r.entra) {
    const p = g.p
    if (!p) continue
    const st = estadoMarca(g.marca)
    const color = COLOR[st]
    const grupo = L.layerGroup().addTo(c.geo)
    L.circle([p.lat, p.lng], { radius: g.radio, color, weight: 2, fillOpacity: 0.15, interactive: false }).addTo(grupo)
    const s = g.salida?.p
    if (s) {
      L.polyline([[p.lat, p.lng], [s.lat, s.lng]], { color, weight: 5, opacity: 0.6 }).addTo(grupo)
      L.circleMarker([s.lat, s.lng], { radius: 4, color, fillColor: '#fff', fillOpacity: 1 }).bindPopup(`<b>${esc(g.nombre)}</b> sale ${horaLog(g.salida.t)}`).addTo(grupo)
    }
    const etiqueta = `${g.nombre} ${hm(g.t)}${st === 'mal' ? ` ⚠ ${hm(g.marca.hora)}` : ''}`
    refs[g.t] = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
      .bindPopup(popupGeocerca(g, r))
      .bindTooltip(etiqueta, { permanent: true, direction: 'right', className: 'geo-lbl', offset: [8, 0] })
      .on('click', () => ir(g.t))
      .addTo(grupo)
  }
  for (const x of r.casi) {
    const p = x.p
    if (p) L.circleMarker([p.lat, p.lng], { radius: 4, color: '#d97706', fillOpacity: 0.8 }).bindPopup(`<b>CASI marca</b> ${esc(x.nombre)}<br>${horaLog(x.t)} · ${x.dist} m de ${x.radio} m`).addTo(c.casi)
  }
  for (const d of r.paradas) {
    const min = (d.b.t - d.a.t) / 60_000
    L.circleMarker([d.a.lat, d.a.lng], { radius: Math.min(16, 5 + min), color: '#c2410c', weight: 2, fillOpacity: 0.3 })
      .bindPopup(`<b>Detenido ${duracion(d.b.t - d.a.t)}</b><br>${horaLog(d.a.t)} → ${horaLog(d.b.t)} · ${d.n} posiciones`)
      .on('click', () => ir(d.a.t))
      .addTo(c.paradas)
  }
  for (const h of r.huecos)
    L.polyline([[h.a.lat, h.a.lng], [h.b.lat, h.b.lng]], { color: '#dc2626', dashArray: '6 6', weight: 2 })
      .bindPopup(`<b>Sin posiciones ${duracion(h.b.t - h.a.t)}</b><br>${horaLog(h.a.t)} → ${horaLog(h.b.t)}`)
      .addTo(c.huecos)
  for (const v of r.ventas) {
    const p = v.p
    if (p) L.circleMarker([p.lat, p.lng], { radius: 3, color: v.impresa ? '#0d9488' : '#dc2626', fillOpacity: 1 }).bindPopup(`Venta ${v.impresa ? 'impresa' : 'NO impresa'} ${horaLog(v.t)}<br>${esc(v.nombre)} S/${v.tarifa}`).addTo(c.ventas)
  }
  for (const a of r.apagados) {
    if (!a.p) continue
    const icono = L.divIcon({ className: `pin-apagado ${a.tipo}`, html: '<span>⏻</span>', iconSize: null, iconAnchor: [13, 13], popupAnchor: [0, -12] })
    refs[`apagado${a.t}`] = L.marker([a.p.lat, a.p.lng], { icon: icono, zIndexOffset: 1100 })
      .bindPopup(popupApagado(a), { maxWidth: 480, minWidth: 320 })
      .bindTooltip(`${horaLog(a.t)} ${a.titulo}`, { direction: 'top', offset: [0, -12] })
      .on('click', () => ir(a.t))
      .addTo(c.cortes)
  }
  for (const x of r.cortes) {
    const grave = graveCorte(x)
    // Lo que recorrió el bus mientras estuvo sin socket.
    if (x.fuera >= RAPIDA && x.tramo.length > 1)
      L.polyline(x.tramo.map(p => [p.lat, p.lng]), { color: grave ? '#dc2626' : '#d97706', weight: 7, opacity: 0.75, dashArray: '2 9', lineCap: 'round' })
        .bindTooltip(`sin conexión ${horaLog(x.t)} → ${x.vuelve != null ? horaLog(x.vuelve) : 'fin'} (${duracion(x.fuera)})`, { sticky: true })
        .on('click', () => ir(x.t))
        .addTo(c.cortes)
    if (!x.p) continue
    const icono = L.divIcon({ className: `pin-corte ${grave ? 'grave' : x.fuera >= RAPIDA ? '' : 'rapida'}`, html: '<span>⚡</span>', iconSize: null, iconAnchor: [11, 11], popupAnchor: [0, -10] })
    refs[`corte${x.t}`] = L.marker([x.p.lat, x.p.lng], { icon: icono, zIndexOffset: grave ? 900 : 500 })
      .bindPopup(popupCorte(x), { maxWidth: 560, minWidth: 360 })
      .bindTooltip(`${horaLog(x.t)} se corta · ${duracion(x.fuera)} sin conexión`, { direction: 'top', offset: [0, -10] })
      .on('click', () => ir(x.t))
      .addTo(c.cortes)
  }
  return { c, refs }
}

function Mapa({ r, t, ir, foco, hallados, ancho, setAncho }) {
  const div = useRef(null)
  const mapa = useRef(null)
  const bus = useRef(null)
  const marcadores = useRef({})
  const pines = useRef({})
  const irRef = useRef(ir)
  irRef.current = ir
  const [seguir, setSeguir] = useState(false)

  const control = useRef(null)
  const visibles = useRef(new Set(['Recorrido', 'Paraderos', 'Geocercas equipo vs central', 'Detenciones ≥ 1 min', 'Huecos GPS > 2 min', 'Cortes y apagados']))

  useEffect(() => {
    const m = L.map(div.current)
    const esri = s => `https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`
    const bases = {
      'Calles (gris)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'tiles-gris' }).addTo(m),
      Calles: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
      'Calles (Esri)': L.tileLayer(esri('World_Street_Map'), { maxZoom: 19, attribution: '© Esri' }),
      Satélite: L.tileLayer(esri('World_Imagery'), { maxZoom: 19, attribution: '© Esri' }),
    }
    control.current = L.control.layers(bases, {}).addTo(m)
    m.on('overlayadd', e => visibles.current.add(e.name))
    m.on('overlayremove', e => visibles.current.delete(e.name))
    const etiquetas = () => div.current?.classList.toggle('sin-etiquetas', m.getZoom() < 14)
    m.on('zoomend', etiquetas)
    m.setView([-12.05, -77.03], 12)
    etiquetas()
    bus.current = L.circleMarker([0, 0], { radius: 9, color: '#0f172a', weight: 3, fillColor: '#facc15', fillOpacity: 1 }).bindTooltip('', { direction: 'top', offset: [0, -10] }).addTo(m)
    mapa.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(div.current)
    return () => {
      ro.disconnect()
      mapa.current = null
      m.remove()
    }
  }, [])

  useEffect(() => {
    const m = mapa.current
    const { c, refs } = capas(r, x => irRef.current(x))
    marcadores.current = refs
    const nombres = {
      Recorrido: c.ruta, 'Posiciones (puntos)': c.puntos, Paraderos: c.paraderos, 'Geocercas equipo vs central': c.geo,
      'CASI marca': c.casi, 'Detenciones ≥ 1 min': c.paradas, 'Huecos GPS > 2 min': c.huecos, Ventas: c.ventas, 'Cortes y apagados': c.cortes,
    }
    for (const [nombre, capa] of Object.entries(nombres)) {
      control.current.addOverlay(capa, nombre)
      if (visibles.current.has(nombre)) capa.addTo(m)
    }
    m.fitBounds(L.latLngBounds(r.pos.map(p => [p.lat, p.lng])), { padding: [20, 20], animate: false })
    bus.current.bringToFront()
    return () => {
      if (!mapa.current) return
      for (const [nombre, capa] of Object.entries(nombres)) {
        control.current.removeLayer(capa)
        const ver = m.hasLayer(capa)
        m.removeLayer(capa)
        if (ver) visibles.current.add(nombre)
      }
    }
  }, [r])

  useEffect(() => {
    const { capa, refs } = pinesBusqueda(hallados, x => irRef.current(x))
    pines.current = refs
    capa.addTo(mapa.current)
    return () => mapa.current?.removeLayer(capa)
  }, [hallados])

  useEffect(() => {
    if (!foco) return
    if (foco.todos) {
      const pts = hallados.filter(h => h.p).map(h => [h.p.lat, h.p.lng])
      if (pts.length) mapa.current.flyToBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17, duration: 0.6 })
      return
    }
    const pin = foco.pin != null ? pines.current[foco.pin] : null
    if (pin) {
      mapa.current.flyTo(pin.getLatLng(), Math.max(mapa.current.getZoom(), 16), { duration: 0.6 }).once('moveend', () => pin.openPopup())
      return
    }
    const g = marcadores.current[foco.corte ? `corte${foco.t}` : foco.apagado ? `apagado${foco.t}` : foco.t]
    const p = r.pos[posicionEn(r.pos, foco.t)]
    if (g) mapa.current.flyTo(g.getLatLng(), 17, { duration: 0.6 }).once('moveend', () => g.openPopup())
    else if (p) mapa.current.flyTo([p.lat, p.lng], 17, { duration: 0.6 })
  }, [foco, r])

  useEffect(() => {
    const k = posicionEn(r.pos, t, Infinity)
    const p = r.pos[k]
    if (!p || !bus.current) return
    bus.current.setLatLng([p.lat, p.lng]).setTooltipContent(`${horaLog(p.t)} · ${p.vel} km/h${Math.abs(p.t - t) > 120_000 ? ' · sin posición cerca' : ''}`)
    if (seguir) mapa.current.panTo([p.lat, p.lng], { animate: false })
  }, [r, t, seguir])

  return (
    <div className="mapa-caja">
      <div ref={div} className="mapa-leaflet" />
      <div className="mapa-botones">
        <label className="check"><input type="checkbox" checked={seguir} onChange={e => setSeguir(e.target.checked)} /> seguir al bus</label>
        <button onClick={() => setAncho(!ancho)}>{ancho ? '⇤ mostrar panel' : '⤢ ampliar mapa'}</button>
      </div>
      <div className="leyenda-mapa">
        <span><i style={{ background: COLOR.ok }} /> marca bien</span>
        <span><i style={{ background: COLOR.mal }} /> central con otra hora</span>
        <span><i style={{ background: COLOR.sin }} /> sin marca</span>
        <span><i style={{ background: '#facc15', border: '2px solid #0f172a' }} /> bus en la hora elegida</span>
        {r.cortes.length > 0 && <span>⚡ se corta la conexión <span className="sutil">(punteado = tramo sin socket)</span></span>}
        {r.apagados.length > 0 && <span>⏻ equipo apagado / reiniciado</span>}
        {hallados.length > 0 && <span><i style={{ background: '#7c3aed' }} /> búsqueda</span>}
      </div>
    </div>
  )
}
