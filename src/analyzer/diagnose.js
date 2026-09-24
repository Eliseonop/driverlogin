// Reconstruye las sesiones de un log real y detecta problemas conocidos del flujo de sesión.
// Cada hallazgo trae evidencia (índices de entrada) para saltar a las líneas del log.

import { duracion } from '../engine/time.js'
import { analizarTexto } from './parser.js'

const ladoTxt = l => (l == null ? '?' : l ? 'B' : 'A')
const CAUSA_TXT = {
  manual: 'login manual',
  nfc: 'tarjeta NFC',
  remoto: 'login-conductor (central)',
  autoretorno: 'autoretorno del equipo',
  'central-automatica': 'sesión automática de la central',
  reingreso: 'reingreso',
  previa: 'abierta antes del log',
  terminal: 'terminal / liquidar',
  'terminar-venta': 'Terminar venta (manual)',
  vencida: 'sesión de ayer al arrancar',
  desconocida: 'desconocida',
}
export const causaTxt = c => (c?.startsWith('forzado:') ? `forzado (${c.slice(8)})` : c?.startsWith('remoto') ? 'cierre remoto (central)' : CAUSA_TXT[c] ?? c ?? '—')

function atras(evs, desde, ms, pred) {
  const t0 = evs[desde].t
  for (let j = desde - 1; j >= 0 && t0 - evs[j].t <= ms; j--) if (pred(evs[j])) return evs[j]
  return null
}

function adelante(evs, desde, ms, pred) {
  const t0 = evs[desde].t
  for (let j = desde + 1; j < evs.length && evs[j].t - t0 <= ms; j++) if (pred(evs[j])) return evs[j]
  return null
}

