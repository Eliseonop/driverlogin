#!/usr/bin/env node
// Corre el catálogo de escenarios en consola.
//   npm run escenarios                → resumen
//   npm run escenarios -- ciclo-a-b   → log completo de un escenario (formato LogManager)
//   npm run escenarios -- ciclo-a-b --v1066

import { ESCENARIOS, correrEscenario } from '../src/engine/scenarios.js'
import { stamp } from '../src/engine/time.js'

const args = process.argv.slice(2)
const id = args.find(a => !a.startsWith('--'))
const extra = args.includes('--v1066') ? { perfil: 'v1066' } : {}

if (id) {
  const esc = ESCENARIOS.find(e => e.id === id)
  if (!esc) {
    console.error(`No existe "${id}". Ids: ${ESCENARIOS.map(e => e.id).join(', ')}`)
    process.exit(1)
  }
  const r = correrEscenario(esc, extra)
  const filas = [
    ...r.world.logs.map(l => ({ t: l.t, s: `${stamp(l.t)} [${l.tag}] ${l.msg}` })),
    ...r.world.eventos.map(e => ({ t: e.t, s: `${stamp(e.t)}    \x1b[90m· ${e.tipo}: ${e.texto}\x1b[0m` })),
  ].sort((a, b) => a.t - b.t)
  for (const f of filas) console.log(f.s)
  console.log(`\n${esc.titulo}`)
  if (esc.riesgo) console.log(`⚠ ${esc.riesgo}`)
  for (const c of r.checks) console.log(`${c.ok ? '✅' : '❌'} ${c.texto}`)
  process.exit(r.ok ? 0 : 1)
}

let grupo = ''
let fallas = 0
for (const esc of ESCENARIOS) {
  const r = correrEscenario(esc, extra)
  if (esc.grupo !== grupo) console.log(`\n${(grupo = esc.grupo)}`)
  console.log(`  ${r.ok ? '✅' : '❌'} ${esc.id.padEnd(34)} ${esc.titulo}${esc.riesgo ? '  \x1b[33m[riesgo]\x1b[0m' : ''}`)
  for (const c of r.checks.filter(x => !x.ok)) console.log(`      ✗ ${c.texto}`)
  if (!r.ok) fallas++
}
console.log(`\n${ESCENARIOS.length - fallas}/${ESCENARIOS.length} escenarios OK`)
process.exit(fallas ? 1 : 0)
