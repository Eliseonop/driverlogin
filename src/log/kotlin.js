// Lee valores tal como los imprime Kotlin: Map ({a=1, b=[..]}) y data class (Paradero(id=1, ...)).

// Campos que en Kotlin son String aunque parezcan número (dni y clave pueden empezar con 0).
const STRING_KEYS = new Set(['dni', 'key', 'password', 'value', 'serial', 'imei', 'nombre', 'audio', 'driver_code', 'id_hex'])

function splitTop(s, conClave) {
  const partes = []
  let prof = 0
  let ini = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{' || c === '[' || c === '(') prof++
    else if (c === '}' || c === ']' || c === ')') prof = Math.max(0, prof - 1)
    else if (prof === 0 && c === ',' && s[i + 1] === ' ') {
      if (!conClave || /^[A-Za-z_]\w*=/.test(s.slice(i + 2))) {
        partes.push(s.slice(ini, i))
        ini = i + 2
      }
    }
  }
  const ult = s.slice(ini)
  if (ult.length || partes.length) partes.push(ult)
  return partes
}

function cierra(s, abre, cierre) {
  if (s[0] !== abre || s[s.length - 1] !== cierre) return false
  let prof = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[' || s[i] === '(') prof++
    else if (s[i] === '}' || s[i] === ']' || s[i] === ')') prof--
    if (prof === 0 && i < s.length - 1) return false
  }
  return true
}

function entradas(inner) {
  const out = {}
  for (const parte of splitTop(inner, true)) {
    const eq = parte.indexOf('=')
    if (eq < 0) continue
    const k = parte.slice(0, eq).trim()
    out[k] = parseKValue(parte.slice(eq + 1), k)
  }
  return out
}

export function parseKValue(raw, clave) {
  const s = (raw ?? '').trim()
  if (s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === '') return ''
  if (cierra(s, '{', '}')) return entradas(s.slice(1, -1))
  if (cierra(s, '[', ']')) {
    const inner = s.slice(1, -1).trim()
    return inner ? splitTop(inner, false).map(x => parseKValue(x)) : []
  }
  const tipado = /^([A-Z]\w*)\((.*)\)$/s.exec(s)
  if (tipado && cierra(s.slice(tipado[1].length), '(', ')')) return { __type: tipado[1], ...entradas(tipado[2]) }
  if (!STRING_KEYS.has(clave) && /^-?\d+(\.\d+)?(E-?\d+)?$/.test(s)) return Number(s)
  return s
}

export const parseKMap = raw => {
  const v = parseKValue(raw)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

/** Paradero(...) del log → { id, lado, orden, nombre, terminal, liquidar, radio, lat, lng, ruta } */
export function paraderoDesdeLog(o) {
  if (!o || o.__type !== 'Paradero') return null
  return {
    id: Number(o.id),
    lado: o.lado === true,
    ruta: typeof o.ruta === 'object' ? Number(o.ruta?.id) : Number(o.ruta),
    activo: o.activo !== false,
    nombre: String(o.nombre),
    orden: Number(o.orden),
    lat: Number(o.latitud),
    lng: Number(o.longitud),
    liquidar: o.liquidar === true,
    terminal: o.terminal === true,
    radio: Number(o.radio),
  }
}
