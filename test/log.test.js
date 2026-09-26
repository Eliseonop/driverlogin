import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { horaLog, leerEntradas, parseStamp } from '../src/log/leer.js'
import { estadoEn, reconstruir, tramoEn } from '../src/log/reconstruir.js'

const a = hhmmss => parseStamp(`2026-09-25 ${hhmmss}`)
const rep132 = reconstruir(fs.readFileSync(new URL('./fixtures/132_2026-09-25_logout-sin-respuesta.log', import.meta.url), 'utf8'), '132.log')
const logouts = rep132.mensajes.filter(m => m.dir === 'tx' && m.header === 'driver_logout')
const titulos = rep132.hallazgos.map(h => h.titulo)

describe('lectura', () => {
  it('ordena un log descendente y pega las líneas sin fecha a la anterior', () => {
    const e = leerEntradas('2026-09-25 10:00:02 [B] dos\n  sigue\n2026-09-25 10:00:01 [A] uno')
    expect(e.map(x => x.tag)).toEqual(['A', 'B'])
    expect(e[1].msg).toBe('dos\n  sigue')
    expect(e[0].n).toBe(3)
  })
})

describe('padrón 132 (v1.0.65): driver_logout sin respuesta', () => {
  it('reconoce el equipo', () => {
    expect(rep132.info).toMatchObject({ padron: 132, unidad: 23, versiones: ['1.0.65'] })
  })

  it('el primer cierre sale en el mismo segundo en que el watchdog corta el socket y no se reintenta', () => {
    const [primero] = logouts
    expect(horaLog(primero.t)).toBe('10:13:47')
    expect(primero).toMatchObject({ sesion: 35609, sid: 529, sinRespuesta: true })
    expect(primero.corte).toMatchObject({ causa: 'watchdog', sid: 529, t: primero.t })
    expect(primero.reconexion).toMatchObject({ sid: 530, reintento: false })
  })

  it('el segundo cierre va por un socket vivo y tampoco tiene respuesta', () => {
    const segundo = logouts[1]
    expect(horaLog(segundo.t)).toBe('10:15:59')
    expect(segundo).toMatchObject({ sid: 530, sinRespuesta: true })
    expect(segundo.corte).toBeUndefined()
    expect(segundo.rxDespues).toBeGreaterThan(5)
  })

  it('el equipo se queda con la 35609 todo el día', () => {
    expect(rep132.equipo).toHaveLength(1)
    expect(rep132.equipo[0]).toMatchObject({ sesion: 35609, lado: false, desde: a('06:28:57') })
    expect(rep132.equipo[0].hasta).toBe(rep132.hasta)
  })

  it('la central: 35609 hasta el cierre y después la 35631 deducida por las órdenes', () => {
    expect(rep132.central.map(c => [c.sesion, c.estado])).toEqual([
      [35609, 'confirmada'],
      [35631, 'inferida'],
    ])
    expect(rep132.central[1]).toMatchObject({ desde: a('10:13:47'), cerro: 35609 })
  })

  it('las 16 órdenes operation sesion=35631 quedan sin procesar', () => {
    const ops = rep132.mensajes.filter(m => m.header === 'operation')
    expect(ops).toHaveLength(16)
    expect(ops.every(m => m.procesada === false && m.data.value === '35631')).toBe(true)
  })

  it('cuenta los boletos vendidos con la sesión que la central ya había cerrado', () => {
    const despues = rep132.boletos.filter(b => b.sesion === 35609 && b.t > logouts[0].t)
    expect(despues).toHaveLength(88)
    expect(despues.reduce((s, b) => s + b.precio, 0)).toBe(13800)
  })

  it('hallazgos', () => {
    expect(titulos).toEqual(
      expect.arrayContaining([
        'driver_logout #35609 sin respuesta (10:13:47)',
        'driver_logout #35609 sin respuesta (10:15:59)',
        'La sesión #35609 nunca se cerró en el equipo',
        'Orden operation sesion=35631 ignorada',
        'Viaje lado B con sesión #35609 de lado A',
      ]),
    )
    expect(rep132.hallazgos.find(h => h.titulo.startsWith('Orden')).detalle.join(' ')).toMatch(/B automática/)
    expect(rep132.hallazgos.find(h => /reconexiones por watchdog/.test(h.titulo))).toBeTruthy()
  })

  it('estado a mediodía: bus en B, equipo con la A y central con la 35631', () => {
    const st = estadoEn(rep132, a('12:00:00'))
    expect(st.bus.lado).toBe(true)
    expect(st.bus.f).toBeGreaterThan(0)
    expect(st.equipo).toMatchObject({ sesion: 35609, lado: false })
    expect(st.central).toMatchObject({ sesion: 35631 })
    expect(st.viaje).toMatchObject({ lado: true, estado: 'R' })
  })

  it('mientras espera la respuesta del cierre lo marca como pendiente', () => {
    expect(estadoEn(rep132, a('10:16:30')).esperandoLogout?.t).toBe(logouts[1].t)
    expect(estadoEn(rep132, a('10:17:30')).esperandoLogout).toBeUndefined()
  })
})

