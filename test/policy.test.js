// Mismos casos que los tests Kotlin de app/src/test/.../session/ para asegurar que el port es fiel.
import { describe, it, expect } from 'vitest'
import * as P from '../src/engine/policy.js'
import { distA } from '../src/engine/geo.js'
import RUTA from '../src/data/ruta124.js'

const ps = RUTA.paraderos
const por = n => ps.find(p => p.nombre === n)
const desde = p => x => distA({ lat: p.latitud, lng: p.longitud }, x)
const ladoEn = p => P.calculateLado(P.nearestOrden1(ps, desde(p)))
const A = false
const B = true

describe('lado del login', () => {
  it('orden 1 más cercano decide el lado', () => {
    expect(ladoEn(por('PRDO INICIAL'))).toBe(A)
    expect(ladoEn(por('AV. CENTRAL'))).toBe(A)
    expect(ladoEn(por('Butter'))).toBe(B)
    expect(ladoEn(por('PDRO SURCO'))).toBe(B)
  })
  it('sin paradero orden 1 → A', () => {
    expect(P.calculateLado(null)).toBe(A)
    expect(P.nearestOrden1([], desde(por('Butter')))).toBeNull()
    expect(P.nearestOrden1([por('AV. CENTRAL'), por('Butter')], desde(por('Butter')))).toBeNull()
  })
})

describe('paradero inicial y en radio', () => {
  it('orden 1 del lado de la sesión', () => {
    expect(P.paraderoInicial(ps, A).nombre).toBe('PRDO INICIAL')
    expect(P.paraderoInicial(ps, B).nombre).toBe('PDRO SURCO')
    expect(P.paraderoInicial([], A)).toBeNull()
  })
  it('solo considera paraderos del lado pedido', () => {
    expect(P.paraderoEnRadio(ps, A, desde(por('Butter'))).nombre).toBe('Butter')
    expect(P.paraderoEnRadio(ps, B, desde(por('Butter')))).toBeNull()
  })
})

describe('cierre en terminal', () => {
  const ses = direction => ({ id: 1, direction })
  it('mismo lado y terminal/liquidar → cierra', () => {
    expect(P.shouldCloseAtTerminal(ses(A), por('Butter'))).toBe(true)
    expect(P.shouldCloseAtTerminal(ses(B), por('PORTÓN'))).toBe(true)
  })
  it('lado distinto, paradero común o nulos → no cierra', () => {
    expect(P.shouldCloseAtTerminal(ses(B), por('Butter'))).toBe(false)
    expect(P.shouldCloseAtTerminal(ses(A), por('AV. CENTRAL'))).toBe(false)
    expect(P.shouldCloseAtTerminal(null, por('Butter'))).toBe(false)
    expect(P.shouldCloseAtTerminal(ses(A), null)).toBe(false)
  })
})

describe('config de retorno', () => {
  const cfg = (nombre, data, ruta = 1) => ({ nombre, ruta, data })
  it('solo booleano true de la misma ruta', () => {
    expect(P.isRouteConfigEnabled([cfg('retorno_auto_b', true)], 1, 'retorno_auto_b')).toBe(true)
    expect(P.isRouteConfigEnabled([cfg('retorno_auto_b', 'true')], 1, 'retorno_auto_b')).toBe(false)
    expect(P.isRouteConfigEnabled([cfg('retorno_auto_b', 1)], 1, 'retorno_auto_b')).toBe(false)
    expect(P.isRouteConfigEnabled([cfg('retorno_auto_b', true, 2)], 1, 'retorno_auto_b')).toBe(false)
    expect(P.isRouteConfigEnabled([], 1, 'retorno_auto_b')).toBe(false)
  })
  it('usa la primera coincidencia', () => {
    expect(P.isRouteConfigEnabled([cfg('retorno_auto_b', 'true'), cfg('retorno_auto_b', true)], 1, 'retorno_auto_b')).toBe(false)
  })
})

