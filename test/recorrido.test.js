import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { horaLog, parseStamp } from '../src/log/leer.js'
import { reconstruir } from '../src/log/reconstruir.js'
import { aCsv, buscarEnLog, desfase, porQueSeCorta, recortar, recorrido } from '../src/log/recorrido.js'

const rep = reconstruir(fs.readFileSync(new URL('./fixtures/420_2026-10-07_marcas-central-desfasadas.log', import.meta.url), 'utf8'), '420.log')
const r = recorrido(rep)
const fila = nombre => r.viajes[0].filas.find(f => f.nombre === nombre)

describe('padrón 420 (v1.0.72): marcas de geocerca con hora corrida', () => {
  it('lee posiciones, entradas del equipo, marcas de la central y paraderos', () => {
    expect(r.pos.length).toBe(917)
    expect(r.entra.length).toBe(23)
    expect(r.marcas.length).toBe(23)
    expect(r.sinMarca.length).toBe(0)
    expect(r.paraderos.length).toBeGreaterThan(90)
  })

  it('arma el viaje 44454 con la hora programada de la plataforma', () => {
    const [v] = r.viajes
    expect(v.trip).toBe('44454')
    expect(v.filas.length).toBe(43)
    expect(horaLog(v.filas[0].prog)).toBe('09:48:00')
    expect(horaLog(fila('BASADRE A').prog)).toBe('09:58:00')
  })

  it('la central estampa +4:20:31 en BASADRE A aunque el equipo entró 09:57:41', () => {
    const m = fila('BASADRE A').marca
    expect(horaLog(m.entrada.t)).toBe('09:57:41')
    expect(horaLog(m.hora)).toBe('14:18:12')
    expect(desfase(m.delta)).toBe('+4:20:31')
    expect(m.dateros).toEqual([])
  })

  it('las marcas con dateros salen con la hora del equipo', () => {
    const m = fila('ALAMOS A').marca
    expect(horaLog(m.hora)).toBe('09:53:23')
    expect(m.delta).toBe(0)
    expect(m.dateros.length).toBe(4)
  })

  it('culpa a la central: reloj del equipo bien y nunca envió la hora errónea', () => {
    expect(r.veredicto).toMatchObject({ culpa: 'central', malas: 18, buenas: 5, relojOk: true, nuncaEnviada: true, sinDateros: 18, conDateros: 5 })
    expect(r.veredicto.offset.dispersion).toBeLessThanOrEqual(3000)
  })
})

describe('rango y CSV', () => {
  const de = h => parseStamp(`2026-10-07 ${h}`)
  const c = recortar(r, de('11:00:00'), de('11:30:00'))

  it('recorta posiciones, marcas y veredicto al rango', () => {
    expect(c.marcas.map(m => m.entrada.nombre)).toEqual(['BOLOGNESI A', 'HOSPI. NIÑO A', '15 BRASIL', 'SAN FELIPE A', 'JAVIER PRADO A', 'EJERCITO A'])
    expect(c.veredicto).toMatchObject({ malas: 6, buenas: 0, culpa: 'central' })
    expect(c.pos.every(p => p.t >= de('11:00:00') && p.t <= de('11:30:00'))).toBe(true)
    expect(c.viajes.map(v => v.trip)).toEqual(['44454'])
  })

  it('arma el CSV con una fila por posición', () => {
    const lineas = aCsv(c.pos).split('\n')
    expect(lineas[0]).toBe('fecha_hora,lat,lng,velocidad_kmh,precision_m,angulo,trip,estado,enviada')
    expect(lineas.length).toBe(c.pos.length + 1)
    expect(lineas[1]).toMatch(/^2026-10-07 11:00:\d\d,-12\.\d+,-77\.\d+,/)
  })
})

describe('buscar un comando en el log', () => {
  const de = h => parseStamp(`2026-10-07 ${h}`)

  it('encuentra las marcas de la central del rango con la posición del bus', () => {
    const { hallados, total } = buscarEnLog(rep.entradas, r.pos, '| mark [data]', de('11:00:00'), de('11:30:00'))
    expect(total).toBe(6)
    expect(hallados.map(h => horaLog(h.t))).toEqual(['11:00:04', '11:04:16', '11:10:46', '11:14:40', '11:19:10', '11:25:40'])
    expect(hallados.every(h => h.p && Math.abs(h.p.t - h.t) < 5 * 60_000)).toBe(true)
  })

  it('no busca con menos de 3 letras y corta en el máximo', () => {
    expect(buscarEnLog(rep.entradas, r.pos, 'ma', rep.desde, rep.hasta).total).toBe(0)
    const { hallados, total } = buscarEnLog(rep.entradas, r.pos, 'report', rep.desde, rep.hasta, 50)
    expect(hallados.length).toBe(50)
    expect(total).toBeGreaterThan(50)
  })
})

describe('cortes de conexión en el recorrido', () => {
  const rep132 = reconstruir(fs.readFileSync(new URL('./fixtures/132_2026-09-25_logout-sin-respuesta.log', import.meta.url), 'utf8'), '132.log')
  const { cortes } = recorrido(rep132)
  const a = h => cortes.find(c => horaLog(c.t) === h)

  it('ubica cada caída del socket con su causa y cuánto tardó en volver', () => {
    expect(cortes.length).toBe(78)
    expect(cortes.every(c => c.p)).toBe(true)
    const c = a('13:55:00')
    expect(c.sid).toBe(557)
    expect(porQueSeCorta(c)).toBe('falla de red del equipo: Software caused connection abort')
    expect(c.fuera).toBe(45_000)
    expect(c.intentos).toBe(4)
    expect(c.lineas.find(l => l.propia).msg).toMatch(/onFailure.*Software caused connection abort/)
  })

  it('el watchdog dice cuánto silencio hubo y los intentos delatan el portal del operador', () => {
    expect(porQueSeCorta(a('14:55:41'))).toBe('el watchdog lo cerró: 139 s sin mensajes del servidor')
    expect(a('15:34:43').pista).toMatch(/portal del operador/)
    // Sin el puerto local de cada intento, los tres intentos iguales quedan en un solo motivo.
    expect(a('15:34:43').motivos).toEqual(['failed to connect to portal.movistar.com.pe/20.10.219.140 (port 8080) after 15000ms'])
  })

  it('recortar deja solo los cortes del rango', () => {
    const r = recortar(recorrido(rep132), parseStamp('2026-09-25 13:50:00'), parseStamp('2026-09-25 14:05:00'))
    expect(r.cortes.every(c => c.t >= parseStamp('2026-09-25 13:50:00') && c.t <= parseStamp('2026-09-25 14:05:00'))).toBe(true)
    expect(r.cortes.map(c => horaLog(c.t))).toContain('14:01:17')
  })
})
