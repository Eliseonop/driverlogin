import { describe, expect, it } from 'vitest'
import { CHOFERES, DIA, Simulador } from '../src/simulador.js'

const [C1, C2] = CHOFERES

const correr = (sim, ms) => {
  for (let t = 0; t < ms; t += 16) sim.tick(16)
}
const hasta = (sim, cond, max = 240_000) => {
  for (let t = 0; t < max; t += 16) {
    sim.tick(16)
    if (cond()) return true
  }
  return false
}
const logs = sim => sim.logs.map(l => l.msg).join('\n')

function nuevo(ruta, autoB = false) {
  const sim = new Simulador(ruta)
  sim.d.central.autoB = autoB
  sim.mult = 120
  return sim
}

function login(sim, chofer = C1) {
  sim.loginTeclado(chofer.dni, chofer.clave)
  correr(sim, 1500)
}

function loginYAndar(sim) {
  login(sim)
  sim.setJugando(true)
}

describe('login y lado', () => {
  it('login al inicio del lado A abre una sesión A', () => {
    const sim = nuevo()
    login(sim)
    expect(sim.d.eq.sesion).toMatchObject({ id: 101, direction: false })
    expect(sim.d.eq.paraderoActual.nombre).toBe('Inicio A')
  })

  it('clave mala: la central rechaza y no hay sesión', () => {
    const sim = nuevo()
    sim.loginTeclado(C1.dni, '0000')
    correr(sim, 1500)
    expect(sim.d.eq.sesion).toBeNull()
    expect(logs(sim)).toMatch('Login rechazado: error - DNI y CLAVE inválidos')
  })

  it('DNI corto: la pantalla no deja enviar', () => {
    const sim = nuevo()
    sim.loginTeclado('123', '1')
    expect(logs(sim)).toMatch('DNI incompleto')
    expect(sim.d.enVuelo).toHaveLength(0)
  })

  it('login pasada la mitad del lado B entra por el lado A (orden 1 más cercano)', () => {
    const sim = nuevo()
    sim.moverA(true, sim.largo * 0.7)
    login(sim)
    expect(sim.d.eq.sesion.direction).toBe(false)
  })

  it('otro chofer con la unidad ocupada: rechazado', () => {
    const sim = nuevo()
    login(sim)
    sim.terminarVenta()
    correr(sim, 1500)
    sim.d.central.sesiones[0].abierta = true // quedó abierta en la central
    login(sim, C2)
    expect(logs(sim)).toMatch('La unidad tiene una sesión abierta con otro conductor  - 101')
  })

  it('GPS sin fix: el orden 1 se calcula desde (0,0) y el lado puede salir mal', () => {
    const sim = nuevo()
    sim.moverA(true, 10) // en el inicio del lado B
    sim.setGps('sinfix')
    login(sim)
    expect(logs(sim)).toMatch('fix=false')
    expect(sim.d.eq.sesion.direction).toBe(false) // el bus está en B pero entra por A
    sim.moverA(true, sim.largo * 0.5)
    expect(sim.d.eq.paraderoActual.nombre).toBe('Inicio A') // el paradero actual no avanza
  })

  it('sin datos de ruta: el orden 1 queda con el último valor y no hay paradero inicial', () => {
    const sim = nuevo()
    sim.setDatosRuta(false)
    sim.moverA(true, 10) // en el inicio del lado B, pero el orden 1 guardado sigue siendo Inicio A
    login(sim)
    expect(sim.d.eq.sesion.direction).toBe(false)
    expect(logs(sim)).toMatch('Paradero inicial: null')
  })
})

