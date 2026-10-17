import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cruzar, leerPlataforma } from '../src/log/plataforma.js'
import { reconstruir } from '../src/log/reconstruir.js'

const rep = reconstruir(fs.readFileSync(new URL('./fixtures/135_2026-10-16_boletos-tras-liquidacion.log', import.meta.url), 'utf8'), '135.log')
const ses = id => rep.cuadre.sesiones.find(s => s.id === id)

describe('padrón 135 (v1.1.2): boletos vendidos mientras se cerraba la sesión', () => {
  it('la A de la tarde cuadra al céntimo', () => {
    const a = ses(45440)
    expect(a).toMatchObject({ estado: 'cuadra', lado: false, cierre: 'T', montoEnv: 10500, dif: 0 })
    expect(a.liq).toMatchObject({ total: 10500, primero: 5378, ultimo: 5445 })
    expect(a.motivos).toEqual([])
  })

  it('la B liquidó S/ 211 y mandó S/ 216 en boletos: 5 escolares después del corte', () => {
    const b = ses(45528)
    expect(b).toMatchObject({ estado: 'no-cuadra', lado: true, cierre: 'T', montoEnv: 21600, dif: 500, ultimoSales: 21600 })
    expect(b.liq).toMatchObject({ total: 21100, primero: 5446, ultimo: 5575 })
    const t7 = b.tarifas.find(x => x.fare === 7)
    expect(t7).toMatchObject({ nombre: 'URBAN/UNIV/ESC.', precio: 100, dif: 500 })
    expect(t7.liq).toMatchObject({ desde: 1915, hasta: 1946, n: 32, monto: 3200 })
    expect(t7.env).toMatchObject({ desde: 1915, hasta: 1951, n: 37, monto: 3700 })
    expect(t7.fuera.map(x => x.numero)).toEqual([1947, 1948, 1949, 1950, 1951])
    expect(b.tarifas.filter(x => x.fare !== 7).every(x => x.dif === 0)).toBe(true)
  })

  it('explica el porqué: corte 5575, central confirma con 2 ya vendidos, la app suelta la sesión a las 22:02:51', () => {
    const [m] = ses(45528).motivos
    expect(m).toMatchObject({ tipo: 'despues', nivel: 'error', monto: 500 })
    expect(m.boletos.map(x => x.correlativo)).toEqual([5576, 5577, 5578, 5579, 5580])
    const txt = m.detalle.join(' ')
    expect(txt).toMatch(/22:02:50\.074/)
    expect(txt).toMatch(/correlativo 5575/)
    expect(txt).toMatch(/n° 1947–1951 de URBAN\/UNIV\/ESC\./)
    expect(txt).toMatch(/con 2 de esos boletos ya vendidos/)
    expect(txt).toMatch(/recién a las 22:02:51/)
    expect(txt).toMatch(/ninguna liquidación enviada los incluye/)
  })

  it('el momento del cierre sigue el orden de las líneas', () => {
    const tipos = ses(45528).momento.map(x => (x.tipo === 'boleto' ? `${x.b.numero}${x.b.respecto === 'despues' ? '!' : ''}` : x.tipo))
    expect(tipos).toEqual(['1492', '1493', '1494', 'terminal', 'solicitud', 'liquidacion', '1947!', '1948!', 'central', '1949!', '1950!', '1951!', 'soltada', 'impresa'])
  })

  it('el papel de la vuelta (22:02:52) dice B S/ 216 porque se suma de nuevo al imprimir; a la central fue S/ 211', () => {
    const [vuelta] = rep.cuadre.impresiones.filter(p => p.sesiones.includes(45528))
    expect(vuelta).toMatchObject({ modo: 'VUELTA', sesiones: [45440, 45528], estado: 'impresa', total: 32100 })
    const b = ses(45528).papel
    expect(b).toMatchObject({ total: 21600, produccion: 21600, pasajeros: 135, pagos: { efectivo: 21600, canje: 0 } })
    expect(b.filas.find(x => x.fare === 7)).toMatchObject({ cant: 37, corrDesde: 5446, corrHasta: 5580, produccion: 3700 })
    expect(ses(45440).papel.total).toBe(10500)
    expect(ses(45528).motivos[0].detalle.join(' ')).toMatch(/el papel dice S\/ 216\.00 .* a la central le llegó S\/ 211\.00/)
  })

  it('aparece en los hallazgos y abre la pestaña Cuadre', () => {
    const h = rep.hallazgos.find(x => x.vista === 'cuadre')
    expect(h).toMatchObject({ nivel: 'error', sesion: 45528 })
    expect(h.titulo).toBe('Sesión #45528 no cuadra: liquidó S/ 211.00 y la plataforma suma S/ 216.00')
  })

  it('reconoce el cierre por terminal de 1.1.x (logout solicitado con cierre=T)', () => {
    expect(rep.eventos.filter(e => e.tipo === 'logoutSolicitado').map(e => e.cierre)).toEqual(['T', 'T'])
    expect(rep.eventos.filter(e => e.tipo === 'terminal').map(e => e.sesion)).toEqual([45440, 45528])
  })
})