describe('autoretorno', () => {
  const cerrada = (direction, dni = '40000001', password = '0001') => ({ id: 1, route: 1, direction, dni, password })
  const ambos = [
    { nombre: 'retorno_auto_b', ruta: 1, data: true },
    { nombre: 'retorno_auto_a', ruta: 1, data: true },
  ]
  it('cerrar A abre B con retorno_auto_b; cerrar B abre A con retorno_auto_a', () => {
    expect(P.autoRetorno(cerrada(A), ambos)).toEqual({ tipo: 'Abrir', lado: B, configName: 'retorno_auto_b', dni: '40000001', password: '0001' })
    expect(P.autoRetorno(cerrada(B), ambos)).toMatchObject({ tipo: 'Abrir', lado: A, configName: 'retorno_auto_a' })
  })
  it('sin config o sin credenciales no abre', () => {
    expect(P.autoRetorno(cerrada(B), [ambos[0]])).toEqual({ tipo: 'NoConfigurado', configName: 'retorno_auto_a' })
    expect(P.autoRetorno(cerrada(A, null), ambos)).toEqual({ tipo: 'SinCredenciales' })
    expect(P.autoRetorno(cerrada(A, '40000001', ''), ambos)).toEqual({ tipo: 'SinCredenciales' })
  })
})

describe('cierre remoto, credenciales y restauración', () => {
  it('cierreRemoto', () => {
    expect(P.cierreRemoto(null)).toEqual({ tipo: 'NoEncontrada' })
    expect(P.cierreRemoto({ id: 5, finalizado: true })).toEqual({ tipo: 'YaFinalizada' })
    expect(P.cierreRemoto({ id: 5, finalizado: false })).toEqual({ tipo: 'Cerrar', sessionId: 5 })
  })
  it('parseCredenciales separa por el primer espacio', () => {
    expect(P.parseCredenciales('40000001 0001')).toEqual(['40000001', '0001'])
    expect(P.parseCredenciales('  40000001   clave con espacios ')).toEqual(['40000001', 'clave con espacios'])
    expect(P.parseCredenciales('40000001')).toBeNull()
    expect(P.parseCredenciales('')).toBeNull()
    expect(P.parseCredenciales(null)).toBeNull()
  })
  it('restaurar: ayer se cierra, hoy se restaura', () => {
    const e = (start_time, id = 9) => ({ id, start_time, direction: A, autoLogin: false })
    expect(P.restaurar(null, '2026-09-23')).toEqual({ tipo: 'Nada' })
    expect(P.restaurar(e('2026-09-22T23:59:00'), '2026-09-23')).toEqual({ tipo: 'CerrarVencida', sessionId: 9 })
    expect(P.restaurar(e('2026-09-23T06:18:59'), '2026-09-23')).toMatchObject({ tipo: 'Restaurar', session: { id: 9 } })
  })
})

describe('LogoutIntents y OperationDeduper', () => {
  it('el bloqueo se consume una sola vez', () => {
    const li = new P.LogoutIntents()
    li.onLogoutRequested(1, false, false)
    expect(li.consumeLoginBlock()).toBe(true)
    expect(li.consumeLoginBlock()).toBe(false)
  })
  it('autoretorno pendiente por sesión, el último pedido gana', () => {
    const li = new P.LogoutIntents()
    li.onLogoutRequested(1, true, true)
    li.onLogoutRequested(1, true, false)
    expect(li.consumeAutoRetorno(1)).toBe(false)
    li.onLogoutRequested(2, true, true)
    expect(li.consumeAutoRetorno(2)).toBe(true)
    expect(li.consumeAutoRetorno(2)).toBe(false)
  })
  it('deduper recuerda los últimos N ids', () => {
    const d = new P.OperationDeduper(2)
    expect(d.markHandled('a')).toBe(true)
    expect(d.markHandled('a')).toBe(false)
    d.markHandled('b')
    d.markHandled('c')
    expect(d.markHandled('a')).toBe(true)
  })
})