describe('cierre en terminal y autoretorno', () => {
  it('terminal A con retorno_auto_b=true: cierra A y abre B', () => {
    const sim = nuevo()
    loginYAndar(sim)
    expect(hasta(sim, () => sim.d.bus.lado === true)).toBe(true)
    expect(sim.d.eq.sesion).toMatchObject({ id: 102, direction: true })
    expect(logs(sim)).toMatch('Terminal alcanzado lado=A')
    expect(logs(sim)).toMatch('Autoretorno → abriendo lado B (retorno_auto_b)')
  })

  it('vuelta completa A → B → A: también valida retorno_auto_a', () => {
    const sim = nuevo()
    loginYAndar(sim)
    expect(hasta(sim, () => sim.d.bus.vueltas === 2)).toBe(true)
    expect(sim.d.eq.sesion).toMatchObject({ id: 103, direction: false })
    expect(logs(sim)).toMatch('Autoretorno → abriendo lado A (retorno_auto_a)')
    expect(sim.d.bd.room.filter(r => r.finalizado).map(r => r.id)).toEqual([101, 102])
  })

  it('retorno_auto_a como texto "true" no cuenta: tras el terminal B queda sin sesión', () => {
    const sim = nuevo({ retornoA: 'texto' })
    loginYAndar(sim)
    hasta(sim, () => sim.d.bus.vueltas === 2)
    expect(sim.d.eq.sesion).toBeNull()
    expect(logs(sim)).toMatch('Autoretorno no configurado (retorno_auto_a)')
  })

  it('la central crea la B sola aunque retorno_auto_b esté apagado', () => {
    const sim = nuevo({ retornoB: 'false' }, true)
    loginYAndar(sim)
    hasta(sim, () => sim.d.bus.lado === true)
    expect(sim.d.eq.sesion).toMatchObject({ direction: true })
    expect(logs(sim)).toMatch('Se ha creado una nueva sesión automática')
  })

  it('un paradero con liquidar a mitad de ruta también cierra', () => {
    const sim = nuevo()
    sim.setParadero(5, { liquidar: true })
    loginYAndar(sim)
    hasta(sim, () => sim.d.eq.sesion?.direction === true)
    expect(logs(sim)).toMatch('Liquidar alcanzado lado=A (Paradero A5)')
    expect(sim.d.bus.lado).toBe(false) // el bus sigue en el lado A con sesión B
  })

  it('paradero terminal inactivo: se filtra y no cierra', () => {
    const sim = nuevo()
    sim.setParadero(10, { activo: false })
    loginYAndar(sim)
    hasta(sim, () => sim.d.bus.lado === true)
    expect(sim.d.eq.sesion).toMatchObject({ id: 101, direction: false })
  })

  it('Terminar venta no reabre nada', () => {
    const sim = nuevo()
    login(sim)
    sim.terminarVenta()
    correr(sim, 3000)
    expect(sim.d.eq.sesion).toBeNull()
    expect(sim.abiertaEnCentral()).toBeNull()
  })
})

describe('cierres forzados (ProtectorViewModel)', () => {
  it('batería crítica: cierra, descarta la B de la central y apaga el equipo', () => {
    const sim = nuevo({}, true)
    login(sim)
    sim.setBateria(8, false)
    correr(sim, 8000)
    expect(sim.d.disp.encendido).toBe(false)
    expect(sim.abiertaEnCentral()).toMatchObject({ direction: true, auto: true })
    expect(logs(sim)).toMatch('bloqueado por logout forzado (descartada sesión 102 lado=B')
  })

  it('ENERGY: tras el cierre forzado el próximo login del chofer se descarta', () => {
    const sim = nuevo()
    sim.moverA(true, 10)
    login(sim) // sesión B: al cerrarla la central no crea nada
    sim.setBateria(15, false)
    sim.saltarA(sim.d.hora + 201_000)
    correr(sim, 1500)
    expect(logs(sim)).toMatch('ENERGY: cerrando sesión 101')
    expect(sim.d.eq.sesion).toBeNull()
    sim.setBateria(80, true)
    login(sim)
    expect(sim.d.eq.sesion).toBeNull()
    expect(logs(sim)).toMatch('bloqueado por logout forzado (descartada sesión 102')
    login(sim) // segundo intento: la central devuelve la misma y ahora sí entra
    expect(sim.d.eq.sesion).toMatchObject({ id: 102 })
  })

  it('NIGHT: a las 02:30 cierra la sesión', () => {
    const sim = nuevo()
    login(sim)
    sim.irAHora('02:31')
    correr(sim, 1500)
    expect(logs(sim)).toMatch('NIGHT: dentro del rango 02:30-03:00 → cerrando sesión')
    expect(sim.d.eq.sesion).toBeNull()
  })
})

