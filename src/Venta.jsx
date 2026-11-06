import { duracion, horaLog } from './log/leer.js'
import { textoModo } from './log/venta.js'

const RECHAZO = { ocupada: 'imprimía el anterior', llena: 'cola llena', cerrando: 'liquidando la sesión', otro: 'otro motivo' }
const ORIGEN = { operation: 'central (operation)', pantalla: 'pantalla de impresora' }
const porQue = t =>
  t.modo == null ? '' : t.deducido ? 'deducido de cada boleto (FLUJO F2)' : t.modo === 'directa' ? 'la impresora no dice su estado' : t.porQue === 'forzada' ? 'cola_forzada' : 'la impresora dice su estado'
const rango = (a, b) => (horaLog(a) === horaLog(b) ? horaLog(a) : `${horaLog(a)} – ${horaLog(b)}`)
const ms = v => (v == null ? '—' : `${v.toLocaleString()} ms`)

export default function Venta({ rep, verEnSesion }) {
  const v = rep.venta
  const actual = v.tramos.at(-1)
  const impresora = v.impresoras.at(-1)
  const conBoletos = v.tramos.filter(t => t.encoladas || t.rechazadas)
  const tope = Math.max(1, ...conBoletos.map(t => t.colaMax ?? 0))
  const ocupacion = Object.entries(v.porOcupacion).map(([n, c]) => [+n, c]).sort((a, b) => a[0] - b[0])
  const maxBarra = Math.max(1, ...ocupacion.map(([, c]) => c))
  const toquesMal = Object.entries(v.resultadoToque).filter(([r]) => r !== 'OK')
  return (
    <div className="cuadre">
      <div className="cuadre-resumen">
        <div>
          <h2>Cómo vendía</h2>
          <p className="nota">
            <b>Directa</b>: un boleto a la vez; un toque mientras imprime se rechaza. <b>En cola</b>: los toques esperan su turno hasta <b>cola_max</b> boletos
            contando el que imprime. Lo decide la impresora (si dice su estado, cola) salvo con <b>cola_forzada</b>.
          </p>
        </div>
        <div className="cuadre-cifras">
          <span className="cifra">al final del log <b>{actual ? textoModo(actual) : 'sin dato'}</b></span>
          {impresora && <span className="cifra">impresora <b>{impresora.nombre || impresora.id}</b> · {impresora.nivel}</span>}
          {v.maxOcupacion != null && <span className="cifra">cola máx. vista <b>{v.maxOcupacion}</b>{v.maxOcupacion > 1 || tope > 1 ? ` de ${tope}` : ''}</span>}
          {v.encoladas.length > 0 && <span className="cifra"><b>{v.encoladas.filter(e => e.ocupacion > 1).length}</b> esperaron detrás de otro</span>}
          {v.rechazos.length > 0 && <span className="cifra mal"><b>{v.rechazos.length}</b> {v.rechazos.length === 1 ? 'toque rechazado' : 'toques rechazados'}</span>}
          {v.ms.mediana != null && <span className="cifra">imprimir <b>{ms(v.ms.mediana)}</b> mediana · p90 {ms(v.ms.p90)} · máx {ms(v.ms.max)}</span>}
          {v.tiempoImpresion.length > 0 && <span className="cifra">pulsación mínima <b>{v.tiempoImpresion.join(' / ')} ms</b></span>}
        </div>
      </div>

      <div className="card tabla-caja">
        <h3>Modo de venta en el tiempo</h3>
        {v.tramos.length === 0 ? (
          <p className="nota">El log no dice el modo: no tiene "SDK de impresión" (1.1.2+) ni boletos con su línea FLUJO.</p>
        ) : (
          <table className="tabla-ses">
            <thead>
              <tr><th>Hora</th><th>Modo</th><th>Por qué</th><th className="n">Impresos</th><th className="n">Esperaron detrás</th><th className="n">Cola máx.</th><th className="n">Rechazados</th></tr>
            </thead>
            <tbody>
              {v.tramos.map((t, k) => {
                const vacio = !t.encoladas && !t.rechazadas
                return (
                  <tr key={k} className={vacio ? 'est-solo' : ''} onClick={() => verEnSesion(t.desde)} title={`${duracion(t.hasta - t.desde)} · ver en Sesión`}>
                    <td className="mono">{rango(t.desde, t.hasta)}</td>
                    <td><b>{textoModo(t)}</b></td>
                    <td className="por-que">{porQue(t)}{vacio && t.hasta - t.desde < 60_000 ? ' · al arrancar, antes de leer la impresora' : ''}</td>
                    <td className="n mono">{t.impresas}</td>
                    <td className="n mono">{t.modo === 'directa' ? '—' : t.detras}</td>
                    <td className="n mono">{t.encoladas ? `${t.maxOcupacion}${t.colaMax ? ` de ${t.colaMax}` : ''}` : '—'}</td>
                    <td className="n mono">{t.rechazadas || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="dos-col cuadre-cols">
        <div className="card tabla-caja">
          <h3>Cola al entrar cada boleto <span className="sutil">contando el que imprimía</span></h3>
          {ocupacion.length === 0 ? (
            <p className="nota">Sin boletos encolados ([VENTA] ENCOLADA).</p>
          ) : (
            <table className="tabla-ses">
              <tbody>
                {ocupacion.map(([n, c]) => (
                  <tr key={n} className="est-fijo">
                    <td className="mono">{n === 1 ? '1 · imprimió enseguida' : `${n} · ${n - 1} delante`}</td>
                    <td className="barra-celda"><i className="barra" style={{ width: `${(c / maxBarra) * 100}%` }} /></td>
                    <td className="n mono">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(v.rechazos.length > 0 || toquesMal.length > 0 || v.canceladas > 0) && (
            <div className="dato">
              {v.rechazos.length > 0 && <>Rechazados: {Object.entries(contar(v.rechazos.map(r => r.tipo))).map(([t, c]) => `${c} ${RECHAZO[t]}`).join(' · ')}. </>}
              {v.canceladas > 0 && <>{v.canceladas} cancelados en cola. </>}
              {toquesMal.length > 0 && <>Toques sin venta: {toquesMal.map(([r, c]) => `${c} ${r}`).join(' · ')}.</>}
            </div>
          )}
          {Object.keys(v.porConfirma).length > 0 && (
            <div className="dato">Cómo confirmó el papel: {Object.entries(v.porConfirma).map(([c, n]) => `${n} ${c}`).join(' · ')}</div>
          )}
        </div>

        <div className="card tabla-caja">
          <h3>Quién cambió la configuración</h3>
          {v.cambios.length === 0 ? (
            <p className="nota">Sin operation ni cambios desde la pantalla de impresora en este log.</p>
          ) : (
            <table className="tabla-ses">
              <thead><tr><th>Hora</th><th>Desde</th><th>Qué</th><th>Efecto</th></tr></thead>
              <tbody>
                {v.cambios.map((c, k) => (
                  <tr key={k} onClick={() => verEnSesion(c.t)}>
                    <td className="mono">{horaLog(c.t)}</td>
                    <td>{ORIGEN[c.origen]}</td>
                    <td className="mono">{c.clave}={c.valor}</td>
                    <td className="por-que">{c.efecto ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {v.salud && (
            <div className="dato">
              Salud {horaLog(v.salud.t)}: {Object.entries(v.salud.valores).map(([k, x]) => `${k}=${x.valor} (${x.origen})`).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {v.impresoras.length > 0 && (
        <div className="card tabla-caja">
          <h3>Impresoras que leyó</h3>
          <table className="tabla-ses">
            <thead><tr><th>Hora</th><th>USB</th><th>Nombre</th><th>Nivel</th><th>Qué dice</th><th>Comandos</th><th className="n">Veces</th></tr></thead>
            <tbody>
              {v.impresoras.map((p, k) => (
                <tr key={k} onClick={() => verEnSesion(p.desde)}>
                  <td className="mono">{rango(p.desde, p.hasta)}</td>
                  <td className="mono">{p.id}</td>
                  <td>{p.nombre}</td>
                  <td><b>{p.nivel}</b></td>
                  <td className="por-que">{p.que}{p.nota ? ` · ${p.nota}` : ''}</td>
                  <td className="mono sutil">{p.soporta}</td>
                  <td className="n mono">{p.veces}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const contar = xs => xs.reduce((c, x) => ((c[x] = (c[x] ?? 0) + 1), c), {})
