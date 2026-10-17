import { useMemo, useState } from 'react'
import { duracion, fechaLog, horaLog } from './log/leer.js'
import { horaMs, soles } from './log/cuadre.js'
import { cruzar, leerPlataforma } from './log/plataforma.js'
import { ladoTxt } from './log/reconstruir.js'

const ESTADO = {
  cuadra: ['ok', '✓ Cuadra'],
  'no-cuadra': ['mal', '✗ No cuadra'],
  parcial: ['parcial', '◐ Log incompleto'],
  abierta: ['abierta', '○ Sin cierre en el log'],
  solo: ['abierta', '◌ Solo en la plataforma'],
}
const conSigno = c => (c == null ? '—' : c > 0 ? `+${soles(c)}` : c < 0 ? `−${soles(-c)}` : soles(0))
const colorLado = lado => (lado == null ? 'var(--none)' : lado ? 'var(--b)' : 'var(--a)')

export default function Cuadre({ rep, sel, setSel, verEnSesion, plataforma, setPlataforma }) {
  const leida = useMemo(() => leerPlataforma(plataforma), [plataforma])
  const { sesiones, soloPlataforma } = useMemo(() => cruzar(rep.cuadre, leida.sesiones), [rep, leida])
  const conPlataforma = leida.sesiones.length > 0
  const actual = sesiones.find(s => s.id === sel) ?? sesiones.find(s => s.estado === 'no-cuadra') ?? sesiones[0]
  return (
    <div className="cuadre">
      <ResumenDia sesiones={sesiones} conPlataforma={conPlataforma} />
      <CargaPlataforma texto={plataforma} setTexto={setPlataforma} leida={leida} sesiones={sesiones} soloPlataforma={soloPlataforma} />
      {sesiones.length + soloPlataforma.length === 0 ? (
        <div className="card"><p className="nota">El log no tiene sesiones, liquidaciones (driver_logout) ni boletos enviados (tickets): no hay nada que cuadrar.</p></div>
      ) : (
        <TablaSesiones sesiones={sesiones} soloPlataforma={soloPlataforma} conPlataforma={conPlataforma} actual={actual} setSel={setSel} />
      )}
      {actual && <Detalle key={actual.id} s={actual} padron={rep.info.padron} verEnSesion={verEnSesion} />}
    </div>
  )
}

const EJEMPLO = '{ "id": 45528, "lado": true, "inicio": "2026-10-16T17:45:05", "fin": "2026-10-16T22:02:50", "produccion": 216, "conductor": {…}, "salida": {…} }'

