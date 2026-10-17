// Apagados del equipo: entre la última línea antes de un arranque de la app y ese arranque el equipo no escribió
// nada. Lo que hay justo antes dice por qué: la app lo apagó por batería crítica, el sistema avisó un apagado
// ordenado (botón de encendido) o no hubo aviso (se quedó sin energía, se colgó o la app murió).
import { duracion, horaLog } from './leer.js'

const MISMO_ARRANQUE = 60_000 // MyApp, LogManager y SocketService escriben su arranque en el mismo minuto
const REINICIO_RAPIDO = 45_000 // un equipo no se apaga y vuelve a encender en menos de esto: fue solo la app
const ANTES = 3 * 60_000 // ventana antes de la última línea donde buscar el motivo

/** Hora local "HH:MM" (los logs no traen zona). */
const hm = t => horaLog(t).slice(0, 5)

function arranquesDe(eventos) {
  const out = []
  let ult = -Infinity
  for (const e of eventos)
    if (e.tipo === 'arranque') {
      if (e.t - ult > MISMO_ARRANQUE) out.push(e)
      ult = e.t
    }
  return out
}

const TITULO = {
  bateria: b => `Equipo apagado por batería crítica (${b}%): lo apagó la app, no fue manual`,
  ordenado: () => 'Equipo apagado (apagado ordenado: botón de encendido o el sistema)',
  abrupto: (_, fuera) => (fuera < 2 * 60_000 ? 'Equipo reiniciado de golpe, sin aviso de apagado' : 'Equipo apagado de golpe, sin aviso de apagado'),
  reinicio: () => 'La app se reinició (el equipo no se apagó)',
}

export function apagadosDe(entradas, eventos) {
  const estados = eventos.filter(e => e.tipo === 'estado')
  const out = []
  for (const a of arranquesDe(eventos)) {
    const previa = entradas[a.i - 1]
    if (!previa) continue // el log empieza con este arranque: no se sabe qué pasó antes
    const cerca = eventos.filter(e => e.t >= previa.t - ANTES && e.i < a.i)
    const power = cerca.filter(e => e.tipo === 'power' && !e.encendido).at(-1)
    const porBateria = cerca.filter(e => e.tipo === 'apagaBateria').at(-1)
    const t = porBateria?.t ?? power?.t ?? previa.t
    const i = porBateria?.i ?? power?.i ?? previa.i
    const fuera = a.t - previa.t
    const tipo = porBateria ? 'bateria' : power ? 'ordenado' : fuera < REINICIO_RAPIDO ? 'reinicio' : 'abrupto'
    const antes = estados.filter(e => e.i < a.i).at(-1) ?? null
    const despues = estados.find(e => e.i > a.i && e.t - a.t <= 10 * 60_000) ?? null
    // Desde cuándo iba sin cargar: el último device_status con charging=true antes del apagado.
    const previos = estados.filter(e => e.i < a.i)
    const ultimaCarga = previos.filter(e => e.data.charging === true).at(-1) ?? null
    const sinCargaDesde = antes?.data.charging === false ? previos.find(e => (!ultimaCarga || e.i > ultimaCarga.i) && e.data.charging === false) ?? null : null
    const aviso = eventos.filter(e => e.tipo === 'avisoEnergia' && e.t <= t && t - e.t <= 60 * 60_000).at(-1) ?? null
    const bateria = porBateria?.bateria ?? antes?.data.battery ?? null
    const lat = antes?.data.lat ?? null
    const lng = antes?.data.lng ?? null

    const d = []
    if (tipo === 'bateria') d.push(`${horaLog(porBateria.t)} la app registra "Bateria critica (${porBateria.bateria}%). Iniciando apagado." y apaga el equipo (protector de batería, sin cargador).`)
    if (power) d.push(`${horaLog(power.t)} el sistema avisa el apagado (power event F): fue un apagado ordenado.`)
    if (tipo === 'ordenado') d.push(`Ninguna regla de la app pidió apagar: lo más probable es que lo apagaran con el botón de encendido${bateria != null && bateria <= 5 ? ' o que Android lo apagara por batería agotada' : ''}.`)
    if (tipo === 'abrupto') d.push(`No hay aviso de apagado: el equipo se quedó sin energía, se colgó o lo reiniciaron forzado. Última línea a las ${horaLog(previa.t)}.`)
    if (tipo === 'reinicio') d.push(`Solo ${duracion(fuera)} sin líneas y sin aviso de apagado: se cerró el proceso de la app (crash o el sistema lo mató).`)
    if (antes) d.push(`Último device_status (${horaLog(antes.t)}): batería ${antes.data.battery}%${antes.data.charging ? ', cargando' : ', sin cargar'}${antes.data.temperature != null ? `, ${antes.data.temperature} °C` : ''}.`)
    if (sinCargaDesde)
      d.push(`Iba sin cargar desde ${ultimaCarga ? 'las' : 'al menos las'} ${hm(sinCargaDesde.t)} (batería ${sinCargaDesde.data.battery}% → ${bateria}%): el bus no le estaba dando corriente${ultimaCarga ? '' : ' (en todo el log anterior no aparece cargando)'}.`)
    if (aviso) d.push(`${horaLog(aviso.t)} aviso previo: ${aviso.texto}`)
    d.push(`Vuelve a arrancar a las ${horaLog(a.t)} (${duracion(fuera)} apagado)${despues ? ` con batería ${despues.data.battery}%${despues.data.charging ? ' y el cargador conectado' : ', sin cargador'}` : ''}.`)

    out.push({
      t,
      i,
      tipo,
      manual: tipo === 'bateria' || tipo === 'reinicio' ? false : null,
      titulo: TITULO[tipo](bateria, fuera),
      detalle: d,
      ultima: previa.t,
      vuelve: a.t,
      iVuelve: a.i,
      fuera,
      bateria,
      cargaba: antes?.data.charging ?? null,
      bateriaVuelve: despues?.data.battery ?? null,
      cargaVuelve: despues?.data.charging ?? null,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
    })
  }
  return out
}
