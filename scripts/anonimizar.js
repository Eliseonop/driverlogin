#!/usr/bin/env node
// Anonimiza un log de LogManager (DNI, clave, contraseñas) y opcionalmente lo recorta a lo que usa el diagnóstico.
//   node scripts/anonimizar.js entrada.txt salida.log [--recortar]

import fs from 'node:fs'

const [entrada, salida, ...flags] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('uso: node scripts/anonimizar.js entrada.txt salida.log [--recortar]')
  process.exit(1)
}
const recortar = flags.includes('--recortar')
const RUIDO = /\[(PrintQueue|PrinterService|PrintExecutor|TicketCounterManager|SoundRepository|ADS|GeoMarkViewModel|TrafficMonitor|UsbPrinterManager|WsPagosManager|NetworkConnectivityRepository|DeviceEventRepository[^\]]*)\]|🎟️ Ticket|Obteniendo tickets|No hay tickets|Total a enviar|device_status \[DATA\]|Header: device_status/

const dnis = new Map()
const fake = dni => {
  if (!dnis.has(dni)) dnis.set(dni, String(40000001 + dnis.size))
  return dnis.get(dni)
}
const claveDe = dni => fake(dni).slice(-4)

let estados = 0
const out = []
for (const linea of fs.readFileSync(entrada, 'utf8').split(/\r?\n/)) {
  if (recortar && RUIDO.test(linea)) continue
  if (recortar && linea.includes('[DeviceStatus]') && ++estados > 2) continue
  let l = linea.replace(/dni=(\d{6,9}), key=([^,}]+)/g, (_, d) => `dni=${fake(d)}, key=${claveDe(d)}`)
  l = l.replace(/dni=(\d{6,9})/g, (_, d) => `dni=${fake(d)}`)
  l = l.replace(/dni='(\d{6,9})'/g, (_, d) => `dni='${fake(d)}'`)
  l = l.replace(/password=([^,)]+)/g, (_, p) => (p === 'null' ? 'password=null' : 'password=****'))
  l = l.replace(/value=(\d{8}) (\S+?)([,}])/g, (_, d, _k, fin) => `value=${fake(d)} ${claveDe(d)}${fin}`)
  out.push(l)
}
fs.writeFileSync(salida, out.join('\n'))
console.log(`${out.length} líneas → ${salida} (${dnis.size} DNI anonimizados)`)
