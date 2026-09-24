// Convierte las acciones hechas a mano en el simulador en un guion de escenario pegable en scenarios.js.

import { PAUSA_MS, SIN_PAUSA } from './scenarios.js'

const OMITIR = new Set(['esperar', 'hora', 'mover'])

export function guionDesdeAcciones(acciones) {
  const pasos = []
  let cursor = null
  for (const a of acciones) {
    if (OMITIR.has(a.tipo)) continue
    if (cursor != null) {
      const s = Math.round((a.t - cursor) / 1000)
      if (s > 0) pasos.push(['esperar', { s }])
    }
    const params = Object.fromEntries(Object.entries(a.a ?? {}).filter(([, v]) => v !== undefined))
    pasos.push(Object.keys(params).length ? [a.tipo, params] : [a.tipo])
    cursor = a.t + (a.duracionMs ?? 0) + (SIN_PAUSA.has(a.tipo) ? 0 : PAUSA_MS)
  }
  return pasos
}

export function guionComoTexto(pasos, id = 'mi-escenario') {
  const lineas = pasos.map(p => `    ${JSON.stringify(p).replace(/"([a-zA-Z_]\w*)":/g, '$1: ').replace(/"/g, "'")},`)
  return `  {
    id: '${id}',
    grupo: 'Terminal y autoretorno',
    titulo: 'Describe lo que pasa',
    pasos: [
${lineas.join('\n')}
    ],
    checks: w => [c(w.sesion != null, 'queda con sesión')],
  },`
}
