import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { horaLog, parseStamp } from '../src/log/leer.js'
import { reconstruir } from '../src/log/reconstruir.js'
import { creadoEnServidor, emergencias } from '../src/log/emergencia.js'
import { recorrido } from '../src/log/recorrido.js'

const leer = (archivo, nombre) => reconstruir(fs.readFileSync(new URL(`./fixtures/${archivo}`, import.meta.url), 'utf8'), nombre)

describe('padrón 347 (v1.1.0): emergencia desde la pantalla, se apaga al contestar a monitoreo', () => {
  const rep = leer('347_2026-11-04_emergencia-pantalla-llamada.log', '347.log')
  const { eventos, tramos, idEmergencia } = emergencias(rep)
  const [activa, llamada, apagada] = eventos

  it('activa 21:46:53 desde la pantalla: sin botón físico ni orden remota', () => {
    expect(idEmergencia).toBe('7')
    expect(horaLog(activa.t)).toBe('21:46:53')
    expect(activa).toMatchObject({ tipo: 'emergencia', activa: true, ignorado: false })
    expect(activa.origen).toMatchObject({ clase: 'pantalla', deducido: true })
    expect(activa.report).toMatchObject({ id: '7', value: 1, trip: 56599 })
    expect(horaLog(activa.ack)).toBe('21:46:53')
  })

  it('21:47:58 pide llamada por la tarjeta Soporte (evento 6, no es la emergencia)', () => {
    expect(horaLog(llamada.t)).toBe('21:47:58')
    expect(llamada).toMatchObject({ tipo: 'llamada', activa: true })
    expect(llamada.report).toMatchObject({ id: '6', value: 1, trip: 0 })
  })

  it('21:48:24 se apaga sola al contestar la llamada de monitoreo', () => {
    expect(horaLog(apagada.t)).toBe('21:48:24')
    expect(apagada).toMatchObject({ tipo: 'emergencia', activa: false })
    expect(apagada.origen).toMatchObject({ clase: 'llamada', detalle: '+51900000000', quien: 'MONITOREO 1 SANTO CRISTO DE PACHACAMILLA', deducido: false })
    expect(horaLog(apagada.origen.fin)).toBe('21:50:27')
    expect(apagada.report).toMatchObject({ id: '7', value: 0 })
    expect(eventos.length).toBe(3)
  })

  it('un tramo de 1 min 31 s, con lugar y líneas para el mapa', () => {
    expect(tramos.length).toBe(1)
    expect(tramos[0].dura).toBe(91_000)
    const r = recorrido(rep)
    const e = r.emergencias.eventos[0]
    expect(e.p).toMatchObject({ lat: -12.198344, lng: -76.9522941 })
    expect(e.lineas.some(x => x.propia && x.tag === 'EmergencyRepository')).toBe(true)
    expect(r.emergencias.tramos[0].ruta.length).toBeGreaterThan(10)
  })
})

const linea = (h, tag, msg) => `2026-11-04 ${h} [${tag}] ${msg}`
const report = (h, value) =>
  linea(h, 'SocketService', `[ENVIADO] | [NUEVO] (39B) [KEY]: report [DATA]: {trip=1, route=2, positions=[{lng=-77.0, busstop=0, angle=0, accuracy=3, time=2026-11-04T${h}.100000, lat=-12.0, speed=0, mark=0}], state=R, sales=0, events=[{value=${value}, id=7}], direction=true}`)
const ack = h => linea(h, 'SocketService', '[RECIBIDO]| #1 | SID:1 | 3B | report [DATA]: {positions=1}')
const sintetico = lineas => reconstruir(lineas.join('\n'), 'sintetico.log')

