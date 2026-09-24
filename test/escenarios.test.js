import { describe, it, expect } from 'vitest'
import { ESCENARIOS, correrEscenario } from '../src/engine/scenarios.js'

describe.each(ESCENARIOS.map(e => [e.grupo, e.id, e]))('%s', (_grupo, id, esc) => {
  it(`${id}: ${esc.titulo}${esc.riesgo ? ' [riesgo]' : ''}`, () => {
    const r = correrEscenario(esc)
    const fallas = r.checks.filter(c => !c.ok).map(c => c.texto)
    expect(fallas).toEqual([])
  })
})

describe('determinismo', () => {
  it('el mismo guion produce el mismo log', () => {
    const esc = ESCENARIOS.find(e => e.id === 'ciclo-a-b-a')
    expect(correrEscenario(esc).world.exportarLog()).toBe(correrEscenario(esc).world.exportarLog())
  })
})
