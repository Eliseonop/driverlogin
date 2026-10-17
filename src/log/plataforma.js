// Sesiones copiadas de la plataforma para cruzarlas con el log: el objeto JSON de la sesión (uno, un arreglo o varios
// pegados seguidos) o filas de la tabla con inicio y fin. Mismo formato que acepta la app de consumo.
import { horaLog, parseStamp } from './leer.js'
import { soles } from './cuadre.js'

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const centimos = v => (num(v) == null ? null : Math.round(Number(v) * 100))
const lado = v => (v == null ? null : v === true || String(v).toLowerCase() === 'true' || v === 'B')

/** Un objeto, un arreglo [ … ] o varios objetos pegados uno tras otro. null = JSON inválido. */
function variosJson(texto) {
  try {
    const d = JSON.parse(texto)
    return Array.isArray(d) ? d : [d]
  } catch {
    try {
      return JSON.parse(`[${texto.replace(/}\s*,?\s*\{/g, '},{')}]`)
    } catch {
      return null
    }
  }
}

function deObjeto(o) {
  if (!o || typeof o !== 'object' || (o.inicio == null && o.fin == null)) return null
  const c = o.conductor ?? {}
  return {
    id: num(o.id),
    lado: lado(o.lado),
    inicio: parseStamp(String(o.inicio ?? '')),
    fin: parseStamp(String(o.fin ?? '')),
    produccion: centimos(o.produccion),
    conductor: [c.nombre, c.codigo].filter(Boolean).join(' · ') || null,
    salida: o.salida?.id ?? null,
    raw: o,
  }
}

const FECHA = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/g

function deFila(linea) {
  const dts = [...linea.matchAll(FECHA)]
  if (dts.length < 2) return null
  const sinFechas = linea.replace(FECHA, ' ')
  const l = /lado[=:\s]+(true|false)/i.exec(linea)?.[1] ?? /(?:^|\s)([AB])(?:\s|$)/.exec(sinFechas)?.[1]
  return {
    id: num(/^\s*(\d{3,})\s/.exec(linea)?.[1]),
    lado: l == null ? null : lado(l),
    inicio: parseStamp(`${dts[0][1]} ${dts[0][2]}`),
    fin: parseStamp(`${dts[1][1]} ${dts[1][2]}`),
    produccion: centimos(/(\d+\.\d{1,2})/.exec(sinFechas)?.[1]),
    conductor: null,
    salida: null,
    raw: null,
  }
}

/** Texto pegado → { sesiones, error }. */
export function leerPlataforma(texto) {
  const t = (texto ?? '').trim()
  if (!t) return { sesiones: [], error: null }
  if (t.startsWith('{') || t.startsWith('[')) {
    const arr = variosJson(t)
    if (!arr) return { sesiones: [], error: 'JSON inválido: revisa el texto pegado.' }
    const sesiones = arr.map(deObjeto).filter(Boolean)
    return { sesiones, error: sesiones.length ? null : 'Ningún objeto trae inicio y fin.' }
  }
  const sesiones = t.split(/\r?\n/).map(deFila).filter(Boolean)
  return { sesiones, error: sesiones.length ? null : 'No se reconoció ninguna fila: cada una necesita fecha de inicio y de fin.' }
}

const TOLERANCIA = 2 * 60_000

/** La sesión del log que corresponde a una de la plataforma: por id; si no, la del mismo lado que más se solapa. */
function pareja(p, sesiones) {
  const porId = p.id != null ? sesiones.find(s => s.id === p.id) : null
  if (porId) return porId
  let mejor = null
  let solape = 0
  for (const s of sesiones) {
    if (p.lado != null && s.lado != null && p.lado !== s.lado) continue
    const a = Math.max(p.inicio ?? -Infinity, (s.inicio ?? Infinity) - TOLERANCIA)
    const b = Math.min(p.fin ?? Infinity, (s.fin ?? s.boletos.at(-1)?.t ?? s.inicio ?? -Infinity) + TOLERANCIA)
    if (b - a > solape) {
      solape = b - a
      mejor = s
    }
  }
  return mejor
}

/**
 * Cuadre del log + plataforma: cada sesión lleva `plat` y, si la plataforma no coincide con la liquidación, pasa a
 * no cuadrar aunque el log no lo viera. Las de la plataforma sin pareja en el log van en `soloPlataforma`.
 */
export function cruzar(cuadre, plataforma) {
  if (!plataforma.length) return { ...cuadre, soloPlataforma: [] }
  const usadas = new Map()
  const soloPlataforma = []
  for (const p of plataforma) {
    const s = pareja(p, cuadre.sesiones)
    if (s && !usadas.has(s.id)) usadas.set(s.id, p)
    else soloPlataforma.push(p)
  }
  const sesiones = cuadre.sesiones.map(s => {
    const p = usadas.get(s.id)
    if (!p) return s
    const motivos = []
    const prod = p.produccion
    const liq = s.liq?.total ?? null
    if (prod != null && liq != null && prod !== liq) {
      const igualBoletos = prod === s.montoEnv
      motivos.push({
        tipo: 'plataforma',
        nivel: 'error',
        titulo: `La plataforma tiene ${soles(prod)} y el equipo liquidó ${soles(liq)}`,
        monto: prod - liq,
        detalle: [
          igualBoletos ? `Coincide con los boletos que el log muestra enviados con la #${s.id}${s.motivos.length ? '; el porqué, abajo' : ''}.` : `Los boletos del log suman ${soles(s.montoEnv)}${s.cubre ? '' : ' (el log no cubre toda la sesión)'}.`,
        ],
      })
    } else if (prod != null && prod !== s.montoEnv)
      motivos.push({
        tipo: 'plataforma',
        nivel: s.cubre ? 'aviso' : 'info',
        titulo: `La plataforma tiene ${soles(prod)} y los boletos del log suman ${soles(s.montoEnv)}`,
        monto: prod - s.montoEnv,
        detalle: [s.cubre ? 'Hay boletos que la central contó y el log no muestra enviados (o al revés).' : `El log empieza después de la apertura de la sesión: le faltan los boletos anteriores.`],
      })
    if (p.fin != null && s.fin != null && Math.abs(p.fin - s.fin) > TOLERANCIA)
      motivos.push({ tipo: 'plataformaFin', nivel: 'info', titulo: `La plataforma cerró la sesión a las ${horaLog(p.fin)} y el equipo liquidó a las ${horaLog(s.fin)}`, detalle: [] })
    const estado = prod != null && liq != null ? (prod === liq && s.estado === 'parcial' ? 'cuadra' : prod !== liq ? 'no-cuadra' : s.estado) : s.estado
    return { ...s, plat: p, estado, motivos: [...motivos.filter(m => m.nivel === 'error'), ...s.motivos, ...motivos.filter(m => m.nivel !== 'error')] }
  })
  return { ...cuadre, sesiones, soloPlataforma }
}
