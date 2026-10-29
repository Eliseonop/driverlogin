// Lo que hizo un inspector con la ticketera, leído del log: cada print_qr (papel QR + PIN, validador o pantalla), cada
// boleto que pidió (print_ticket por el servidor o BOLETO por Bluetooth: INSPECTOR_BOLETO + [VENTA] del job) y la
// inspección por Bluetooth (INICIO / REGISTRO / FIN). También junta los boletos impresos sin toque del chofer que no
// pidió un inspector ("se imprime solo"). Las filas agrupan pedidos seguidos del mismo inspector, como el informe a mano.
import { horaLog } from './leer.js'
import { soles, venta } from './cuadre.js'

const SEGUIDOS_MS = 90_000 // pedidos del mismo tipo e inspector a menos de esto van en una fila
const TOQUE_MS = 2000 // TOQUE ↔ ENCOLADA de la misma tarifa; en el mismo segundo el log puede traerlas al revés
// La ENCOLADA detrás de otra repite boleto= (detras_de=… boleto=10): vale el primero.
const leerVenta = msg => {
  const v = venta(msg)
  if (v) v.boleto = /boleto=(\d+)/.exec(msg)?.[1]
  return v
}
const centimos = v => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100))

const QR_SALIDA = [
  [/^print_qr → imprimiendo/, 'papel'],
  [/^print_qr → (PIN y )?QR en el validador/, 'validador'],
  [/^print_qr → sin validador: (PIN y )?QR en pantalla/, 'pantalla'],
]

function leerQr(e) {
  const m = /^print_qr recibido: inspector=(\w+), pin=(\w+), vehicle=(\w+), validUntil=(\S+)/.exec(e.msg)
  if (!m) return null
  const n = v => (v === 'null' ? null : Number(v))
  return { tipo: 'qr', t: e.t, i: e.i, inspector: n(m[1]), pin: n(m[2]), vehicle: n(m[3]), hasta: m[4], salidas: new Set(), papel: null, notas: [] }
}