describe('red, apagado y restauración', () => {
  it('sin conexión en el terminal: el logout se pierde y la sesión A sigue en el lado B', () => {
    const sim = nuevo()
    loginYAndar(sim)
    hasta(sim, () => sim.d.bus.s > sim.largo * 0.9)
    sim.setConectado(false)
    hasta(sim, () => sim.d.bus.lado === true)
    expect(logs(sim)).toMatch('driver_logout no enviado: socket desconectado')
    expect(sim.d.eq.sesion).toMatchObject({ id: 101, direction: false })
  })

  it('operation sin eco: la central la reenvía con el id fijo y se atiende al reconectar', () => {
    const sim = nuevo()
    login(sim)
    sim.setConectado(false)
    sim.cerrarDesdeCentral()
    correr(sim, 1500)
    sim.setConectado(true)
    correr(sim, 1500)
    sim.saltarA(sim.d.hora + 5 * 60_000)
    correr(sim, 3000)
    expect(logs(sim)).toMatch('reenvía operation sesion=101 (id 09374710268af53289c05871)')
    expect(logs(sim)).toMatch('Sesión encontrada para logout remoto: 101')
    expect(sim.d.eq.sesion).toBeNull()
  })

  it('al día siguiente: cierra la sesión vencida, la central crea la B y el equipo la toma sin credenciales', () => {
    const sim = nuevo({}, true)
    login(sim)
    sim.setEncendido(false)
    sim.saltarA(DIA + 5 * 3_600_000)
    sim.setEncendido(true)
    correr(sim, 10_000)
    expect(logs(sim)).toMatch('Restauración: sesión 101 de un día anterior')
    expect(sim.d.eq.sesion).toMatchObject({ id: 102, direction: true })
    expect(sim.d.bd.room.find(r => r.id === 102).dni).toBeNull()
    sim.moverA(true, 0)
    sim.moverA(true, sim.largo)
    correr(sim, 1500)
    expect(logs(sim)).toMatch('Autoretorno: sin credenciales guardadas')
  })

  it('reinicio el mismo día: restaura la sesión desde Room', () => {
    const sim = nuevo()
    login(sim)
    sim.setEncendido(false)
    sim.setEncendido(true)
    correr(sim, 6000)
    expect(logs(sim)).toMatch('Restauración: sesión 101 lado=A restaurada desde BD (creds=sí)')
    expect(sim.d.eq.sesion).toMatchObject({ id: 101 })
  })
})

describe('retroceder en el tiempo', () => {
  it('volver a una foto y seguir desde ahí descarta lo que venía después', () => {
    const sim = nuevo()
    login(sim)
    const i = sim.hist.length - 1
    const nLogs = sim.logs.length
    sim.setJugando(true)
    hasta(sim, () => sim.d.bus.lado === true)
    expect(sim.d.eq.sesion.id).toBe(102)
    sim.irA(i)
    expect(sim.enPasado).toBe(true)
    expect(sim.d.eq.sesion.id).toBe(101)
    expect(sim.d.bus.lado).toBe(false)
    sim.terminarVenta()
    expect(sim.enPasado).toBe(false)
    expect(sim.logs.length).toBeGreaterThanOrEqual(nLogs)
    expect(sim.hist.length).toBe(i + 2)
  })
})