export function reconstruir(parse) {
  const evs = parse.eventos
  const ses = new Map()
  const rechazos = []
  const activas = [{ t: parse.desde, id: null }]
  let activa = null
  let ultimoTx = null
  const setActiva = (t, id) => {
    if (activa === id) return
    activa = id
    activas.push({ t, id })
  }
  const get = (id, t) => {
    if (!ses.has(id)) ses.set(id, { id, lado: null, inicio: t, fin: null, apertura: 'previa', cierre: null, respuestas: [], activada: null, bloqueada: null, evid: [] })
    return ses.get(id)
  }

  evs.forEach((e, k) => {
    switch (e.tipo) {
      case 'tx':
        if (e.header === 'driver_login') {
          const causa = atras(evs, k, 3000, x => x.tipo === 'autoretorno') || adelante(evs, k, 1500, x => x.tipo === 'autoretorno')
            ? 'autoretorno'
            : atras(evs, k, 3000, x => x.tipo === 'loginRemoto')
              ? 'remoto'
              : atras(evs, k, 4000, x => x.tipo === 'loginNfc' || (x.tipo === 'rx' && x.header === 'uid_driver'))
                ? 'nfc'
                : atras(evs, k, 2000, x => x.tipo === 'performLogin')?.origen ?? 'manual'
          ultimoTx = { t: e.t, lado: e.data.direction === true, dni: String(e.data.dni ?? ''), key: String(e.data.key ?? ''), causa, i: e.i }
        }
        if (e.header === 'driver_logout') {
          const s = get(Number(e.data.session ?? e.data.sesion), e.t)
          s.logoutEnviado ??= e.t
          s.evid.push(e.i)
          if (!s.cierreCausa) s.cierreCausa = atras(evs, k, 3000, x => x.tipo === 'restauracion' && x.resultado === 'vencida') ? 'vencida' : 'desconocida'
        }
        return
      case 'rx':
        if (e.header === 'driver_login') {
          if (e.data.error) {
            rechazos.push({ t: e.t, i: e.i, texto: `${e.data.title} - ${e.data.message}`, pedido: ultimoTx })
            return
          }
          const d = e.data.sessions?.[0]
          if (!d) return
          const s = get(Number(d.id), e.t)
          const msg = String(e.data.message ?? '')
          const tipo = /automática/.test(msg) ? 'automatica' : /reingresado/.test(msg) ? 'reingreso' : 'nueva'
          s.lado = d.direction === true
          s.driver = d.driver_code
          s.startTime = d.start_time
          s.respuestas.push({ t: e.t, i: e.i, tipo, msg })
          s.evid.push(e.i)
          const pedido = ultimoTx && e.t - ultimoTx.t <= 10_000 ? ultimoTx : null
          if (s.respuestas.length === 1) {
            s.inicio = e.t
            s.apertura = tipo === 'automatica' ? 'central-automatica' : pedido?.causa ?? 'desconocida'
            s.pedido = pedido
          }
          if (pedido && pedido.lado !== s.lado) s.ladoDistinto = { t: e.t, i: e.i, pedido: pedido.lado, recibido: s.lado, tipo }
          s.ultimoRx = e
        }
        if (e.header === 'driver_logout' && e.data.id != null) {
          const s = get(Number(e.data.id), e.t)
          s.fin ??= e.t
          s.cierreTitulo = e.data.title
          s.evid.push(e.i)
          if (activa === s.id) setActiva(e.t, null)
        }
        return
      case 'sesionActivada': {
        const s = get(e.sesion, e.t)
        s.activada ??= e.t
        setActiva(e.t, e.sesion)
        return
      }
      case 'sesionMemoria': {
        const s = get(e.sesion, e.t)
        if (s.lado == null) s.lado = e.lado
        if (s.apertura === 'previa' && e.start) s.startTime = e.start
        if (activa == null) setActiva(e.t, e.sesion)
        return
      }
      case 'restauracion':
        if (e.resultado === 'restaurada') {
          const s = get(e.sesion, e.t)
          s.lado ??= e.lado
          setActiva(e.t, e.sesion)
        }
        if (e.resultado === 'vencida') get(e.sesion, e.t).cierreCausa = 'vencida'
        return
      case 'loginBloqueado': {
        const rx = atras(evs, k, 5000, x => x.tipo === 'rx' && x.header === 'driver_login' && !x.data.error)
        const id = e.sesion ?? (rx ? Number(rx.data.sessions?.[0]?.id) : null)
        if (id != null) {
          const s = get(id, e.t)
          s.bloqueada = e.t
          s.evid.push(e.i)
        }
        return
      }
      case 'logoutSolicitado': {
        const s = get(e.sesion, e.t)
        const cerca = (ms, pred) => atras(evs, k, ms, pred) ?? adelante(evs, k, ms, pred)
        const forz =
          cerca(3000, x => x.tipo === 'forzado' && x.sesion === e.sesion) ??
          (e.allowAutoLogin
            ? null
            : cerca(5000, x => x.tipo === 'bateriaCritica') ? { motivo: 'Bateria critica' }
            : cerca(5000, x => x.tipo === 'noche') ? { motivo: 'NIGHT' }
            : atras(evs, k, 260_000, x => x.tipo === 'energy') ? { motivo: 'ENERGY' }
            : null)
        const causa = atras(evs, k, 3000, x => x.tipo === 'terminal' && x.sesion === e.sesion)
          ? 'terminal'
          : forz
            ? `forzado:${forz.motivo}`
            : atras(evs, k, 3000, x => (x.tipo === 'remotoCierre' || x.tipo === 'logoutRemoto') && x.sesion === e.sesion)
              ? 'remoto'
              : !e.allowAutoLogin
                ? 'forzado:?'
                : 'terminar-venta'
        s.cierreCausa = causa
        s.cierreSolicitado ??= e.t
        s.evid.push(e.i)
        return
      }
      default:
    }
  })

  const sesiones = [...ses.values()].sort((a, b) => a.inicio - b.inicio)
  return { sesiones, rechazos, activas }
}

export function activaEn(activas, t) {
  let id = null
  for (const a of activas) {
    if (a.t > t) break
    id = a.id
  }
  return id
}

// ── hallazgos ────────────────────────────────────────────────────────────────

