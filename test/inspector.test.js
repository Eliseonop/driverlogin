import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { informeTexto } from '../src/log/inspector.js'
import { reconstruir } from '../src/log/reconstruir.js'

const leer = (f, n) => reconstruir(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'), n)

describe('padrón 149 (v1.1.4): el inspector pidió boletos y QR por el servidor', () => {
  const rep = leer('149_2026-10-28_boletos-del-inspector.log', '149.log')
  const inf = rep.inspector

  it('arma la tabla como el informe a mano', () => {
    expect(informeTexto(inf).split('\n')).toEqual([
      'Hora\tPedido\tQué salió',
      '07:08:32\tprint_qr inspector 318\tPapel QR + PIN',
      '08:07:14 – 08:07:21\tprint_qr inspector 321 (2 veces)\t2 papeles QR',
      '08:08:57 – 08:09:04\tprint_ticket inspector 321, 4 seguidos\t4 × URBAN/UNIV/ESC. (S/ 1.00), números 858–861',
      '08:11:00 – 08:11:03\tprint_ticket inspector 321, 2 seguidos\t2 × URBANO/UNIV. (S/ 2.00), números 1407–1408',
    ])
  })

  it('cada boleto: impreso, con correlativo de Room y respuesta al servidor', () => {
    expect(inf.boletos).toHaveLength(6)
    expect(inf.boletos.every(p => p.estado === 'impreso' && p.respondido && p.confirmado)).toBe(true)
    expect(inf.boletos.map(p => p.correlativo)).toEqual([8253, 8254, 8255, 8256, 8257, 8258])
    expect(inf.boletos[0]).toMatchObject({ origen: 'servidor', uid: 10399, inspector: 321, fare: 7, numero: 858, monto: 100 })
  })

  it('los otros 223 boletos tienen toque: ninguno "sin toque"', () => {
    expect(inf.sinToque).toEqual([])
  })

  it('resumen por inspector y hallazgo', () => {
    expect(inf.inspectores.map(({ inspector, qr, boletos, monto }) => ({ inspector, qr, boletos, monto }))).toEqual([
      { inspector: 318, qr: 1, boletos: 0, monto: 0 },
      { inspector: 321, qr: 2, boletos: 6, monto: 800 },
    ])
    expect(rep.hallazgos.filter(h => h.vista === 'inspector').map(h => h.titulo)).toEqual(['Inspector 318: 1 QR', 'Inspector 321: 2 QR y 6 boletos (S/ 8.00)'])
  })
})

describe('padrón 137 (versión sin INSPECTOR_BOLETO): líneas del mismo segundo al revés', () => {
  const inf = leer('137_2026-10-04_gps-mudo-login-lado-b.log', '137.log').inspector

  it('el print_ticket se empareja con la venta sin toque que le sigue', () => {
    expect(inf.boletos).toHaveLength(1)
    expect(inf.boletos[0]).toMatchObject({ inspector: 362, estado: 'impreso', nombre: 'ZONAL/UNIV/ESC', numero: 1168, monto: 100 })
  })

  it('TOQUE escrito después de su ENCOLADA sigue contando como toque', () => {
    expect(inf.sinToque).toEqual([])
  })

  it('el QR de entonces se imprimía y además se mostraba en pantalla', () => {
    expect(inf.qrs).toHaveLength(3)
    expect(inf.qrs.every(q => q.salidas.has('papel') && q.salidas.has('pantalla') && q.papel === 'impreso')).toBe(true)
  })
})
