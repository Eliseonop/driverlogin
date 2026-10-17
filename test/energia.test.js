import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { horaLog } from '../src/log/leer.js'
import { reconstruir } from '../src/log/reconstruir.js'
import { porQueSeCorta, recorrido } from '../src/log/recorrido.js'

const leer = (archivo, nombre) => reconstruir(fs.readFileSync(new URL(`./fixtures/${archivo}`, import.meta.url), 'utf8'), nombre)

describe('padrón 8 (v1.0.65): el equipo se apaga por batería crítica', () => {
  const rep = leer('8_2026-10-17_apagado-bateria-critica.log', '8.log')
  const [a] = rep.apagados

  it('detecta un solo apagado: lo hizo la app por batería, no fue manual', () => {
    expect(rep.apagados.length).toBe(1)
    expect(a.tipo).toBe('bateria')
    expect(a.manual).toBe(false)
    expect(a.titulo).toBe('Equipo apagado por batería crítica (10%): lo apagó la app, no fue manual')
    expect(horaLog(a.t)).toBe('07:19:45')
    expect(horaLog(a.vuelve)).toBe('07:38:00')
    expect(a.cargaba).toBe(false)
    expect(a.cargaVuelve).toBe(true)
  })

  it('el detalle cuenta el aviso previo de ENERGY y que vuelve con el cargador', () => {
    const d = a.detalle.join(' ')
    expect(d).toMatch(/06:47:24 aviso previo: ENERGY: batería baja sin carga/)
    expect(d).toMatch(/power event F/)
    expect(d).toMatch(/Vuelve a arrancar a las 07:38:00 .* con batería 15% y el cargador conectado/)
  })

  it('aparece en hallazgos y en la barra de tiempo', () => {
    expect(rep.hallazgos[0]).toMatchObject({ nivel: 'error', titulo: expect.stringMatching(/^Equipo apagado por batería crítica/) })
    expect(rep.hitos.some(h => h.tipo === 'apagado' && h.t === a.t)).toBe(true)
  })

  it('el corte de conexión de las 07:19:47 se explica por el apagado y se ubica en el mapa', () => {
    const r = recorrido(rep)
    const c = r.cortes.find(x => x.apagado)
    expect(horaLog(c.t)).toBe('07:19:47')
    expect(porQueSeCorta(c)).toBe(a.titulo)
    expect(r.apagados[0].p).toMatchObject({ lat: -12.0835817, lng: -77.034993 })
  })
})

describe('reinicios sin aviso de apagado', () => {
  const rep = leer('420_2026-10-07_marcas-central-desfasadas.log', '420.log')

  it('distingue un reinicio de la app (segundos) de un apagado de golpe', () => {
    expect(rep.apagados.map(a => [horaLog(a.t), a.tipo])).toEqual([
      ['04:46:21', 'reinicio'],
      ['04:59:00', 'abrupto'],
      ['05:08:40', 'abrupto'],
      ['05:22:59', 'abrupto'],
    ])
  })

  it('el socket se corta cuando el equipo deja de escribir, no cuando vuelve a arrancar', () => {
    const s = rep.conexion.segmentos.find(x => x.causa === 'reinicio de la app' && horaLog(x.hasta) === '05:08:40')
    expect(s).toBeTruthy()
  })
})