describe('origen de la emergencia por las líneas del log', () => {
  it('botón físico: doble pulsación y sostenida (1.1.6) y una pulsación (≤1.1.5)', () => {
    const { eventos } = emergencias(sintetico([
      linea('10:00:00', 'ShutterEmergencyHandler', 'Doble pulsación (25, 420 ms) → ACTIVANDO EMERGENCIA — shutterAvailable=false'),
      linea('10:00:00', 'EmergencyRepository', 'send(deactivate=false) called'),
      report('10:00:00', 1), ack('10:00:01'),
      linea('10:05:00', 'EmergencyRepository', 'send(deactivate=true) called'),
      report('10:05:00', 0),
      linea('10:10:00', 'ShutterEmergencyHandler', 'Pulsación sostenida (79, 2600 ms) → ACTIVANDO EMERGENCIA — shutterAvailable=false'),
      linea('10:10:00', 'EmergencyRepository', 'send(deactivate=false) called'),
      report('10:10:01', 1),
      linea('10:20:00', 'ShutterEmergencyHandler', 'Evento válido detectado (24) → ACTIVANDO EMERGENCIA'),
      linea('10:20:00', 'EmergencyRepository', 'send(deactivate=false) ignorado — ya está en ese estado'),
    ]))
    expect(eventos.map(e => [horaLog(e.t), e.activa, e.ignorado, e.origen.clase, e.origen.detalle])).toEqual([
      ['10:00:00', true, false, 'boton', 'doble pulsación (vol− 25, 420 ms entre las dos)'],
      ['10:05:00', false, false, 'pantalla', 'botón Emergencia otra vez: sin llamada ni orden remota junto al envío'],
      ['10:10:00', true, false, 'boton', 'mantenido 2.6 s (jack 79)'],
      ['10:20:00', true, true, 'boton', 'una pulsación (vol+ 24)'],
    ])
    expect(horaLog(eventos[0].ack)).toBe('10:00:01')
    expect(eventos[1].ack).toBe(null)
  })

  it('servidor (com_panic_button con su hora de creación) y operation', () => {
    const id = BigInt('0x6aea914257b961e1b9b6ff5a').toString()
    const { eventos, tramos } = emergencias(sintetico([
      linea('20:58:26', 'SocketMessageDispatcher', `🆘 com_panic_button (PB) recibido: id=${id}, state=true`),
      linea('20:58:26', 'EmergencyRepository', 'send(deactivate=false) called'),
      report('20:58:26', 1),
      linea('21:00:00', 'SocketMessageDispatcher', `🆘 com_panic_button (PB) recibido: id=${id}, state=true — ya aplicado, solo ACK`),
      linea('21:01:00', 'SocketMessageDispatcher', '🚨 Operation emergencia=off → desactivar'),
      linea('21:01:00', 'EmergencyRepository', 'send(deactivate=true) called'),
      report('21:01:00', 0),
    ]))
    expect(eventos.map(e => [e.activa, e.origen.clase])).toEqual([[true, 'servidor'], [false, 'operation']])
    expect(horaLog(eventos[0].origen.creado)).toBe('20:58:26')
    expect(tramos[0].dura).toBe(154_000)
  })

  it('1.1.6: pantalla con su línea, y contestar la llamada cierra el pedido sin apagar la emergencia', () => {
    const reportLlamada = (h, value) => report(h, value).replace('id=7', 'id=6')
    const { eventos, tramos } = emergencias(sintetico([
      linea('21:46:53', 'SoporteCardViewModel', 'Pantalla: botón Emergencia → activar'),
      linea('21:46:53', 'EmergencyRepository', 'send(deactivate=false) called'),
      report('21:46:53', 1),
      linea('21:47:58', 'SoporteCardViewModel', 'Pantalla: botón Llamada → activar'),
      reportLlamada('21:47:58', 1),
      linea('21:48:24', 'CallRepository', "New state: ACTIVE - Phone : '+51900000000'"),
      linea('21:48:24', 'CallViewModel', '🔊 Anunciando llamada activa: Llamada conectada con MONITOREO 1'),
      linea('21:48:24', 'SoporteCardViewModel', 'Llamada contestada → cierra el pedido de llamada · la emergencia sigue activa'),
      reportLlamada('21:48:24', 0),
      linea('21:52:00', 'SoporteCardViewModel', 'Pantalla: botón Emergencia → apagar'),
      linea('21:52:00', 'EmergencyRepository', 'send(deactivate=true) called'),
      report('21:52:00', 0),
    ]))
    expect(eventos.map(e => [horaLog(e.t), e.tipo, e.activa, e.origen.clase, e.origen.deducido])).toEqual([
      ['21:46:53', 'emergencia', true, 'pantalla', false],
      ['21:47:58', 'llamada', true, 'pantalla', false],
      ['21:48:24', 'contestada', true, 'llamada', false],
      ['21:48:24', 'llamada', false, 'llamada', false],
      ['21:52:00', 'emergencia', false, 'pantalla', false],
    ])
    expect(eventos[2].origen.quien).toBe('MONITOREO 1')
    expect(tramos.map(x => [horaLog(x.desde.t), horaLog(x.hasta.t)])).toEqual([['21:46:53', '21:52:00']])
  })

  it('botón atascado se lista aunque no active', () => {
    const { eventos, tramos } = emergencias(sintetico([linea('09:00:07', 'ShutterEmergencyHandler', 'Soltada tras 7200 ms (25) — pasa de 6000 ms, posible botón atascado: no activa')]))
    expect(eventos).toMatchObject([{ tipo: 'atascado', origen: { detalle: 'soltado tras 7.2 s (vol− 25): no activa' } }])
    expect(tramos).toEqual([])
  })

  it('ObjectId en decimal → hora de Lima', () => {
    expect(creadoEnServidor('33088985649798716649196945242')).toBe(parseStamp('2026-11-03 20:58:26'))
    expect(creadoEnServidor('no')).toBe(null)
  })
})