export function diagnosticar(texto) {
  const parse = analizarTexto(texto)
  const rec = reconstruir(parse)
  const { eventos: evs, entradas } = parse
  const catalogo = new Map(parse.paraderos.map(p => [p.id, p]))
  const sesPorId = new Map(rec.sesiones.map(s => [s.id, s]))
  const H = []
  const add = h => H.push({ severidad: 'media', evid: [], ...h })
  const versiones = parse.equipo.versiones

  // Versión instalada y problemas conocidos de esa versión.
  for (const v of versiones) {
    const [, , p] = v.split('.').map(Number)
    if (p >= 64 && p <= 67)
      add({ id: 'version-operation', severidad: 'info', titulo: `APK ${v}: ignora el header "operation"`, detalle: 'Desde la 1.0.64 el case "operation" está comentado: los cierres remotos que la central manda por operation no se procesan ni se confirman (la central los reenvía).' })
    if (p === 66)
      add({ id: 'version-autologin', severidad: 'info', titulo: 'APK 1.0.66: cierre en terminal depende de autoLogin en memoria', detalle: 'La sesión que llega del servidor siempre tiene autoLogin=false; solo cierra en terminal si antes se restauró desde Room (reinicio o cambio de viaje).' })
  }

  // 1) operation recibido y no procesado / reenvíos.
  const ops = evs.filter(e => e.tipo === 'rx' && e.header === 'operation')
  const porClave = new Map()
  for (const e of ops) {
    const k = `${e.data.key}=${e.data.value}`
    if (!porClave.has(k)) porClave.set(k, [])
    porClave.get(k).push(e)
  }
  for (const [k, lista] of porClave) {
    const procesadas = lista.filter(o => evs.some(x => x.tipo === 'operacionProcesada' && x.id === String(o.data.id) && x.t - o.t <= 5000 && x.t >= o.t))
    const ecos = lista.filter(o => evs.some(x => x.tipo === 'tx' && x.header === 'operation' && String(x.data.id) === String(o.data.id) && x.t - o.t <= 5000 && x.t >= o.t))
    const key = lista[0].data.key
    if (!procesadas.length && !ecos.length) {
      add({
        id: 'operation-ignorado',
        severidad: key === 'sesion' || key === 'logout-conductor' ? 'alta' : 'media',
        titulo: `Operation ${k} ignorado ${lista.length} ${lista.length === 1 ? 'vez' : 'veces'}`,
        detalle: `La central lo envió desde ${hm(lista[0].t)} hasta ${hm(lista.at(-1).t)} (${duracion(lista.at(-1).t - lista[0].t)}). El equipo no lo procesó ni devolvió el eco {id}, por eso la central siguió reenviándolo.${key === 'sesion' ? ` La sesión ${lista[0].data.value} no se cerró por esta vía.` : ''}`,
        t: lista[0].t,
        evid: lista.slice(0, 12).map(x => x.i),
      })
    } else if (lista.length > 1) {
      add({ id: 'operation-reenviado', severidad: 'baja', titulo: `Operation ${k} recibido ${lista.length} veces`, detalle: `Procesado ${procesadas.length}, eco enviado ${ecos.length}.`, t: lista[0].t, evid: lista.slice(0, 8).map(x => x.i) })
    }
    const ids = new Set(lista.map(o => String(o.data.id)))
    if (ids.size > 1 && [...ids].includes('09374710268af53289c05871'))
      add({ id: 'operation-id-fijo', severidad: 'media', titulo: `Reenvíos de ${k} con id fijo 09374710268af53289c05871`, detalle: 'La central reenvía con un id constante. Si el equipo deduplica solo por id, un cierre remoto distinto que llegue solo por reenvío se descarta como "ya atendido".', t: lista[0].t, evid: lista.slice(0, 4).map(x => x.i) })
  }
  for (const e of evs.filter(x => x.tipo === 'operacionDuplicada'))
    add({ id: 'operation-duplicada', severidad: 'media', titulo: `Operation ${e.id} descartada como ya atendida (key=${e.key})`, detalle: 'Si era un cierre remoto nuevo que llegó por reenvío con id fijo, se perdió.', t: e.t, evid: [e.i] })

  // 2) Paso por terminal/liquidar del mismo lado sin driver_logout.
  const pasos = evs.filter(e => e.tipo === 'paraderoActual')
  for (const e of pasos) {
    const p = catalogo.get(e.id)
    if (!p || !(p.terminal || p.liquidar)) continue
    const id = activaEn(rec.activas, e.t)
    const s = id != null ? sesPorId.get(id) : null
    if (!s || s.lado !== p.lado) continue
    const cerro = evs.some(x => x.t >= e.t && x.t - e.t <= 60_000 && ((x.tipo === 'tx' && x.header === 'driver_logout') || x.tipo === 'logoutSolicitado' || x.tipo === 'terminal'))
    if (cerro) continue
    const val = evs.find(x => x.tipo === 'validateV66' && Math.abs(x.t - e.t) <= 5000 && x.paradero?.id === p.id)
    add({
      id: 'terminal-sin-cierre',
      severidad: 'alta',
      titulo: `Pasó por ${p.nombre} (${p.terminal ? 'terminal' : ''}${p.terminal && p.liquidar ? '+' : ''}${p.liquidar ? 'liquidar' : ''}, lado ${ladoTxt(p.lado)}) sin cerrar la sesión ${s.id}`,
      detalle: val && !val.autoLogin ? 'El log muestra "VALIDATE AutoLogin: false": la 1.0.66 solo cierra si autoLogin=true en memoria, y la sesión que llega del servidor siempre trae false.' : 'La sesión activa es del mismo lado que el paradero y no hubo driver_logout en el minuto siguiente.',
      t: e.t,
      sesion: s.id,
      evid: [e.i, val?.i].filter(x => x != null),
    })
  }

  // 3) Sesiones descartadas por bloqueo tras logout forzado → huérfanas en la central.
  for (const s of rec.sesiones.filter(x => x.bloqueada)) {
    const auto = s.respuestas[0]?.tipo === 'automatica'
    add({
      id: 'sesion-huerfana',
      severidad: 'alta',
      titulo: `Sesión ${s.id} (lado ${ladoTxt(s.lado)}) descartada por el equipo tras un logout forzado`,
      detalle: `${auto ? 'La central la creó sola ("sesión automática") después del cierre forzado.' : 'Era la respuesta a un login posterior al cierre forzado.'} El equipo la ignoró (blockIncomingLogin) pero en la central queda ABIERTA: bloquea la unidad para otro chofer y el mismo chofer "reingresa" a ella.`,
      t: s.bloqueada,
      sesion: s.id,
      evid: s.evid.slice(0, 4),
    })
  }

  // 4) Unidad ocupada por otro conductor.
  const ocupada = rec.rechazos.filter(r => /otro conductor/.test(r.texto))
  if (ocupada.length) {
    const ids = [...new Set(ocupada.map(r => /- (\d+)/.exec(r.texto)?.[1]).filter(Boolean))]
    const huerf = ids.filter(id => sesPorId.get(Number(id))?.bloqueada)
    add({
      id: 'unidad-ocupada',
      severidad: 'alta',
      titulo: `"La unidad tiene una sesión abierta con otro conductor" ×${ocupada.length} (sesión ${ids.join(', ')})`,
      detalle: `De ${hm(ocupada[0].t)} a ${hm(ocupada.at(-1).t)}.${huerf.length ? ` La sesión ${huerf.join(', ')} es la que el equipo descartó tras un cierre forzado.` : ' La sesión abierta no se cerró en la central.'}`,
      t: ocupada[0].t,
      evid: ocupada.slice(0, 6).map(r => r.i),
    })
  }
  const otros = rec.rechazos.filter(r => !/otro conductor/.test(r.texto))
  if (otros.length)
    add({ id: 'login-rechazado', severidad: 'baja', titulo: `${otros.length} login rechazado(s)`, detalle: [...new Set(otros.map(r => r.texto))].join(' · '), t: otros[0].t, evid: otros.slice(0, 6).map(r => r.i) })

  // 5) Lado recibido distinto al pedido.
  for (const s of rec.sesiones.filter(x => x.ladoDistinto)) {
    const d = s.ladoDistinto
    add({ id: 'lado-distinto', severidad: 'media', titulo: `Pidió lado ${ladoTxt(d.pedido)} y la central devolvió ${ladoTxt(d.recibido)} (sesión ${s.id}, ${d.tipo})`, detalle: d.tipo === 'reingreso' ? 'El chofer tenía esa sesión abierta: la central siempre devuelve la sesión abierta aunque se pida el otro lado.' : 'La central decidió el lado.', t: d.t, sesion: s.id, evid: [d.i] })
  }

  // 6) Logout que no salió o se quedó sin respuesta.
  for (const e of evs.filter(x => x.tipo === 'logoutNoEnviado' || x.tipo === 'logoutSinRespuesta'))
    add({ id: 'logout-perdido', severidad: 'alta', titulo: e.tipo === 'logoutNoEnviado' ? 'driver_logout no enviado (sin conexión)' : `driver_logout sin respuesta (${e.motivo})`, detalle: 'El cierre no se reintenta solo: se vuelve a evaluar recién cuando cambie el paradero actual o por otra vía.', t: e.t, evid: [e.i] })

  // 7) Dispatcher bloqueado (mensajes recibidos que se procesan tarde).
  const despachos = new Map()
  for (const e of evs) if (e.tipo === 'despacho') (despachos.get(e.header) ?? despachos.set(e.header, []).get(e.header)).push(e)
  const punteros = new Map()
  const demoras = []
  for (const r of evs) {
    if (r.tipo !== 'rx') continue
    const lista = despachos.get(r.header) ?? []
    let p = punteros.get(r.header) ?? 0
    while (p < lista.length && lista[p].i < r.i) p++
    if (p >= lista.length) continue
    const d = lista[p].t - r.t
    if (d > 120_000) continue
    punteros.set(r.header, p + 1)
    if (d >= 10_000) demoras.push({ r, d })
  }
  if (demoras.length) {
    const max = demoras.reduce((a, b) => (b.d > a.d ? b : a))
    add({ id: 'dispatcher-bloqueado', severidad: 'media', titulo: `${demoras.length} mensaje(s) del socket procesados con ≥10 s de retraso (máx ${duracion(max.d)})`, detalle: 'El SocketMessageDispatcher procesa un mensaje a la vez. Un cierre remoto espera la respuesta de driver_logout dentro del mismo dispatcher (hasta 60 s) y todo lo demás queda en cola.', t: max.r.t, evid: demoras.slice(0, 6).map(x => x.r.i) })
  }

  // 8) Lado calculado sin fix GPS.
  for (const e of evs.filter(x => x.tipo === 'ladoLogin' && (!x.fix || (x.lat === 0 && x.lng === 0))))
    add({ id: 'lado-sin-gps', severidad: 'media', titulo: `Lado ${ladoTxt(e.lado)} calculado sin fix GPS`, detalle: `Ubicación usada: ${e.lat},${e.lng}. Antes del primer fix la app usa (0,0) y el orden 1 "más cercano" sale de ahí.`, t: e.t, evid: [e.i] })

  // 9) Autoretorno no configurado / sin credenciales.
  for (const e of evs.filter(x => x.tipo === 'autoretornoNoConfig' || x.tipo === 'autoretornoSinCreds'))
    add({ id: 'autoretorno-no', severidad: 'baja', titulo: e.tipo === 'autoretornoSinCreds' ? 'Autoretorno sin credenciales en Room' : `Autoretorno no configurado (${e.config})`, detalle: 'Tras cerrar en terminal no se abrió el otro lado desde el equipo.', t: e.t, evid: [e.i] })

  // 10) Sesiones largas sin cierre.
  for (const s of rec.sesiones) {
    const fin = s.fin ?? parse.hasta
    if (!s.fin && fin - s.inicio >= 3 * 3600_000)
      add({ id: 'sesion-larga', severidad: 'media', titulo: `Sesión ${s.id} (lado ${ladoTxt(s.lado)}) abierta ${duracion(fin - s.inicio)} sin cierre en el log`, detalle: `Abierta por ${causaTxt(s.apertura)} a las ${hm(s.inicio)}.`, t: s.inicio, sesion: s.id, evid: s.evid.slice(0, 2) })
  }

  // 11) Arranques y desconexiones (contexto).
  const arranques = evs.filter(e => e.tipo === 'arranque')
  if (arranques.length) add({ id: 'arranques', severidad: 'info', titulo: `${arranques.length} arranque(s) de la app`, detalle: arranques.map(a => hm(a.t)).join(', '), t: arranques[0].t, evid: arranques.slice(0, 8).map(a => a.i) })
  const caidas = evs.filter(e => e.tipo === 'desconectado')
  if (caidas.length > 2) add({ id: 'desconexiones', severidad: 'info', titulo: `${caidas.length} desconexiones del socket`, detalle: 'Mensajes enviados sin conexión se pierden (no hay cola).', t: caidas[0].t, evid: caidas.slice(0, 5).map(a => a.i) })

  const orden = { alta: 0, media: 1, baja: 2, info: 3 }
  H.sort((a, b) => orden[a.severidad] - orden[b.severidad] || (a.t ?? 0) - (b.t ?? 0))
  return { parse, ...rec, hallazgos: H, entradas }
}

const hm = t => {
  const d = new Date(t)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
}