describe('log con los logs nuevos (1.0.69) y flujo normal', () => {
  const L = (h, tag, msg) => `2026-09-23 ${h} [${tag}] ${msg}`
  const S = 'SocketService'
  const texto = [
    L('06:00:00', S, '✅ CONECTADO [ID: 1] en 10ms - Code: 101'),
    L('06:00:01', S, '[ENVIADO] | [NUEVO] (21B) [KEY]: driver_login [DATA]: {route=1, dni=40000001, key=0001, direction=false, vehicle=15}'),
    L('06:00:01', S, '[RECIBIDO]| #2 | SID:1 | 74B | driver_login [DATA]: {sessions=[{id=101, direction=false, route=1, driver_code=ID1}], error=false, title=Acceso permitido, message=Se ha creado una nueva sesión}'),
    L('06:00:01', 'DriverSessionCoordinator', "Sesión activada: 101 lado=A 'Se ha creado una nueva sesión'"),
    L('07:00:00', S, '[ENVIADO] | [NUEVO] (32B) [KEY]: driver_logout [DATA]: {session=101, vehicle=15, end_time=2026-09-23T07:00:00.1, cash=0, digital=0}'),
    L('07:00:01', S, '[RECIBIDO]| #3 | SID:1 | 59B | driver_logout [DATA]: {id=101, error=false, title=Sesión Cerrada, message=Se cerró la sesión correctamente}'),
    L('07:00:01', 'DriverSessionCoordinator', "Logout confirmado: 101 lado=A autoRetorno=true 'Sesión Cerrada'"),
    L('07:00:02', S, '[RECIBIDO]| #4 | SID:1 | 85B | driver_login [DATA]: {sessions=[{id=102, direction=true, route=1, driver_code=ID1}], error=false, title=Acceso permitido, message=Se ha creado una nueva sesión automática}'),
    L('07:00:30', S, '[RECIBIDO]| #5 | SID:1 | 48B | operation [DATA]: {section=remote, id=abc, value=102, key=sesion}'),
    L('07:00:30', S, '[ENVIADO] | [NUEVO] (4B) [KEY]: operation [DATA]: {id=abc}'),
    L('07:00:30', 'SocketMessageDispatcher', 'Processing operation: ProtoOperation(id=abc, section=remote, key=sesion, value=102)'),
  ].join('\n')
  const rep = reconstruir(texto, 'normal.log')
  const t = h => parseStamp(`2026-09-23 ${h}`)

  it('empareja el cierre con su respuesta y la B automática queda como espontánea', () => {
    const [logout] = rep.mensajes.filter(m => m.header === 'driver_logout' && m.dir === 'tx')
    expect(logout.respuesta.t - logout.t).toBe(1000)
    expect(rep.mensajes.find(m => m.dir === 'rx' && m.data.sessions?.[0]?.id === 102).espontanea).toBe(true)
  })

  it('carriles del equipo y la central', () => {
    expect(rep.equipo.map(s => s.sesion)).toEqual([101, 102])
    expect(tramoEn(rep.equipo, t('07:00:01'))).toBeNull()
    expect(rep.central.map(s => [s.sesion, s.estado])).toEqual([
      [101, 'confirmada'],
      [102, 'confirmada'],
    ])
  })

  it('la orden procesada no es un hallazgo', () => {
    expect(rep.mensajes.find(m => m.header === 'operation' && m.dir === 'rx').procesada).toBe(true)
    expect(rep.hallazgos.filter(h => h.nivel === 'error')).toEqual([])
  })
})