/** Pedidos del inspector y ventas sin toque, en orden. */
export function inspecciones(rep) {
  const qrs = rep.entradas.filter(e => e.tag === 'SocketMessageDispatcher').map(leerQr).filter(Boolean)
  const toques = rep.entradas.filter(e => e.tag === 'VENTA').map(e => ({ e, v: leerVenta(e.msg) })).filter(x => x.v?.ev === 'TOQUE' && x.v.resultado === 'OK').map(x => ({ t: x.e.t, boleto: x.v.boleto }))
  const usarToque = (t, boleto) => {
    const x = toques.find(q => !q.usado && q.boleto === boleto && Math.abs(q.t - t) <= TOQUE_MS)
    if (x) x.usado = true
    return !!x
  }
  // Las líneas del print_qr van al último pedido hasta 1 s después: en el mismo segundo pueden venir antes del "recibido".
  const qrEn = t => qrs.findLast(q => q.t <= t + 1000)
  const boletos = []
  const ble = []
  const sinToque = []
  const jobs = new Map()
  let esperando = []
  const pedidoDe = (origen, uid) => boletos.findLast(p => p.origen === origen && p.uid === uid)
  const nuevo = (e, origen, uid, fare, inspector) => {
    const p = { tipo: 'boleto', t: e.t, i: e.i, origen, uid, fare, inspector, estado: 'pedido', nombre: null, numero: null, correlativo: null, monto: null }
    boletos.push(p)
    return p
  }

  for (const e of rep.entradas) {
    let m
    if (e.tag === 'SocketService') {
      if ((m = /^\[RECIBIDO\]\| .*\| print_ticket \[DATA\]: \{(.*)\}$/.exec(e.msg))) {
        const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=([^,}]*)/g)].map(x => [x[1], Number(x[2])]))
        nuevo(e, 'servidor', kv.uid, kv.fare, kv.inspector)
      } else if ((m = /^\[ENVIADO\] .*\[KEY\]: print_ticket \[DATA\]: \{(.*)\}$/.exec(e.msg))) {
        const uid = Number(/uid=(\d+)/.exec(m[1])?.[1])
        const p = pedidoDe('servidor', uid)
        if (p) p.respondido = e.t
      }
      continue
    }
    if (e.tag === 'INSPECTOR_BOLETO') {
      if ((m = /^(\w+) uid=(\d+) inspector=(\d+) fare=(\d+) → imprimiendo (.*)$/.exec(e.msg))) {
        const p = (m[1] === 'servidor' && pedidoDe('servidor', +m[2])?.estado === 'pedido' ? pedidoDe('servidor', +m[2]) : null) ?? nuevo(e, m[1], +m[2], +m[4], +m[3])
        Object.assign(p, { estado: 'imprimiendo', nombre: m[5] })
        esperando.push(p)
      } else if ((m = /^(\w+) uid=(\d+) repetido → (.*)$/.exec(e.msg))) {
        const p = pedidoDe(m[1], +m[2]) ?? nuevo(e, m[1], +m[2], null, null)
        Object.assign(p, { estado: 'repetido', motivo: m[3] })
      } else if ((m = /^(\w+) uid=(\d+) fare=(\d+) → (\w+)$/.exec(e.msg))) {
        const p = pedidoDe(m[1], +m[2]) ?? nuevo(e, m[1], +m[2], +m[3], null)
        Object.assign(p, { estado: 'rechazado', motivo: m[4] })
      } else if ((m = /^(\w+) uid=(\d+) → IMPRESO correlativo=(\d+) confirmado=(true|false)/.exec(e.msg))) {
        const p = pedidoDe(m[1], +m[2])
        if (p) Object.assign(p, { estado: 'impreso', numero: p.numero ?? +m[3], confirmado: m[4] === 'true' })
      } else if ((m = /^(\w+) uid=(\d+) → (\w+)$/.exec(e.msg))) {
        const p = pedidoDe(m[1], +m[2])
        if (p) Object.assign(p, { estado: m[3] === 'NO_IMPRESO' ? 'no-impreso' : 'rechazado', motivo: m[3] })
      } else if ((m = /^(\w+) uid=(\d+) sin terminar en (\d+) s/.exec(e.msg))) {
        const p = pedidoDe(m[1], +m[2])
        if (p && p.estado === 'imprimiendo') p.motivo = `sin terminar en ${m[3]} s`
      }
      continue
    }
    if (e.tag === 'INSPECTOR_BLE' && (m = /^Negociación: (INICIO|REGISTRO|FIN) (.*?) → (\w+)(.*)$/.exec(e.msg))) {
      const inspector = Number(/inspector=(\d+)/.exec(m[2])?.[1] ?? NaN)
      const ok = m[3] === 'OK' || m[3] === 'FIN_OK' || m[3] === 'LISTO'
      ble.push({ tipo: 'ble', t: e.t, i: e.i, paso: m[1], inspector: Number.isFinite(inspector) ? inspector : null, ok, respuesta: `${m[3]}${m[4]}`.trim() })
      continue
    }
    if (e.tag === 'VENTA') {
      const v = leerVenta(e.msg)
      if (!v) continue
      if (v.ev === 'RECHAZADA') usarToque(e.t, v.boleto)
      else if (v.ev === 'ENCOLADA') {
        const conToque = usarToque(e.t, v.boleto)
        const k = esperando.findIndex(p => p.fare === Number(v.boleto))
        const p = k >= 0 ? esperando.splice(k, 1)[0] : null
        const s = p ?? (conToque ? null : { tipo: 'sinToque', t: e.t, i: e.i, fare: Number(v.boleto), nombre: v.nombre, estado: 'pedido', pago: v.pago })
        if (s && !p) sinToque.push(s)
        if (s) jobs.set(v.job, s)
      } else if (v.ev === 'IMPRESA' || v.ev === 'NO_IMPRESA') {
        const p = jobs.get(v.job)
        if (!p) continue
        Object.assign(p, { nombre: p.nombre ?? v.nombre, numero: Number(v.num), correlativo: v.correlativo ? Number(v.correlativo) : null, monto: centimos(v.tarifa) })
        if (v.ev === 'NO_IMPRESA') Object.assign(p, { estado: 'no-impreso', motivo: v.motivo ?? 'NO_IMPRESA' })
        else if (p.tipo === 'sinToque') p.estado = 'impreso'
      }
      continue
    }
    const qr = qrEn(e.t)
    if (!qr) continue
    if (e.tag === 'SocketMessageDispatcher' && e.msg.startsWith('print_qr →')) {
      const s = QR_SALIDA.find(([rx]) => rx.test(e.msg))
      if (s) qr.salidas.add(s[1])
      else qr.notas.push(e.msg.replace(/^print_qr → /, ''))
    } else if (e.tag === 'PrintQueue' && /^Raw job encolado: \S+ \(qr_inspector\)/.test(e.msg)) {
      qr.salidas.add('papel')
      qr.papel = 'encolado'
    } else if (e.tag === 'PrintQueue' && /^✓ Raw job completado: \S+ \(qr_inspector\)/.test(e.msg)) qr.papel = 'impreso'
    else if (e.tag === 'ERROR-PrintQueue' && (m = /^Error raw job qr_inspector: (.*)$/.exec(e.msg))) Object.assign(qr, { papel: 'error', error: m[1] })
  }

  // Pedido sin INSPECTOR_BOLETO (versión vieja): la ENCOLADA sin toque de esa tarifa justo después es la del inspector.
  for (const p of boletos.filter(x => x.estado === 'pedido' && x.origen === 'servidor')) {
    const k = sinToque.findIndex(s => s.fare === p.fare && s.t >= p.t && s.t - p.t <= 5000)
    if (k < 0) continue
    const [s] = sinToque.splice(k, 1)
    Object.assign(p, { nombre: s.nombre, numero: s.numero, correlativo: s.correlativo, monto: s.monto, estado: s.estado === 'impreso' ? 'impreso' : s.estado })
  }
  return { qrs, boletos, ble, sinToque }
}

