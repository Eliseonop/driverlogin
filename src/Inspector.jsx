import { useState } from 'react'
import { horaLog } from './log/leer.js'
import { soles } from './log/cuadre.js'
import { informeTexto } from './log/inspector.js'

const hora = f => (horaLog(f.desde) === horaLog(f.hasta) ? horaLog(f.desde) : `${horaLog(f.desde)} – ${horaLog(f.hasta)}`)
const ESTADO = { impreso: 'impreso', repetido: 'repetido', rechazado: 'rechazado', 'no-impreso': 'no impreso', imprimiendo: 'sin resultado', pedido: 'sin rastro' }

export default function Inspector({ rep, verEnSesion }) {
  const inf = rep.inspector
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(informeTexto(inf))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {}
  }
  const boletos = [...inf.boletos, ...inf.sinToque].sort((a, b) => a.i - b.i)
  return (
    <div className="cuadre">
      <div className="cuadre-resumen">
        <div>
          <h2>Inspector</h2>
          <p className="nota">
            Lo que pidió cada inspector: <b>print_qr</b> (papel QR + PIN, validador o pantalla) y los <b>boletos</b> que mandó imprimir por el servidor
            (print_ticket) o por Bluetooth. Esos boletos salen sin toque del chofer y suman a su venta. También aparecen los boletos impresos sin toque que
            no pidió un inspector.
          </p>
        </div>
        <div className="cuadre-cifras">
          {inf.inspectores.map(s => (
            <span key={s.inspector} className="cifra">
              inspector <b>{s.inspector}</b> · {s.qr} QR · {s.boletos} boletos <b>{soles(s.monto)}</b>
            </span>
          ))}
          {inf.sinToque.length > 0 && <span className="cifra mal"><b>{inf.sinToque.length}</b> sin toque ni inspector</span>}
        </div>
      </div>
      {inf.filas.length === 0 ? (
        <div className="card"><p className="nota">El log no tiene print_qr, print_ticket, pedidos por Bluetooth ni boletos impresos sin toque.</p></div>
      ) : (
        <>
          <div className="card tabla-caja">
            <h3>
              Informe <button onClick={copiar} title="Copiar como texto con tabulaciones (chat, Excel)">{copiado ? '✓ Copiado' : '📋 Copiar tabla'}</button>
            </h3>
            <table className="tabla-ses">
              <thead>
                <tr><th>Hora</th><th>Pedido</th><th>Qué salió</th><th className="n">Suma a la venta</th></tr>
              </thead>
              <tbody>
                {inf.filas.map((f, k) => (
                  <tr key={k} className={f.mal ? 'est-mal' : ''} onClick={() => verEnSesion(f.desde)} title="Ver en Sesión">
                    <td className="mono">{hora(f)}</td>
                    <td>{f.pedido}</td>
                    <td className="por-que">{f.salio}</td>
                    <td className="n mono">{f.monto ? soles(f.monto) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {boletos.length > 0 && (
            <div className="card tabla-caja">
              <h3>Boletos, uno por uno</h3>
              <table className="tabla-ses">
                <thead>
                  <tr><th>Hora</th><th>Origen</th><th>Inspector</th><th>uid</th><th>Boleto</th><th className="n">Número</th><th className="n">Correlativo</th><th>Estado</th><th>Respuesta al servidor</th></tr>
                </thead>
                <tbody>
                  {boletos.map((p, k) => (
                    <tr key={k} className={p.estado !== 'impreso' || p.tipo === 'sinToque' ? 'est-mal' : ''} onClick={() => verEnSesion(p.t)}>
                      <td className="mono">{horaLog(p.t)}</td>
                      <td>{p.tipo === 'sinToque' ? `sin toque (${p.pago ?? '?'})` : p.origen}</td>
                      <td className="mono">{p.inspector ?? '—'}</td>
                      <td className="mono">{p.uid ?? '—'}</td>
                      <td>{p.nombre ?? `tarifa ${p.fare}`}{p.monto != null && <span className="sutil"> {soles(p.monto)}</span>}</td>
                      <td className="n mono">{p.numero ?? '—'}</td>
                      <td className="n mono">{p.correlativo ?? '—'}</td>
                      <td>{ESTADO[p.estado]}{p.motivo ? ` · ${p.motivo}` : ''}{p.confirmado === false ? ' · sin estado de impresora' : ''}</td>
                      <td className="mono">{p.origen === 'servidor' ? (p.respondido ? horaLog(p.respondido) : 'no respondió') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