describe('padrón 441 (v1.1.2): dos reinicios borran boletos de la base del equipo', () => {
  const r441 = reconstruir(fs.readFileSync(new URL('./fixtures/441_2026-10-16_reinicio-borra-boletos.log', import.meta.url), 'utf8'), '441.log')
  const b = r441.cuadre.sesiones.find(s => s.id === 45202)

  it('se detectan los dos reinicios con pérdida: 06:43 (corr. 12886–12893) y 07:29 (12914)', () => {
    expect(r441.cuadre.perdidas.map(p => [p.desde, p.hasta, p.impresos.length])).toEqual([
      [12886, 12893, 8],
      [12914, 12914, 1],
    ])
  })

  it('suma boleto por boleto: impreso S/ 403 (199) → central S/ 398 (197) → equipo al cerrar S/ 382 (190) = liquidación', () => {
    expect(b.impresos).toMatchObject({ n: 199, monto: 40300 })
    expect(b.boletos).toHaveLength(197)
    expect(b.montoEnv).toBe(39800)
    expect(b.room).toEqual({ n: 190, monto: 38200 })
    expect(b.liq.total).toBe(38200)
    expect(b.papel.total).toBe(38200)
    expect(b.dif).toBe(1600)
  })

  it('los correlativos reutilizados son boletos distintos (el 12887 fue n° 1780 INTERURBANO y después n° 3794 URBANO)', () => {
    const v = b.boletos.filter(x => x.correlativo === 12887).map(x => [x.fare, x.numero, !!x.perdidoEn])
    expect(v).toEqual([
      [12, 1780, true],
      [10, 3794, false],
    ])
  })

  it('explica cada reinicio y cierra por terminal PALMERAS B', () => {
    expect(b.cerro).toMatchObject({ codigo: 'T', texto: 'llegada al terminal PALMERAS B' })
    const [m643, m729] = b.motivos.filter(m => m.tipo.startsWith('reinicio'))
    expect(m643).toMatchObject({ nivel: 'error', monto: 1900 })
    expect(m643.detalle.join(' ')).toMatch(/7 habían llegado a la central \(S\/ 16\.00\).*1 se imprimió y no se llegó a enviar \(S\/ 3\.00\)/)
    expect(m643.detalle.join(' ')).toMatch(/n° 1779–1783 de INTERURBANO/)
    expect(m729).toMatchObject({ monto: 200 })
    expect(r441.hallazgos.filter(h => h.vista === 'cuadre').map(h => h.titulo)).toEqual(
      expect.arrayContaining(['Reinicio 06:43:19: se borraron 8 boletos de la base del equipo (corr. 12886–12893, S/ 19.00)']),
    )
  })

  it('la sesión del día anterior se cierra al arrancar', () => {
    expect(r441.cuadre.sesiones.find(s => s.id === 45104).cerro).toMatchObject({ codigo: 'P' })
  })
})

