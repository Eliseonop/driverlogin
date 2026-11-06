import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { horaLog } from '../src/log/leer.js'
import { reconstruir } from '../src/log/reconstruir.js'
import { leerModo, modoEn, textoModo } from '../src/log/venta.js'

const leer = (f, n) => reconstruir(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'), n)
const lineas = (...xs) => xs.map(x => `2026-11-03 ${x}`).reverse().join('\n')

describe('leerModo: las variantes de "SDK de impresión"', () => {
  it.each([
    ['venta directa (sin estado)', { modo: 'directa', colaMax: null }, 'Directa · un boleto a la vez'],
    ['venta en cola (con estado)', { modo: 'cola', porQue: 'con estado', colaMax: null }, 'En cola · hasta 10 (sin cola_max)'],
    ['venta en cola (con estado, cola_max=1: uno por uno)', { modo: 'cola', colaMax: 1 }, 'En cola · uno por uno (cola_max=1)'],
    ['venta en cola (forzada, cola_max=4)', { modo: 'cola', porQue: 'forzada', colaMax: 4 }, 'En cola · hasta 4 boletos (cola_max=4)'],
  ])('%s', (txt, esperado, texto) => {
    const m = leerModo(`🖨️ SDK de impresión: SDK Tcontur · ${txt}`)
    expect(m).toMatchObject({ sdk: 'SDK Tcontur', ...esperado })
    expect(textoModo(m)).toBe(texto)
  })
})

describe('padrón 396 (v1.1.5): venta en cola con cola_max=4', () => {
  const rep = leer('396_2026-11-03_venta-en-cola-max-4.log', '396.log')
  const v = rep.venta

  it('arranca directa hasta leer la impresora y queda en cola con estado, cola_max=4', () => {
    expect(v.tramos.map(t => [horaLog(t.desde), t.modo, t.porQue, t.colaMax])).toEqual([
      ['04:46:50', 'directa', 'sin estado', null],
      ['04:47:03', 'cola', 'con estado', 4],
    ])
    expect(v.tramos[1]).toMatchObject({ impresas: 102, encoladas: 102, detras: 13, maxOcupacion: 4, rechazadas: 1 })
    expect(modoEn(v, rep.hasta).colaMax).toBe(4)
  })

  it('cuántos había en la cola al entrar cada boleto (contando el que imprimía)', () => {
    expect(v.porOcupacion).toEqual({ 1: 89, 2: 7, 3: 4, 4: 2 })
    expect(v.maxOcupacion).toBe(4)
    expect(v.rechazos.map(r => r.tipo)).toEqual(['ocupada'])
  })

  it('impresora N3 al arrancar, N1 al releer; confirma con papel afuera; pulsación 20 ms', () => {
    expect(v.impresoras.map(p => [p.id, p.nivel])).toEqual([['1FC9:2016', 'N3'], ['1FC9:2016', 'N1']])
    expect(v.porConfirma).toEqual({ 'papel afuera (GS ( H)': 102 })
    expect(v.tiempoImpresion).toEqual([20])
    expect(v.ms).toEqual({ mediana: 959, p90: 971, max: 1263 })
    expect(v.resultadoToque).toEqual({ OK: 103, CANCELADO: 6, CORTO: 1 })
  })
})

describe('sin "SDK de impresión": el modo sale de la línea FLUJO de cada boleto', () => {
  const rep = reconstruir(
    lineas(
      '10:00:00 [LogManager] Inicialización de LogManager completa',
      '10:00:05 [VENTA] ENCOLADA job=aaaa1111 boleto=1 nombre="URBANO" tarifa=1.0 num=1 pago=EFECTIVO cola=1/10',
      '10:00:05 [FLUJO] F2/9 COLA [job=aaaa1111 boleto=1 num=1] encolada 1/10 · venta en cola · SDK Tcontur',
      '10:00:06 [VENTA] IMPRESA job=aaaa1111 boleto=1 nombre="URBANO" tarifa=1.0 num=1 pago=EFECTIVO correlativo=9 ms=120 suma=SI confirma=ESTADO(N1)',
      '10:05:00 [PrinterService] 🖨️ SDK de impresión: SDK Tcontur · venta en cola (forzada, cola_max=3)',
      '10:05:10 [SocketMessageDispatcher] 🖨️ Operation cola_max=3 → colaMax(3)',
      '10:06:00 [SdkImpresora] 🖨️ Pantalla: cola_forzada → false',
    ),
    'sintetico.log',
  )
  const v = rep.venta

  it('el tramo de antes se deduce de los boletos y no inventa cola_max', () => {
    expect(v.tramos.map(t => [horaLog(t.desde), t.modo, t.deducido ?? false, t.colaMax])).toEqual([
      ['10:00:00', 'cola', true, null],
      ['10:05:00', 'cola', false, 3],
    ])
    expect(textoModo(v.tramos[0])).toBe('En cola · cola_max sin dato en el log')
    expect(v.tramos[0].impresas).toBe(1)
  })

  it('anota quién cambió la configuración', () => {
    expect(v.cambios.map(c => [c.origen, c.clave, c.valor])).toEqual([
      ['operation', 'cola_max', '3'],
      ['pantalla', 'cola_forzada', 'false'],
    ])
  })
})

describe('padrón 332 (v1.1.5): equipo con la fecha en 2022', () => {
  const rep = leer('332_2026-10-31_fecha-atrasada-2022.log', '332.log')

  it('corre las líneas de 2022 con la corrección de la línea HORA', () => {
    const corridas = rep.entradas.filter(e => e.horaCorregida)
    expect(corridas).toHaveLength(178)
    expect(new Date(rep.desde).toISOString().slice(0, 19)).toBe('2026-10-31T09:21:07')
    expect(rep.hallazgos.some(h => h.titulo === '178 líneas con la fecha del equipo atrasada')).toBe(true)
  })

  it('el GPS ya no sale mudo 39 mil horas', () => {
    expect(rep.gps.tramos.every(s => s.hasta - s.desde < 24 * 3_600_000)).toBe(true)
  })
})