const numeros = xs => {
  const ns = [...new Set(xs.filter(n => n != null))].sort((a, b) => a - b)
  if (!ns.length) return ''
  const consecutivos = ns.every((n, k) => k === 0 || n === ns[k - 1] + 1)
  if (ns.length === 1) return `número ${ns[0]}`
  return consecutivos ? `números ${ns[0]}–${ns.at(-1)}` : `números ${ns.join(', ')}`
}

/** "4 × URBAN/UNIV/ESC (S/ 1.00), números 858–861" por tarifa, más los que no salieron. */
function queSalioBoletos(ps) {
  const out = []
  const impresos = ps.filter(p => p.estado === 'impreso')
  const porFare = new Map()
  for (const p of impresos) porFare.set(p.fare, [...(porFare.get(p.fare) ?? []), p])
  for (const xs of porFare.values()) {
    const precio = xs.find(p => p.monto != null)?.monto
    out.push(`${xs.length} × ${xs[0].nombre ?? `tarifa ${xs[0].fare}`}${precio != null ? ` (${soles(precio)})` : ''}${numeros(xs.map(p => p.numero)) ? `, ${numeros(xs.map(p => p.numero))}` : ''}`)
  }
  const otros = new Map()
  for (const p of ps.filter(x => x.estado !== 'impreso')) {
    const k = p.estado === 'repetido' ? 'repetido (ya estaba impreso, no reimprime)' : p.estado === 'pedido' ? 'sin rastro de impresión' : p.estado === 'imprimiendo' ? `sin resultado${p.motivo ? ` (${p.motivo})` : ''}` : `${p.estado === 'no-impreso' ? 'no impreso' : 'rechazado'} (${p.motivo})`
    otros.set(k, (otros.get(k) ?? 0) + 1)
  }
  for (const [k, n] of otros) out.push(`${n} ${k}`)
  return out.join(' · ')
}

function queSalioQr(qs) {
  const papel = qs.filter(q => q.salidas.has('papel'))
  const out = []
  if (papel.length) out.push(papel.length === 1 ? 'Papel QR + PIN' : `${papel.length} papeles QR`)
  const fallo = papel.filter(q => q.papel === 'error')
  if (fallo.length) out.push(`${fallo.length} con error de impresión (${fallo[0].error})`)
  const veces = n => (n > 1 && n < qs.length ? ` (${n})` : '')
  const otra = s => qs.filter(q => q.salidas.has(s)).length
  if (otra('validador')) out.push(`PIN y QR en el validador${veces(otra('validador'))}`)
  if (otra('pantalla')) out.push(`PIN y QR en la pantalla de la ticketera${veces(otra('pantalla'))}`)
  const sinRastro = qs.filter(q => !q.salidas.size).length
  if (sinRastro) out.push(`${sinRastro} sin rastro de qué mostró`)
  const notas = [...new Set(qs.flatMap(q => q.notas))]
  if (notas.length) out.push(notas.join('; '))
  return out.join(' · ')
}

const PASO = { INICIO: 'subida', REGISTRO: 'registro', FIN: 'bajada' }

