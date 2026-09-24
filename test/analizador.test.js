import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import { diagnosticar } from '../src/analyzer/diagnose.js'
import { reproducir } from '../src/analyzer/replay.js'
import { leerEntradas } from '../src/analyzer/parser.js'
import { parseKValue, kParadero, paraderoDesdeLog } from '../src/engine/kotlin.js'
import { ESCENARIOS, correrEscenario } from '../src/engine/scenarios.js'
import RUTA from '../src/data/ruta124.js'

const fixture = n => fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8')
const ids = d => d.hallazgos.map(h => h.id)

describe('formato Kotlin', () => {
  it('ida y vuelta de Paradero', () => {
    const p = RUTA.paraderos.find(x => x.nombre === 'Butter')
    expect(paraderoDesdeLog(parseKValue(kParadero(p)))).toMatchObject({ id: 45, lado: false, orden: 21, radio: 155, terminal: true, liquidar: true })
  })
  it('mapas anidados y claves que son texto', () => {
    const v = parseKValue('{sessions=[{id=35417, direction=false}], error=false, message=Se ha creado una nueva sesión, key=0391}')
    expect(v).toEqual({ sessions: [{ id: 35417, direction: false }], error: false, message: 'Se ha creado una nueva sesión', key: '0391' })
  })
  it('acepta el log en orden descendente o ascendente', () => {
    const asc = '2026-09-23 06:00:00 [A] uno\n2026-09-23 06:00:01 [B] dos'
    const desc = asc.split('\n').reverse().join('\n')
    expect(leerEntradas(desc).entradas.map(e => e.tag)).toEqual(['A', 'B'])
    expect(leerEntradas(asc).orden).toBe('asc')
  })
})

describe('log real: padrón 124, 23-09 (1.0.66)', () => {
  const d = diagnosticar(fixture('124_2026-09-23_incidente.log'))
  it('reconstruye una sola sesión A abierta todo el día', () => {
    expect(d.sesiones.map(s => [s.id, s.lado, s.fin])).toEqual([[35417, false, null]])
  })
  it('detecta el paso por Butter sin cierre y el operation ignorado', () => {
    expect(ids(d)).toContain('terminal-sin-cierre')
    expect(ids(d)).toContain('operation-ignorado')
    expect(d.hallazgos.find(h => h.id === 'terminal-sin-cierre').titulo).toContain('Butter')
  })
  it('con el perfil 1.0.66 la reproducción queda igual que la realidad', () => {
    const r = reproducir(d, { perfil: 'v1066' })
    expect(r.diagSim.sesiones.map(s => [s.id, s.fin])).toEqual([[35417, null]])
  })
  it('con la lógica actual habría cerrado A en Butter y abierto B', () => {
    const r = reproducir(d, { perfil: 'actual' })
    const [a, b] = r.diagSim.sesiones
    expect(a).toMatchObject({ id: 35417, lado: false, cierreCausa: 'terminal' })
    expect(new Date(a.fin).toISOString().slice(11, 16)).toBe('10:07')
    expect(b).toMatchObject({ lado: true })
  })
})

describe('log real: padrón 28, 12/13-08 (sesión huérfana)', () => {
  const d = diagnosticar(fixture('28_2026-08-13_unidad-ocupada.log'))
  it('la B automática tras ENERGY queda descartada y bloquea la unidad al día siguiente', () => {
    const s = d.sesiones.find(x => x.id === 1187)
    expect(s).toMatchObject({ lado: true, apertura: 'central-automatica' })
    expect(s.bloqueada).toBeTruthy()
    expect(ids(d)).toEqual(expect.arrayContaining(['sesion-huerfana', 'unidad-ocupada']))
  })
})

describe('log real: padrón 130, 20-08 (cierres forzados)', () => {
  const d = diagnosticar(fixture('130_2026-08-20_forzados.log'))
  it('clasifica los cierres ENERGY y batería crítica', () => {
    const causas = Object.fromEntries(d.sesiones.map(s => [s.id, s.cierreCausa]))
    expect(causas[32472]).toBe('forzado:ENERGY')
    expect(causas[32481]).toBe('forzado:Bateria critica')
  })
  it('detecta que pidió A y la central devolvió la B abierta', () => {
    expect(ids(d)).toContain('lado-distinto')
  })
})

describe('el analizador entiende los logs del simulador', () => {
  it('ciclo A → B → A', () => {
    const w = correrEscenario(ESCENARIOS.find(e => e.id === 'ciclo-a-b-a')).world
    const d = diagnosticar(w.exportarLog())
    expect(d.sesiones.map(s => [s.lado, s.cierreCausa ?? null])).toEqual([
      [false, 'terminal'],
      [true, 'terminal'],
      [false, null],
    ])
  })
  it('sesión huérfana simulada', () => {
    const w = correrEscenario(ESCENARIOS.find(e => e.id === 'forzado-otro-conductor-bloqueado')).world
    expect(ids(diagnosticar(w.exportarLog()))).toEqual(expect.arrayContaining(['sesion-huerfana', 'unidad-ocupada']))
  })
})
