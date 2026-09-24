#!/usr/bin/env node
// Diagnóstico de un log real desde la consola.
//   npm run diagnosticar -- ruta/al/LOG.txt [--reproducir actual|v1066] [--lineas]

import fs from 'node:fs'
import { diagnosticar, causaTxt } from '../src/analyzer/diagnose.js'
import { reproducir } from '../src/analyzer/replay.js'
import { stamp } from '../src/engine/time.js'

const args = process.argv.slice(2)
const archivo = args.find(a => !a.startsWith('--'))
if (!archivo) {
  console.error('uso: npm run diagnosticar -- LOG.txt [--reproducir actual|v1066] [--lineas]')
  process.exit(1)
}
const iRep = args.indexOf('--reproducir')
const perfil = iRep >= 0 ? args[iRep + 1] ?? 'actual' : null
const conLineas = args.includes('--lineas')

const d = diagnosticar(fs.readFileSync(archivo, 'utf8'))
const hora = t => (t ? stamp(t).slice(11) : '—')
const lado = l => (l == null ? '?' : l ? 'B' : 'A')
const COLOR = { alta: '\x1b[31m', media: '\x1b[33m', baja: '\x1b[36m', info: '\x1b[90m' }

console.log(`\n📄 ${archivo}`)
console.log(`   ${d.entradas.length} líneas · ${stamp(d.parse.desde)} → ${stamp(d.parse.hasta)} · orden ${d.parse.orden}`)
console.log(`   equipo id=${d.parse.equipo.id ?? '?'} padrón=${d.parse.equipo.padron ?? '?'} versión=${d.parse.equipo.versiones.join(', ') || '?'} · ${d.parse.paraderos.length} paraderos en el log`)

const tablaSesiones = (titulo, sesiones) => {
  console.log(`\n${titulo}`)
  if (!sesiones.length) return console.log('   (ninguna)')
  for (const s of sesiones)
    console.log(`   ${String(s.id).padEnd(7)} ${lado(s.lado)}  ${hora(s.inicio)} → ${s.fin ? hora(s.fin) : 'abierta '}  abre: ${causaTxt(s.apertura).padEnd(32)} cierra: ${causaTxt(s.cierreCausa)}${s.bloqueada ? '  ⚠ descartada por el equipo' : ''}`)
}
tablaSesiones('🧾 Sesiones (real)', d.sesiones)

console.log('\n🔎 Hallazgos')
for (const h of d.hallazgos) {
  console.log(`   ${COLOR[h.severidad]}[${h.severidad}]\x1b[0m ${h.titulo}`)
  console.log(`      ${h.detalle}`)
  if (conLineas) for (const i of h.evid.slice(0, 3)) console.log(`      \x1b[90m${d.entradas[i].n}: ${stamp(d.entradas[i].t)} [${d.entradas[i].tag}] ${d.entradas[i].msg.slice(0, 150)}\x1b[0m`)
}

if (perfil) {
  const r = reproducir(d, { perfil })
  tablaSesiones(`🧪 Sesiones si el equipo hubiera tenido la lógica "${perfil}"`, r.diagSim.sesiones)
  if (r.guion.avisos.length) console.log(`   avisos: ${r.guion.avisos.join(' · ')}`)
  if (r.errores.length) console.log(`   errores al reproducir: ${r.errores.slice(0, 3).join(' · ')}`)
  const hs = r.diagSim.hallazgos.filter(h => h.severidad !== 'info')
  if (hs.length) for (const h of hs) console.log(`   ${COLOR[h.severidad]}[${h.severidad}]\x1b[0m ${h.titulo}`)
}
console.log('')