function fila(grupo) {
  const [x] = grupo
  const n = grupo.length
  const base = { desde: x.t, hasta: grupo.at(-1).t, i: x.i, tipo: x.tipo, inspector: x.inspector ?? null, items: grupo }
  if (x.tipo === 'qr')
    return { ...base, pedido: `print_qr inspector ${x.inspector ?? '?'}${n > 1 ? ` (${n} veces)` : ''}`, salio: queSalioQr(grupo), mal: grupo.some(q => q.papel === 'error') }
  if (x.tipo === 'ble')
    return { ...base, pedido: `Bluetooth inspector ${x.inspector ?? '?'}: ${grupo.map(b => PASO[b.paso]).join(', ')}`, salio: grupo.map(b => `${PASO[b.paso]} → ${b.respuesta}`).join(' · '), mal: grupo.some(b => !b.ok) }
  const monto = grupo.reduce((a, p) => a + (p.estado === 'impreso' ? p.monto ?? 0 : 0), 0)
  const mal = grupo.some(p => p.estado !== 'impreso')
  if (x.tipo === 'sinToque') return { ...base, pedido: `sin toque del chofer ni inspector${n > 1 ? `, ${n} seguidos` : ''}`, salio: queSalioBoletos(grupo), monto, mal: true }
  const via = x.origen === 'servidor' ? 'print_ticket' : 'Bluetooth BOLETO'
  return { ...base, pedido: `${via} inspector ${x.inspector ?? '?'}${n > 1 ? `, ${n} seguidos` : ''}`, salio: queSalioBoletos(grupo), monto, mal }
}

const claveGrupo = x => `${x.tipo}|${x.origen ?? ''}|${x.inspector ?? ''}`

/** Informe: filas agrupadas + resumen por inspector. */
export function informeInspector(rep) {
  const r = inspecciones(rep)
  const todos = [...r.qrs, ...r.boletos, ...r.ble, ...r.sinToque].sort((a, b) => a.i - b.i)
  const grupos = []
  for (const x of todos) {
    const g = grupos.at(-1)
    if (g && claveGrupo(g[0]) === claveGrupo(x) && x.t - g.at(-1).t <= SEGUIDOS_MS) g.push(x)
    else grupos.push([x])
  }
  const filas = grupos.map(fila)
  const inspectores = new Map()
  for (const x of [...r.qrs, ...r.boletos, ...r.ble]) {
    const k = x.inspector ?? '?'
    const s = inspectores.get(k) ?? { inspector: k, qr: 0, boletos: 0, monto: 0, problemas: 0, desde: x.t, hasta: x.t }
    s.hasta = x.t
    if (x.tipo === 'qr') s.qr++
    if (x.tipo === 'boleto' && x.estado === 'impreso') {
      s.boletos++
      s.monto += x.monto ?? 0
    }
    if (x.tipo === 'boleto' && x.estado !== 'impreso' && x.estado !== 'repetido') s.problemas++
    inspectores.set(k, s)
  }
  return { ...r, filas, inspectores: [...inspectores.values()] }
}

/** Tabla tal como se pega en un chat o en Excel: Hora · Pedido · Qué salió. */
export function informeTexto(inf) {
  const hora = f => (f.desde === f.hasta || horaLog(f.desde) === horaLog(f.hasta) ? horaLog(f.desde) : `${horaLog(f.desde)} – ${horaLog(f.hasta)}`)
  return ['Hora\tPedido\tQué salió', ...inf.filas.map(f => `${hora(f)}\t${f.pedido}\t${f.salio}`)].join('\n')
}

export function hallazgosInspector(inf) {
  const out = []
  for (const s of inf.inspectores) {
    if (!s.qr && !s.boletos) continue
    const partes = [s.qr && `${s.qr} QR`, s.boletos && `${s.boletos} boleto${s.boletos > 1 ? 's' : ''} (${soles(s.monto)})`].filter(Boolean)
    out.push({
      nivel: 'info',
      t: s.desde,
      vista: 'inspector',
      titulo: `Inspector ${s.inspector}: ${partes.join(' y ')}`,
      detalle: s.boletos ? [`Los boletos del inspector se imprimen sin toque del chofer y suman ${soles(s.monto)} a su venta.`] : [],
    })
  }
  for (const f of inf.filas.filter(f => f.mal && f.tipo !== 'ble'))
    out.push({ nivel: 'aviso', t: f.desde, i: f.i, vista: 'inspector', titulo: `${f.pedido} (${horaLog(f.desde)})`, detalle: [f.salio] })
  return out
}
