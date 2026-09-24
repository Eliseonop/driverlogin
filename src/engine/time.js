// Reloj "local" sin zona horaria: los ms se leen con getters UTC para que 06:18 sea 06:18 en cualquier PC.

const p2 = n => String(n).padStart(2, '0')

export const MIN = 60_000
export const HORA = 60 * MIN
export const DIA = 24 * HORA

export function fecha(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}

export const hora = ms => {
  const d = new Date(ms)
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
}

/** Formato de línea del LogManager: "2026-09-23 06:18:59". */
export const stamp = ms => `${fecha(ms)} ${hora(ms)}`

/** LocalDateTime.toString() con segundos: "2026-09-23T06:18:59". */
export const isoSeg = ms => `${fecha(ms)}T${hora(ms)}`

/** LocalDateTime.now().toString(): "2026-09-23T06:18:59.123000". */
export const isoMicro = ms => `${isoSeg(ms)}.${String(ms % 1000).padStart(3, '0')}000`

export function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?/.exec(s ?? '')
  if (!m) return null
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), ms)
}

export const minutosDelDia = ms => {
  const d = new Date(ms)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

export const inicioDia = ms => ms - (ms % DIA)

export function duracion(ms) {
  const s = Math.round(Math.abs(ms) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${p2(s % 60)}s`
  return `${Math.floor(m / 60)}h ${p2(m % 60)}m`
}