describe('cruce con las sesiones de la plataforma', () => {
  const json = [
    { id: 45440, lado: false, inicio: '2026-10-16T14:10:35', fin: '2026-10-16T17:45:04', produccion: 105, conductor: { nombre: 'X', codigo: 'ID145' } },
    { id: 45528, lado: true, inicio: '2026-10-16T17:45:05', fin: '2026-10-16T22:02:50', produccion: 216 },
    { id: 45999, lado: false, inicio: '2026-10-17T05:00:00', fin: '2026-10-17T08:00:00', produccion: 50 },
  ]

  it('lee un arreglo, un objeto suelto o varios objetos pegados', () => {
    expect(leerPlataforma(JSON.stringify(json)).sesiones).toHaveLength(3)
    expect(leerPlataforma(json.map(o => JSON.stringify(o)).join('\n')).sesiones.map(p => p.id)).toEqual([45440, 45528, 45999])
    expect(leerPlataforma('{ "id": 1, ').error).toMatch(/JSON inválido/)
    expect(leerPlataforma(JSON.stringify(json[1])).sesiones[0]).toMatchObject({ id: 45528, lado: true, produccion: 21600 })
  })

  it('lee filas copiadas de la tabla (lado, inicio, fin, producción)', () => {
    const { sesiones } = leerPlataforma('B  2026-10-16 17:45:05  2026-10-16 22:02:50  216.00  CONDUCTOR')
    expect(sesiones[0]).toMatchObject({ id: null, lado: true, produccion: 21600 })
  })

  it('la plataforma confirma S/ 216 = boletos y ≠ liquidación; la que no está en el log queda suelta', () => {
    const c = cruzar(rep.cuadre, leerPlataforma(JSON.stringify(json)).sesiones)
    const b = c.sesiones.find(s => s.id === 45528)
    expect(b.plat.produccion).toBe(21600)
    expect(b.estado).toBe('no-cuadra')
    expect(b.motivos[0]).toMatchObject({ tipo: 'plataforma', nivel: 'error', monto: 500 })
    expect(b.motivos[0].detalle.join(' ')).toMatch(/Coincide con los boletos/)
    expect(c.sesiones.find(s => s.id === 45440)).toMatchObject({ estado: 'cuadra', motivos: [] })
    expect(c.soloPlataforma.map(p => p.id)).toEqual([45999])
  })

  it('sin id se empareja por lado y horario', () => {
    const c = cruzar(rep.cuadre, leerPlataforma('B  2026-10-16 17:45:05  2026-10-16 22:02:50  216.00').sesiones)
    expect(c.sesiones.find(s => s.plat)?.id).toBe(45528)
  })

  it('si la plataforma difiere de la liquidación en una sesión que el log da por cuadrada, pasa a no cuadrar', () => {
    const c = cruzar(rep.cuadre, leerPlataforma(JSON.stringify({ ...json[0], produccion: 104 })).sesiones)
    const a = c.sesiones.find(s => s.id === 45440)
    expect(a.estado).toBe('no-cuadra')
    expect(a.motivos[0].titulo).toBe('La plataforma tiene S/ 104.00 y el equipo liquidó S/ 105.00')
  })
})

describe('cuadre de casos armados', () => {
  const L = (h, tag, msg) => `2026-10-01 ${h} [${tag}] ${msg}`
  const S = 'SocketService'
  const login = (h, id) => L(h, S, `[RECIBIDO]| #1 | SID:1 | 74B | driver_login [DATA]: {sessions=[{id=${id}, direction=false, start_time=2026-10-01T${h}, driver_code=ID9}], error=false, title=Acceso permitido, message=Se ha creado una nueva sesión}`)
  const ticket = (h, corr, ses, num, price = 150) =>
    L(h, S, `[ENVIADO] | [NUEVO] (46B) [KEY]: tickets [DATA]: {tickets=[{fare=6, correlative=${corr}, session=${ses}, number=${num}, price=${price}.0, time=2026-10-01T${h}.000}]}`)
  const logout = (h, id, first, last, cash, resume) =>
    L(h, S, `[ENVIADO] | [NUEVO] (60B) [KEY]: driver_logout [DATA]: {digital=0, resume=[${resume}], last=${last}, session=${id}, end_time=2026-10-01T${h}.500, event=C, cash=${cash}, first=${first}, vehicle=1}`)

  it('sin boletos fuera de rango y con un correlativo que nunca se ve enviado: no cuadra con aviso', () => {
    const r = reconstruir(
      [
        login('06:00:00', 1),
        ticket('06:10:00', 10, 1, 100),
        ticket('06:20:00', 12, 1, 102),
        logout('07:00:00', 1, 10, 12, 450, '{digital=0, start=100, fare=6, end=102, cash=450}'),
      ].join('\n'),
    )
    const s = r.cuadre.sesiones[0]
    expect(s).toMatchObject({ estado: 'no-cuadra', dif: -150, cierre: 'C' })
    expect(s.motivos.map(m => m.tipo)).toEqual(['noVistos', 'sinRespuesta', 'sinAck'])
    expect(s.tarifas[0].faltan).toEqual([101])
  })

  it('si el log empieza con la sesión ya abierta, lo que falta es del log (parcial)', () => {
    const r = reconstruir([ticket('06:20:00', 12, 1, 102), logout('07:00:00', 1, 10, 12, 450, '{digital=0, start=100, fare=6, end=102, cash=450}')].join('\n'))
    expect(r.cuadre.sesiones[0]).toMatchObject({ estado: 'parcial', cubre: false })
    expect(r.hallazgos.some(h => h.vista === 'cuadre')).toBe(false)
  })

  it('boleto del rango de la liquidación enviado con otra sesión', () => {
    const r = reconstruir(
      [login('06:00:00', 1), ticket('06:10:00', 10, 1, 100), ticket('06:20:00', 11, 2, 101), logout('07:00:00', 1, 10, 11, 300, '{digital=0, start=100, fare=6, end=101, cash=300}')].join('\n'),
    )
    const s = r.cuadre.sesiones.find(x => x.id === 1)
    expect(s.estado).toBe('no-cuadra')
    expect(s.motivos[0]).toMatchObject({ tipo: 'otra', monto: 150 })
    expect(r.cuadre.sesiones.find(x => x.id === 2).estado).toBe('abierta')
  })
})