/** Pegar las sesiones de la plataforma (JSON o filas con inicio y fin) para cruzarlas con el log. */
function CargaPlataforma({ texto, setTexto, leida, sesiones, soloPlataforma }) {
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState('')
  const prueba = leerPlataforma(borrador)
  const abrir = () => {
    setBorrador(texto)
    setEditando(true)
  }
  const cargar = () => {
    if (prueba.error) return
    setTexto(borrador.trim())
    setEditando(false)
  }
  if (editando)
    return (
      <div className="card plataforma">
        <h3>Sesiones de la plataforma</h3>
        <p className="nota">
          Pega el <b>objeto JSON</b> de la sesión tal como lo da la plataforma: uno, un arreglo <code>[ … ]</code> o varios seguidos. También sirven
          las <b>filas de la tabla</b> de sesiones (una por línea, con inicio y fin). Se cruzan con el log por id o, si no hay, por lado y horario.
        </p>
        <textarea rows={7} value={borrador} onChange={e => setBorrador(e.target.value)} placeholder={EJEMPLO} autoFocus
          onKeyDown={e => e.key === 'Enter' && e.ctrlKey && cargar()} />
        <div className="fila plataforma-pie">
          <span className={`nota ${prueba.error ? 'mal' : ''}`}>
            {prueba.error ?? (prueba.sesiones.length ? `${prueba.sesiones.length} sesión(es) reconocida(s): ${prueba.sesiones.map(p => `#${p.id ?? '?'} ${ladoTxt(p.lado)}`).join(', ')}` : 'Ctrl+Enter para cargar')}
          </span>
          <button onClick={() => setEditando(false)}>Cancelar</button>
          <button className="primario" disabled={!!prueba.error} onClick={cargar}>{borrador.trim() ? 'Cruzar con el log' : 'Quitar'}</button>
        </div>
      </div>
    )
  if (!leida.sesiones.length)
    return (
      <button className="plataforma-abrir" onClick={abrir}>
        ＋ <b>Pegar sesiones de la plataforma</b> <span className="sutil">(JSON de la sesión o filas con inicio y fin) para ver si cuadran con el log</span>
      </button>
    )
  const pareja = p => sesiones.find(s => s.plat === p)
  return (
    <div className="card plataforma">
      <div className="fila">
        <h3>Plataforma <span className="sutil">· {leida.sesiones.length} pegada(s)</span></h3>
        <span className="plataforma-chips">
          {leida.sesiones.map((p, k) => {
            const s = pareja(p)
            return (
              <span key={k} className={`chip ${s ? '' : 'suelta'}`} title={p.conductor ?? ''}>
                #{p.id ?? '?'} {ladoTxt(p.lado)} · {soles(p.produccion)} → {s ? `log #${s.id}` : 'sin pareja en el log'}
              </span>
            )
          })}
        </span>
        <button className="chico" onClick={abrir}>Editar</button>
        <button className="chico" onClick={() => setTexto('')}>Quitar</button>
      </div>
      {soloPlataforma.length > 0 && <p className="nota">Sin pareja: su horario no cae dentro del log, o su id y su lado no coinciden con ninguna sesión del log.</p>}
    </div>
  )
}

function ResumenDia({ sesiones, conPlataforma }) {
  const n = e => sesiones.filter(s => s.estado === e).length
  const liquidado = sesiones.reduce((a, s) => a + (s.liq?.total ?? 0), 0)
  const enviado = sesiones.reduce((a, s) => a + s.montoEnv, 0)
  return (
    <div className="cuadre-resumen">
      <div>
        <h2>Cuadre de sesiones</h2>
        <p className="nota">
          Lo que el equipo <b>liquidó</b> al cerrar cada sesión (driver_logout) contra los <b>boletos que mandó</b> a la central con esa sesión, que es lo
          que suma la plataforma.
        </p>
      </div>
      <div className="cuadre-cifras">
        <span className="cifra"><b>{sesiones.length}</b> sesiones</span>
        {n('cuadra') > 0 && <span className="cifra ok"><b>{n('cuadra')}</b> cuadran</span>}
        {n('no-cuadra') > 0 && <span className="cifra mal"><b>{n('no-cuadra')}</b> no cuadran</span>}
        {n('parcial') > 0 && <span className="cifra parcial"><b>{n('parcial')}</b> log incompleto</span>}
        {n('abierta') > 0 && <span className="cifra abierta"><b>{n('abierta')}</b> sin cierre</span>}
        <span className="cifra sep">liquidado <b>{soles(liquidado)}</b></span>
        <span className="cifra">boletos <b>{soles(enviado)}</b></span>
        {conPlataforma && <span className="cifra">plataforma <b>{soles(sesiones.reduce((a, s) => a + (s.plat?.produccion ?? 0), 0))}</b></span>}
      </div>
    </div>
  )
}

function TablaSesiones({ sesiones, soloPlataforma, conPlataforma, actual, setSel }) {
  return (
    <div className="card tabla-caja">
      <table className="tabla-ses">
        <thead>
          <tr>
            <th>Estado</th>
            <th>Sesión</th>
            <th>Inicio → cierre</th>
            <th>Cerró</th>
            <th className="n">Liquidó el equipo</th>
            <th className="n" title="Liquidación impresa: se vuelve a sumar al imprimir">Papel</th>
            <th className="n">Boletos enviados</th>
            <th className="n">Diferencia</th>
            {conPlataforma && <th className="n">Plataforma</th>}
            <th>Por qué</th>
          </tr>
        </thead>
        <tbody>
          {sesiones.map(s => {
            const [cls, txt] = ESTADO[s.estado]
            const motivo = s.motivos.find(m => m.nivel !== 'info' && !m.tipo.startsWith('plataforma')) ?? s.motivos.find(m => m.nivel !== 'info')
            return (
              <tr key={s.id} className={`est-${cls} ${s === actual ? 'sel' : ''}`} onClick={() => setSel(s.id)}>
                <td><span className={`estado-tag ${cls}`}>{txt}</span></td>
                <td className="ses">
                  <i className="dot" style={{ background: colorLado(s.lado) }} /> #{s.id} <span className="sutil">{ladoTxt(s.lado)}{s.chofer ? ` · ${s.chofer}` : ''}</span>
                </td>
                <td className="mono">{s.inicio != null ? horaLog(s.inicio).slice(0, 5) : '?'} → {s.fin != null ? horaLog(s.fin).slice(0, 5) : '…'}</td>
                <td className="cerro" title={s.cerro?.deducido ? 'deducido del log: este APK no manda el tipo de cierre' : s.cerro?.codigo ? `driver_logout event=${s.cerro.codigo}` : undefined}>{s.cerro?.texto ?? ''}</td>
                <td className="n mono">{s.liq ? soles(s.liq.total) : '—'}</td>
                <td className={`n mono ${s.papel && s.liq && s.papel.total !== s.liq.total ? 'mal' : ''}`}>{s.papel ? soles(s.papel.total) : <span className="sutil">—</span>}</td>
                <td className="n mono">{soles(s.montoEnv)} <span className="sutil">({s.boletos.length})</span></td>
                <td className={`n mono ${s.dif ? 'mal' : ''}`}>{s.liq ? conSigno(s.dif) : '—'}</td>
                {conPlataforma && <td className={`n mono ${s.plat && s.liq && s.plat.produccion !== s.liq.total ? 'mal' : ''}`}>{s.plat ? soles(s.plat.produccion) : '—'}</td>}
                <td className="por-que">{motivo?.titulo ?? (s.estado === 'cuadra' ? '' : s.estado === 'abierta' ? 'La sesión no se cerró dentro del log' : '')}</td>
              </tr>
            )
          })}
          {soloPlataforma.map((p, k) => (
            <tr key={`p${k}`} className="est-solo">
              <td><span className="estado-tag abierta">{ESTADO.solo[1]}</span></td>
              <td className="ses"><i className="dot" style={{ background: colorLado(p.lado) }} /> #{p.id ?? '?'} <span className="sutil">{ladoTxt(p.lado)}{p.conductor ? ` · ${p.conductor}` : ''}</span></td>
              <td className="mono">{p.inicio != null ? `${fechaLog(p.inicio).slice(0, 5)} ${horaLog(p.inicio).slice(0, 5)}` : '?'} → {p.fin != null ? horaLog(p.fin).slice(0, 5) : '…'}</td>
              <td />
              <td className="n">—</td>
              <td className="n">—</td>
              <td className="n">—</td>
              <td className="n">—</td>
              <td className="n mono">{soles(p.produccion)}</td>
              <td className="por-que">No hay una sesión del log que le corresponda</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Detalle({ s, padron, verEnSesion }) {
  const [filtro, setFiltro] = useState(null)
  const [cls, txt] = ESTADO[s.estado]
  const nLiq = s.liq?.primero != null && s.liq.ultimo >= s.liq.primero ? s.liq.ultimo - s.liq.primero + 1 : s.tarifas.reduce((a, x) => a + (x.liq?.n ?? 0), 0)
  const corrs = s.boletos.map(b => b.correlativo)
  const fuera = s.boletos.filter(b => b.respecto && b.respecto !== 'dentro')
  return (
    <div className={`card detalle-ses est-${cls}`}>
      <div className="detalle-cab">
        <div>
          <h3 className="detalle-tit">
            <span className={`estado-tag ${cls}`}>{txt}</span>
            Sesión #{s.id}
            <span className="pill-lado" style={{ '--c': colorLado(s.lado) }}>Lado {ladoTxt(s.lado)}</span>
            {s.chofer && <span className="sutil">{s.chofer}</span>}
          </h3>
          <div className="dato">
            {s.inicio != null && <>{s.login ? 'Abrió' : 'Primer boleto'} {horaLog(s.inicio)}</>}
            {s.fin != null && <> · liquidó {horaMs(s.fin)}{s.inicio != null && ` (${duracion(s.fin - s.inicio)})`}</>}
            {s.cerro && <> · cerró por <b>{s.cerro.texto}</b>{s.cerro.deducido && <span className="sutil"> (deducido)</span>}</>}
            {s.conf && <> · central: {s.conf.titulo} {horaLog(s.conf.t)}</>}
            {s.impresas.length > 0 && <> · liquidación impresa: {s.impresas.map(x => x.texto).join(', ')}</>}
          </div>
        </div>
        {s.liq && <button onClick={() => verEnSesion(s.liq.t)}>Ver el cierre en Sesión ▸</button>}
      </div>

      <div className={`balanza ${s.plat ? 'con-plat' : ''}`}>
        <div className="platillo">
          <span className="pl-tit">Liquidó el equipo <span className="sutil">(driver_logout)</span></span>
          <b>{s.liq ? soles(s.liq.total) : '—'}</b>
          <span className="sutil">{s.liq ? `${nLiq} boletos · corr. ${s.liq.primero ?? '?'}–${s.liq.ultimo ?? '?'}` : 'no hay liquidación en el log'}</span>
        </div>
        <div className={`platillo dif ${s.dif ? 'mal' : 'ok'}`}>
          <span className="pl-tit">Diferencia</span>
          <b>{s.liq ? conSigno(s.dif) : '—'}</b>
          <span className="sutil">{s.dif ? `${s.boletos.length - nLiq >= 0 ? '+' : ''}${s.boletos.length - nLiq} boletos` : s.liq ? 'iguales' : ''}</span>
        </div>
        <div className="platillo">
          <span className="pl-tit">Boletos enviados con la sesión <span className="sutil">(lo que suma la plataforma)</span></span>
          <b>{soles(s.montoEnv)}</b>
          <span className="sutil">{s.boletos.length} boletos{corrs.length ? ` · corr. ${Math.min(...corrs)}–${Math.max(...corrs)}` : ''}</span>
        </div>
        {s.plat && (
          <div className={`platillo plat ${s.liq && s.plat.produccion !== s.liq.total ? 'mal' : 'ok'}`}>
            <span className="pl-tit">Plataforma <span className="sutil">(sesión #{s.plat.id ?? '?'} pegada)</span></span>
            <b>{soles(s.plat.produccion)}</b>
            <span className="sutil">
              {s.plat.produccion === s.montoEnv ? '= boletos enviados' : '≠ boletos enviados'} · {s.liq ? (s.plat.produccion === s.liq.total ? '= liquidación' : '≠ liquidación') : 'sin liquidación'}
            </span>
            <span className="sutil">{s.plat.inicio != null ? horaLog(s.plat.inicio) : '?'} → {s.plat.fin != null ? horaLog(s.plat.fin) : '…'}{s.plat.conductor ? ` · ${s.plat.conductor}` : ''}</span>
          </div>
        )}
      </div>
      <Embudo s={s} nLiq={nLiq} />
      {s.ultimoSales != null && (
        <p className="nota">
          El contador del propio equipo en el último boleto (<code>sales</code>) dice <b>{soles(s.ultimoSales)}</b>
          {s.liq && s.ultimoSales !== s.liq.total ? ' — no es lo que liquidó.' : '.'}
        </p>
      )}

      {s.liq && s.boletos.length > 0 && <Regla s={s} />}

      {s.motivos.length > 0 && (
        <div className="motivos">
          {s.motivos.map(m => (
            <div key={m.tipo} className={`motivo ${m.nivel}`}>
              <div className="motivo-tit">
                <b>{m.titulo}</b>
                {m.monto != null && <span className="motivo-monto">{m.tipo.startsWith('plataforma') ? conSigno(m.monto) : soles(m.monto)}</span>}
                {m.boletos?.length > 0 && (
                  <button className="chico" onClick={() => setFiltro(filtro === m.tipo ? null : m.tipo)}>{filtro === m.tipo ? 'ver todos' : 'ver boletos'}</button>
                )}
              </div>
              {m.detalle.length > 0 && <ul>{m.detalle.map(d => <li key={d}>{d}</li>)}</ul>}
            </div>
          ))}
        </div>
      )}

      <PapelImpreso s={s} padron={padron} verEnSesion={verEnSesion} />

      <div className="dos-col cuadre-cols">
        <Tarifas s={s} />
        <Momento s={s} verEnSesion={verEnSesion} />
      </div>

      <Boletos s={s} filtro={filtro} setFiltro={setFiltro} fuera={fuera} verEnSesion={verEnSesion} />
    </div>
  )
}

/** Correlativos de la sesión de punta a punta: verde = liquidado y enviado, rojo = enviado fuera de la liquidación, gris = liquidado sin envío en el log. */
/**
 * Por dónde se fue la plata: lo impreso ([VENTA] IMPRESA) → lo que llegó a la central (tickets) → lo que el equipo
 * tenía en su base al armar la liquidación → lo que liquidó. Cada salto dice cuántos boletos se quedaron en el camino.
 */
function Embudo({ s, nLiq }) {
  if (!s.impresos || !s.room || !s.liq) return null
  const sinEnvio = s.impresos.sinEnvio
  const borradosSinEnvio = sinEnvio.filter(x => x.perdidoEn).length
  const borradosEnv = s.boletos.filter(b => b.perdidoEn || b.reemplazado).length
  const tarde = s.boletos.filter(b => b.respecto === 'despues').length
  const fueraBase = s.boletos.length - s.room.n
  const pasos = [
    { tit: 'Impresos en papel', monto: s.impresos.monto, n: s.impresos.n, ayuda: '[VENTA] IMPRESA con esta sesión' },
    { tit: 'Llegaron a la central', monto: s.montoEnv, n: s.boletos.length, ayuda: 'tickets enviados: lo que suma la plataforma' },
    { tit: 'En el equipo al cerrar', monto: s.room.monto, n: s.room.n, ayuda: 'lo que tenía la base del equipo al armar la liquidación' },
    { tit: 'Liquidó', monto: s.liq.total, n: nLiq, ayuda: 'driver_logout' },
  ]
  const saltos = [
    [sinEnvio.length && `${sinEnvio.length} impresos sin envío${borradosSinEnvio ? ` (${borradosSinEnvio} borrados al reiniciar)` : ''}`].filter(Boolean),
    [borradosEnv && `${borradosEnv} borrados del equipo al reiniciar`, tarde && `${tarde} vendidos después del corte`, fueraBase - borradosEnv - tarde > 0 && `${fueraBase - borradosEnv - tarde} que no estaban en el equipo`].filter(Boolean),
    [s.room.monto === s.liq.total ? 'la liquidación es lo que tenía el equipo' : 'la liquidación no coincide con el equipo'],
  ]
  return (
    <div className="embudo">
      {pasos.map((p, k) => (
        <div key={p.tit} className="embudo-paso-y-salto">
          <div className="embudo-paso" title={p.ayuda}>
            <span className="pl-tit">{p.tit}</span>
            <b>{soles(p.monto)}</b>
            <span className="sutil">{p.n} boletos</span>
          </div>
          {k < pasos.length - 1 && (
            <div className={`embudo-salto ${pasos[k + 1].monto === p.monto ? 'igual' : 'cae'}`}>
              <b>{pasos[k + 1].monto === p.monto ? '=' : conSigno(pasos[k + 1].monto - p.monto)}</b>
              <span>{saltos[k].join(' · ') || (pasos[k + 1].monto === p.monto ? 'sin pérdida' : '')}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Regla({ s }) {
  const vistos = new Map(s.boletos.map(b => [b.correlativo, b]))
  const a = Math.min(s.liq.primero ?? Infinity, ...vistos.keys())
  const z = Math.max(s.liq.ultimo ?? -Infinity, ...vistos.keys())
  if (!Number.isFinite(a) || !Number.isFinite(z) || z - a > 20_000) return null
  const tramos = []
  for (let c = a; c <= z; c++) {
    const dentro = c >= s.liq.primero && c <= s.liq.ultimo
    const tipo = vistos.has(c) ? (dentro ? 'ok' : 'fuera') : dentro ? 'falta' : 'nada'
    const ult = tramos.at(-1)
    if (ult?.tipo === tipo) ult.hasta = c
    else tramos.push({ tipo, desde: c, hasta: c })
  }
  const corte = ((s.liq.ultimo - a + 1) / (z - a + 1)) * 100
  const TXT = { ok: 'liquidados y enviados', fuera: 'enviados fuera de la liquidación', falta: 'liquidados sin envío en el log', nada: 'otra sesión' }
  return (
    <div className="regla">
      <div className="regla-barra">
        {tramos.map(t => (
          <span key={t.desde} className={`tramo ${t.tipo}`} style={{ flexGrow: t.hasta - t.desde + 1 }} title={`corr. ${t.desde}${t.hasta > t.desde ? `–${t.hasta}` : ''}: ${t.hasta - t.desde + 1} ${TXT[t.tipo]}`} />
        ))}
      </div>
      <div className="regla-eje">
        <span>corr. {a}</span>
        <span>{z}</span>
      </div>
      <span className={`regla-corte ${corte > 50 ? 'izq' : ''}`} style={{ left: `${corte}%` }}>liquidación hasta {s.liq.ultimo}</span>
    </div>
  )
}

function Tarifas({ s }) {
  return (
    <div className="sub-card">
      <h4>Por tarifa</h4>
      <table className="tabla-tarifas">
        <thead>
          <tr>
            <th>Tarifa</th>
            <th className="n">Liquidación</th>
            <th className="n">Enviados</th>
            <th className="n">Dif.</th>
          </tr>
        </thead>
        <tbody>
          {s.tarifas.map(x => (
            <tr key={x.fare} className={x.dif ? 'mal' : ''}>
              <td>
                {x.nombre ?? `Tarifa ${x.fare}`} <span className="sutil">{x.precio != null ? soles(x.precio) : ''}</span>
                {x.fuera.length > 0 && <div className="nota-fila mal">fuera del rango: {describirNums(x.fuera.map(b => b.numero))}</div>}
                {x.faltan.length > 0 && <div className="nota-fila">sin envío en el log: {describirNums(x.faltan)}</div>}
                {x.perdidos.length > 0 && <div className="nota-fila mal">borrados del equipo al reiniciar: {describirNums(x.perdidos.map(b => b.numero))}</div>}
              </td>
              <td className="n mono">
                {x.liq ? <>{soles(x.liq.monto)}<div className="sutil">{x.liq.n} · n° {x.liq.desde}–{x.liq.hasta}</div></> : '—'}
              </td>
              <td className="n mono">
                {soles(x.env.monto)}
                <div className="sutil">{x.env.n}{x.env.n ? ` · n° ${x.env.desde}–${x.env.hasta}` : ''}</div>
              </td>
              <td className={`n mono ${x.dif ? 'mal' : ''}`}>{x.dif == null ? '—' : x.dif ? conSigno(x.dif) : '✓'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function describirNums(ns) {
  const xs = [...ns].sort((a, b) => a - b)
  const out = []
  for (const n of xs) {
    const ult = out.at(-1)
    if (ult && n === ult[1] + 1) ult[1] = n
    else out.push([n, n])
  }
  const txt = out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
  return txt.length > 6 ? `${txt.slice(0, 6).join(', ')} … (${xs.length})` : txt.join(', ')
}

const ESTADO_PAPEL = {
  impresa: ['ok', '✓ salió el papel', 'la cola de impresión la dio por completada'],
  fallo: ['mal', '✗ no salió', 'la cola de impresión dio error'],
  'sin confirmar': ['parcial', '? sin confirmar', 'se encoló y el log no dice si terminó'],
  'sin rastro': ['parcial', '? sin rastro de la cola', 'el log no tiene las líneas de PrintQueue'],
}
const RES_LIQ = {
  diferida: 'Se iba a imprimir junto con su B, al cerrar la vuelta.',
  omitida: 'No se imprimió: modo sin papel.',
  sin_produccion: 'No se imprimió: sin producción.',
  sin_login: 'No se imprimió: sin login del vehículo.',
  error: 'Falló al armar la liquidación.',
}
const dosDec = c => (c / 100).toFixed(2)
const corr6 = c => String(c).padStart(6, '0')

/**
 * Lo que salió en el papel de la liquidación automática. El log no guarda el texto impreso: se reconstruye con los
 * boletos que el equipo tenía al imprimir, igual que LiquidacionPrinter (que suma de nuevo, no usa el driver_logout).
 */
function PapelImpreso({ s, padron, verEnSesion }) {
  const p = s.impresion
  if (!p) {
    const otros = s.impresas.map(x => RES_LIQ[x.resultado]).filter(Boolean)
    return (
      <div className="sub-card papel-vacio">
        <h4>Liquidación impresa</h4>
        <p className="nota">
          {otros.length ? otros.join(' ') : 'El log no muestra una liquidación automática para esta sesión.'} Una reimpresión a mano (Sesiones o «reimprimir
          última») no deja rastro en el log.
        </p>
      </div>
    )
  }
  const [cls, txt, ayuda] = ESTADO_PAPEL[p.estado]
  const liqPorFare = new Map((s.liq?.resume ?? []).map(r => [r.fare, r]))
  return (
    <div className="sub-card papel-caja">
      <h4>
        Liquidación impresa <span className="sutil">· {horaLog(p.t)} · {p.sesiones.length > 1 ? `vuelta A #${p.sesiones[0]} + B #${p.sesiones[1]}` : `sesión #${p.sesiones[0]}`}</span>
        <span className={`estado-tag ${cls}`} title={ayuda}>{txt}</span>
      </h4>
      <div className="papel-fila">
        <div className="papel">
          <div className="papel-cab">LIQUIDACION DE VENTA</div>
          <div className="papel-linea"><span>UNIDAD: {padron ?? '—'}</span><span>{s.chofer ?? ''}</span></div>
          {p.bloques.map(b => (
            <div key={b.sesion} className={`papel-bloque ${b.sesion === s.id ? 'actual' : ''}`}>
              <div className="papel-linea"><b>SESION: {b.sesion} {b.lado == null ? '?' : b.lado ? 'B' : 'A'}</b><span>INI {b.inicio != null ? horaLog(b.inicio) : '?'} · FIN {b.fin != null ? horaLog(b.fin) : '--:--:--'}</span></div>
              <table className="papel-tabla">
                <thead>
                  <tr><th>TARI</th><th>BOLETO</th><th>INICIO</th><th>FIN</th><th className="n">CANT</th><th className="n">PRODUC</th></tr>
                </thead>
                <tbody>
                  {b.filas.map(x => {
                    const r = b.sesion === s.id ? liqPorFare.get(x.fare) : null
                    const nLiq = r ? r.hasta - r.desde + 1 : null
                    const distinto = r && (nLiq !== x.cant || r.cash + r.digital !== x.produccion)
                    return (
                      <tr key={x.fare} className={distinto ? 'mal' : ''} title={distinto ? `A la central (driver_logout): ${nLiq} boletos · S/ ${dosDec(r.cash + r.digital)}` : undefined}>
                        <td>{x.precio != null ? dosDec(x.precio) : '?'}</td>
                        <td>{x.nombre}</td>
                        <td>{corr6(x.corrDesde)}</td>
                        <td>{corr6(x.corrHasta)}</td>
                        <td className="n">{x.cant}{distinto && <small> ≠{nLiq}</small>}</td>
                        <td className="n">{dosDec(x.produccion)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="papel-linea pie">
                <span>{Object.entries(b.pagos).filter(([k, v]) => v && k !== 'canje').map(([k, v]) => `${k.toUpperCase()}: ${dosDec(v)}`).join(' · ') || 'EFECTIVO: 0.00'} · PASAJ: {b.pasajeros}</span>
                <span>SUBTOTAL: {dosDec(b.produccion)}{b.pagos.canje ? ` · CANJE: -${dosDec(b.pagos.canje)}` : ''} · <b>TOTAL: {dosDec(b.total)}</b></span>
              </div>
              {b.parcial && <div className="papel-aviso">la sesión empezó antes del log: el papel pudo traer más boletos</div>}
            </div>
          ))}
          <div className="papel-total">P{padron ?? '?'} TOTAL: {dosDec(p.total)}</div>
          <div className="papel-linea centro">HORA: {horaLog(p.t)}</div>
        </div>
        <div className="papel-lado">
          {s.papel ? (
            <>
              <div className="papel-cifra"><span>Papel · esta sesión</span><b>{soles(s.papel.total)}</b></div>
              <div className={`papel-cifra ${s.liq && s.papel.total !== s.liq.total ? 'mal' : 'ok'}`}>
                <span>Enviada a la central (driver_logout)</span><b>{s.liq ? soles(s.liq.total) : '—'}</b>
                <small>{!s.liq ? '' : s.papel.total === s.liq.total ? '= papel' : `${conSigno(s.papel.total - s.liq.total)} en el papel`}</small>
              </div>
              <div className={`papel-cifra ${s.papel.total !== s.montoEnv ? 'mal' : 'ok'}`}>
                <span>Boletos enviados (plataforma)</span><b>{soles(s.montoEnv)}</b>
                <small>{s.papel.total === s.montoEnv ? '= papel' : `${conSigno(s.montoEnv - s.papel.total)} vs papel`}</small>
              </div>
            </>
          ) : (
            <p className="nota">Esta sesión no salió en el papel (total 0).</p>
          )}
          <p className="nota">
            Reconstruida con los boletos que el equipo tenía al imprimir: la liquidación impresa se vuelve a sumar en ese momento, no es la que se mandó
            a la central. El log no guarda el texto impreso. Las filas en rojo no coinciden con lo enviado (pasa el cursor para ver cuánto).
          </p>
          <button className="chico" onClick={() => verEnSesion(p.t)}>Ver la impresión en Sesión ▸</button>
        </div>
      </div>
    </div>
  )
}

const ICONO = { boleto: '🎟', terminal: '🏁', solicitud: '✋', liquidacion: '⇢', central: '⇠', soltada: '🔓', impresa: '🖨' }

function Momento({ s, verEnSesion }) {
  if (!s.momento.length) return <div className="sub-card"><h4>Momento del cierre</h4><p className="nota">Sin cierre en el log.</p></div>
  return (
    <div className="sub-card">
      <h4>Momento del cierre <span className="sutil">· en el orden en que lo escribió el equipo</span></h4>
      <ol className="momento">
        {s.momento.map(x => {
          const mal = x.b?.respecto === 'despues' || x.b?.respecto === 'antes'
          const hora = x.tipo === 'boleto' || x.tipo === 'liquidacion' ? horaMs(x.t) : horaLog(x.t)
          return (
            <li key={`${x.tipo}${x.i}`} className={`mom ${x.tipo} ${mal ? 'mal' : ''}`} onClick={() => verEnSesion(x.t)} title="Ver en la pestaña Sesión">
              <span className="h">{hora}</span>
              <span className="ico">{ICONO[x.tipo]}</span>
              <span className="txt">
                {x.tipo === 'boleto' ? (
                  <>
                    n° {x.b.numero} {x.b.venta?.nombre ?? `tarifa ${x.b.fare}`} · {soles(x.b.precio)} <span className="sutil">corr. {x.b.correlativo}</span>
                    {mal && <b className="mal"> · fuera de la liquidación</b>}
                  </>
                ) : (
                  x.texto
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const RESPECTO = { dentro: '', despues: 'después del corte', antes: 'antes del primero' }
const estadoBoleto = b =>
  b.perdidoEn ? `borrado del equipo al reiniciar ${horaLog(b.perdidoEn.t)}` : b.reemplazado ? 'borrado del equipo (correlativo reutilizado)' : b.respecto ? RESPECTO[b.respecto] || 'dentro' : '—'
const boletoMal = b => b.perdidoEn || b.reemplazado || (b.respecto && b.respecto !== 'dentro')

function Boletos({ s, filtro, setFiltro, fuera, verEnSesion }) {
  const motivo = s.motivos.find(m => m.tipo === filtro)
  const lista = motivo?.boletos ?? s.boletos
  return (
    <details className="sub-card boletos-ses" open={!!filtro}>
      <summary>
        <h4>
          Boletos de la sesión <span className="sutil">({lista.length}{motivo ? ` de ${s.boletos.length} · ${motivo.titulo}` : ''})</span>
        </h4>
        {fuera.length > 0 && (
          <button className="chico" onClick={e => { e.preventDefault(); setFiltro(filtro ? null : s.motivos.find(m => m.boletos?.length)?.tipo ?? null) }}>
            {filtro ? 'ver todos' : `solo los ${fuera.length} que no cuadran`}
          </button>
        )}
      </summary>
      <div className="tabla-scroll">
        <table className="tabla-boletos">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Boleto</th>
              <th className="n">N°</th>
              <th className="n">Corr.</th>
              <th className="n">Precio</th>
              <th className="n">sales</th>
              <th>Central</th>
              <th>Liquidación</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(b => (
              <tr key={`${b.correlativo}-${b.t}`} className={boletoMal(b) ? 'mal' : ''} onClick={() => verEnSesion(b.t)}>
                <td className="mono">{horaMs(b.t)}</td>
                <td>{b.venta?.nombre ?? `tarifa ${b.fare}`}</td>
                <td className="n mono">{b.numero}</td>
                <td className="n mono">{b.correlativo}</td>
                <td className="n mono">{soles(b.precio)}</td>
                <td className="n mono sutil">{b.sales != null ? soles(b.sales) : ''}</td>
                <td>{b.ack ? <span className="ok">✓ ACK</span> : <span className="mal">sin ACK</span>}{b.envios > 1 ? <span className="sutil"> · {b.envios} envíos</span> : ''}</td>
                <td className={boletoMal(b) ? 'mal' : 'sutil'}>{estadoBoleto(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
