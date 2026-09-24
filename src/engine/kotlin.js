// Formato y parseo de valores tal como los imprime Kotlin (toString de data class y de Map).
// El simulador escribe los logs con este formato y el analizador los lee, así ambos hablan igual.

// Campos que en Kotlin son String aunque parezcan número (dni y clave pueden empezar con 0).
const STRING_KEYS = new Set(['dni', 'key', 'password', 'value', 'serial', 'imei', 'nombre', 'audio', 'driver_code'])

export const kDouble = n => (Number.isInteger(n) ? `${n}.0` : `${n}`)

export function kValue(v) {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return `[${v.map(kValue).join(', ')}]`
  if (typeof v === 'object') return kMap(v)
  return String(v)
}

export const kMap = obj => `{${Object.entries(obj).map(([k, v]) => `${k}=${kValue(v)}`).join(', ')}}`

export const kParadero = p =>
  p == null
    ? 'null'
    : `Paradero(id=${p.id}, lado=${p.lado}, ruta=Ruta(id=${p.ruta}, codigo=${p.rutaCodigo ?? 1493}, inicio=null, activo=false), ` +
      `activo=${p.activo ?? true}, nombre=${p.nombre}, orden=${p.orden}, latitud=${p.latitud}, liquidar=${p.liquidar}, ` +
      `longitud=${p.longitud}, radio=${kDouble(p.radio)}, velocidad=${kDouble(p.velocidad ?? 50)}, terminal=${p.terminal}, audio=${p.audio ?? p.nombre})`

export const kSession = s =>
  s == null
    ? 'null'
    : `SessionDriver(id=${s.id}, driver_id=${s.driver_id}, driver_code=${s.driver_code}, activo=${s.activo}, castigado=${s.castigado}, ` +
      `conductor=${s.conductor}, vencido=${s.vencido}, route=${s.route}, direction=${s.direction}, start_time=${s.start_time}, autoLogin=${s.autoLogin})`

export const kEntity = e =>
  e == null
    ? 'null'
    : `SessionDriverEntity(id=${e.id}, driver_id=${e.driver_id}, driver_code=${e.driver_code}, activo=${e.activo}, castigado=${e.castigado}, ` +
      `conductor=${e.conductor}, vencido=${e.vencido}, route=${e.route}, direction=${e.direction}, start_time=${e.start_time}, ` +
      `dni=${e.dni ?? 'null'}, password=${e.password ?? 'null'}, autoLogin=${e.autoLogin}, finalizado=${e.finalizado}, end_time=${e.end_time ?? 'null'})`

export const kOperation = o =>
  `ProtoOperation(id=${o.id ?? 'null'}, section=${o.section ?? 'null'}, key=${o.key ?? 'null'}, value=${o.value ?? 'null'})`

// ── Parseo ────────────────────────────────────────────────────────────────────

function splitTop(s, isKeyed) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && c === ',' && s[i + 1] === ' ') {
      const rest = s.slice(i + 2)
      if (!isKeyed || /^[A-Za-z_][\w]*=/.test(rest)) {
        parts.push(s.slice(start, i))
        start = i + 2
      }
    }
  }
  const last = s.slice(start)
  if (last.length || parts.length) parts.push(last)
  return parts
}

function closes(s, open, close) {
  if (s[0] !== open || s[s.length - 1] !== close) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[' || s[i] === '(') depth++
    else if (s[i] === '}' || s[i] === ']' || s[i] === ')') depth--
    if (depth === 0 && i < s.length - 1) return false
  }
  return true
}

function parseEntries(inner) {
  const out = {}
  for (const part of splitTop(inner, true)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    out[key] = parseKValue(part.slice(eq + 1), key)
  }
  return out
}

export function parseKValue(raw, key) {
  const s = (raw ?? '').trim()
  if (s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === '') return ''
  if (closes(s, '{', '}')) return parseEntries(s.slice(1, -1))
  if (closes(s, '[', ']')) {
    const inner = s.slice(1, -1).trim()
    return inner ? splitTop(inner, false).map(x => parseKValue(x)) : []
  }
  const typed = /^([A-Z]\w*)\((.*)\)$/s.exec(s)
  if (typed && closes(s.slice(typed[1].length), '(', ')')) {
    return { __type: typed[1], ...parseEntries(typed[2]) }
  }
  if (!STRING_KEYS.has(key) && /^-?\d+(\.\d+)?(E-?\d+)?$/.test(s)) return Number(s)
  return s
}

export const parseKMap = raw => {
  const v = parseKValue(raw)
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

/** Paradero(...) de un log → objeto de paradero del simulador. */
export function paraderoDesdeLog(obj) {
  if (!obj || obj.__type !== 'Paradero') return null
  return {
    id: Number(obj.id),
    lado: obj.lado === true,
    ruta: typeof obj.ruta === 'object' ? Number(obj.ruta?.id) : Number(obj.ruta),
    rutaCodigo: typeof obj.ruta === 'object' ? obj.ruta?.codigo : undefined,
    activo: obj.activo !== false,
    nombre: String(obj.nombre),
    orden: Number(obj.orden),
    latitud: Number(obj.latitud),
    longitud: Number(obj.longitud),
    liquidar: obj.liquidar === true,
    terminal: obj.terminal === true,
    radio: Number(obj.radio),
    velocidad: Number(obj.velocidad ?? 50),
    audio: obj.audio ?? obj.nombre,
  }
}
