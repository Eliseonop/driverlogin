// Catálogo de escenarios: cada uno es un guion de acciones + verificaciones sobre el mundo final.
// `riesgo` marca escenarios que documentan un comportamiento ACTUAL pero indeseado: la verificación
// pasa cuando el problema se reproduce (si algún día se corrige, el escenario fallará y habrá que actualizarlo).

import { World } from './world.js'
import { MIN } from './time.js'

const lado = w => (w.sesion ? (w.sesion.direction ? 'B' : 'A') : null)
const abiertas = w => w.abiertasServidor()
const hay = (w, re) => w.logs.some(l => re.test(`[${l.tag}] ${l.msg}`))
const cuenta = (w, re) => w.logs.filter(l => re.test(`[${l.tag}] ${l.msg}`)).length
const ev = (w, re) => w.eventos.some(e => re.test(e.texto))
const c = (ok, texto) => ({ ok: !!ok, texto })
const primerLog = (w, re) => w.logs.find(l => re.test(`[${l.tag}] ${l.msg}`))

export const GRUPOS = [
  'Login y lado',
  'Terminal y autoretorno',
  'Cierre remoto',
  'Cierres forzados (Protector)',
  'Reinicio y restauración',
  'Red y GPS',
  'Central',
  'APK 1.0.66 (campo)',
]

export const ESCENARIOS = [
  // ── Login y lado ────────────────────────────────────────────────────────────
  {
    id: 'lado-inicio-a',
    grupo: 'Login y lado',
    titulo: 'Login en PRDO INICIAL abre lado A',
    descripcion: 'El orden 1 más cercano (de ambos lados) es PRDO INICIAL (lado A).',
    pasos: [['irA', { paradero: 'PRDO INICIAL' }], ['login'], ['esperar', { s: 3 }]],
    checks: w => [
      c(hay(w, /driver_login \[DATA\]: \{.*direction=false/), 'driver_login sale con direction=false'),
      c(lado(w) === 'A', 'sesión activa en lado A'),
      c(w.device.m.paraderoActual?.nombre === 'PRDO INICIAL', 'paradero inicial PRDO INICIAL'),
      c(w.device.room[0]?.dni === '40000001', 'Room guarda el DNI de la sesión'),
    ],
  },
  {
    id: 'lado-butter-b',
    grupo: 'Login y lado',
    titulo: 'Login en Butter (fin de A) abre lado B',
    descripcion: 'En Butter el orden 1 más cercano es PDRO SURCO (B), aunque Butter sea del lado A.',
    pasos: [['irA', { paradero: 'Butter' }], ['login'], ['esperar', { s: 3 }]],
    checks: w => [c(lado(w) === 'B', 'sesión activa en lado B'), c(w.device.m.paraderoActual?.nombre === 'PDRO SURCO', 'paradero inicial PDRO SURCO')],
  },
  {
    id: 'lado-config-no-influye',
    grupo: 'Login y lado',
    titulo: 'La config de retorno no cambia el lado del login',
    descripcion: 'Con retorno_auto_a y retorno_auto_b en false el login en PDRO SURCO sigue abriendo B.',
    config: { retorno: { a: false, b: false } },
    pasos: [['irA', { paradero: 'PDRO SURCO' }], ['login'], ['esperar', { s: 3 }]],
    checks: w => [c(lado(w) === 'B', 'sesión en B')],
  },
  {
    id: 'lado-sin-fix',
    grupo: 'Login y lado',
    riesgo: 'Tras reiniciar y sin fix GPS, LocationState vale (0,0) y el lado se calcula desde ahí. En esta ruta cae en A aunque el bus esté en PDRO SURCO (inicio de B).',
    titulo: 'Reinicio sin fix GPS: el lado se calcula desde (0,0)',
    descripcion: 'El bus está en PDRO SURCO, se reinicia la app y el GPS no tiene fix cuando el chofer se loguea.',
    pasos: [['irA', { paradero: 'PDRO SURCO' }], ['gpsFix', { on: false }], ['reiniciar'], ['esperar', { s: 10 }], ['login'], ['esperar', { s: 3 }]],
    checks: w => [
      c(hay(w, /Lado login=A .*gps=0.0,0.0 .*fix=false/), 'log "Lado login=A ... gps=0.0,0.0 fix=false"'),
      c(lado(w) === 'A', 'abre A estando en el inicio de B'),
    ],
  },
  {
    id: 'login-errores',
    grupo: 'Login y lado',
    titulo: 'Errores de login: formulario y clave',
    descripcion: 'DNI de 7 dígitos → "Formulario Inválido"; clave errada → "DNI y CLAVE inválidos". No se abre sesión.',
    pasos: [['login', { dni: '4000001', clave: '0001' }], ['esperar', { s: 3 }], ['login', { dni: '40000001', clave: '9999' }], ['esperar', { s: 3 }]],
    checks: w => [
      c(hay(w, /Login rechazado: Formulario Inválido/), 'rechazo por formulario'),
      c(hay(w, /Login rechazado: error - DNI y CLAVE inválidos/), 'rechazo por clave'),
      c(w.sesion == null && w.device.room.length === 0, 'sin sesión ni registro en Room'),
    ],
  },
  {
    id: 'login-otro-conductor',
    grupo: 'Login y lado',
    titulo: 'Otro chofer con la unidad ocupada',
    descripcion: 'Chofer 1 tiene la sesión abierta; chofer 2 intenta entrar.',
    pasos: [['login'], ['esperar', { s: 3 }], ['login', { dni: '40000002', clave: '0002' }], ['esperar', { s: 3 }]],
    checks: w => [
      c(hay(w, /La unidad tiene una sesión abierta con otro conductor {2}- 35417/), 'central responde "sesión abierta con otro conductor - 35417"'),
      c(w.sesion?.id === 35417, 'la sesión del chofer 1 sigue activa'),
    ],
  },

  // ── Terminal y autoretorno ──────────────────────────────────────────────────
  {
    id: 'ciclo-a-b',
    grupo: 'Terminal y autoretorno',
    titulo: 'Termina A en Butter → abre B',
    descripcion: 'Recorre el lado A completo; en Butter (terminal+liquidar, radio 155 m) cierra y abre B.',
    pasos: [['login'], ['recorrer', { lado: 'A', hasta: 'Butter' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /Terminal alcanzado lado=false \(Butter\)/), 'detecta terminal Butter'),
      c(hay(w, /Autoretorno → abriendo lado B \(retorno_auto_b\)/), 'autoretorno a B'),
      c(lado(w) === 'B', 'sesión activa en B'),
      c(abiertas(w).length === 1 && abiertas(w)[0].direction === true, 'en la central solo queda abierta la B'),
      c(w.device.room.find(e => e.direction === true)?.dni === '40000001', 'la sesión B hereda el DNI en Room'),
    ],
  },
  {
    id: 'ciclo-a-b-a',
    grupo: 'Terminal y autoretorno',
    titulo: 'Vuelta completa A → B → A',
    descripcion: 'Con retorno_auto_b y retorno_auto_a activos el ciclo no se corta.',
    pasos: [['login'], ['recorrer', { lado: 'A', hasta: 'Butter' }], ['esperar', { s: 5 }], ['recorrer', { lado: 'B' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /Terminal alcanzado lado=true \(PORTÓN\)/), 'cierra B en PORTÓN (primer terminal/liquidar de B)'),
      c(hay(w, /Autoretorno → abriendo lado A \(retorno_auto_a\)/), 'autoretorno a A'),
      c(lado(w) === 'A', 'termina en A'),
      c(w.server.sesiones.length === 3, '3 sesiones en la central (A, B, A)'),
      c(abiertas(w).length === 1, 'una sola abierta'),
    ],
  },
  {
    id: 'b-sin-retorno-a',
    grupo: 'Terminal y autoretorno',
    titulo: 'Termina B sin retorno_auto_a: cierra y no abre',
    config: { retorno: { a: false } },
    pasos: [['irA', { paradero: 'PDRO SURCO' }], ['login'], ['recorrer', { lado: 'B' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /Autoretorno no configurado \(retorno_auto_a\)/), 'log "Autoretorno no configurado (retorno_auto_a)"'),
      c(w.sesion == null, 'sin sesión en el equipo'),
      c(abiertas(w).length === 0, 'sin sesión en la central'),
    ],
  },
  {
    id: 'retorno-como-texto',
    grupo: 'Terminal y autoretorno',
    titulo: 'retorno_auto_b llega como texto "true"',
    riesgo: 'El equipo exige booleano (`as? Boolean`) y no abre B; si la central lo interpreta como verdadero crea la sesión automática y el equipo la toma igual. Cada lado decide distinto.',
    descripcion: 'La config viene como "true" (string). La central en este guion sí la toma como verdadera.',
    config: { retorno: { b: 'texto' }, servidor: { configComoTexto: true } },
    pasos: [['login'], ['recorrer', { lado: 'A', hasta: 'Butter' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /Autoretorno no configurado \(retorno_auto_b\)/), 'el equipo no abre B por config'),
      c(hay(w, /Se ha creado una nueva sesión automática/), 'la central crea B sola'),
      c(lado(w) === 'B', 'el equipo termina en B igual (por el push de la central)'),
    ],
  },
  {
    id: 'terminal-fuera-de-radio',
    grupo: 'Terminal y autoretorno',
    titulo: 'Pasa por Butter fuera del radio: cierra en SURCO FINAL A',
    descripcion: 'A 60 m fuera del radio de Butter no hay paradero actual nuevo; SURCO FINAL A (liquidar) es la segunda oportunidad.',
    pasos: [['login'], ['irA', { paradero: 'R. PANAMA' }], ['irA', { paradero: 'Butter', fuera: 60 }], ['esperar', { s: 5 }], ['irA', { paradero: 'SURCO FINAL A' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(!hay(w, /Terminal alcanzado .*\(Butter\)/), 'no cierra en Butter'),
      c(hay(w, /Terminal alcanzado lado=false \(SURCO FINAL A\)/), 'cierra en SURCO FINAL A'),
      c(lado(w) === 'B', 'abre B'),
    ],
  },
  {
    id: 'terminal-otro-lado',
    grupo: 'Terminal y autoretorno',
    titulo: 'Sesión B dentro de un terminal del lado A no cierra',
    pasos: [['irA', { paradero: 'Butter' }], ['login'], ['esperar', { s: 10 }]],
    checks: w => [c(lado(w) === 'B', 'sigue en B'), c(!hay(w, /Terminal alcanzado/), 'no hay cierre')],
  },
  {
    id: 'terminar-venta-en-ruta',
    grupo: 'Terminal y autoretorno',
    titulo: 'Terminar venta a mitad de ruta (central sin sesión automática): solo cierra',
    config: { servidor: { autoSesion: 'nunca' } },
    pasos: [['login'], ['irA', { paradero: 'AV. CENTRAL@A' }], ['terminarVenta'], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /logout solicitado: 35417 allowAutoLogin=true autoRetorno=false/), 'logout sin autoretorno'),
      c(w.sesion == null && abiertas(w).length === 0, 'queda sin sesión en equipo y central'),
    ],
  },
  {
    id: 'terminar-venta-a-central-abre-b',
    grupo: 'Terminal y autoretorno',
    titulo: 'Terminar venta en A: la central abre B y el equipo la toma',
    riesgo: 'El equipo no pide autoretorno en un cierre manual, pero la central crea la B automática al cerrar cualquier A y el equipo la acepta: el chofer que terminó su venta queda logueado en B.',
    pasos: [['login'], ['irA', { paradero: 'AV. CENTRAL@A' }], ['terminarVenta'], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /autoRetorno=false/), 'el equipo no pide autoretorno'),
      c(hay(w, /Sesión activada: 35418 lado=B .Se ha creado una nueva sesión automática/), 'acepta la B automática de la central'),
      c(lado(w) === 'B', 'queda logueado en B tras "Terminar venta"'),
    ],
  },

  // ── Cierre remoto ───────────────────────────────────────────────────────────
  {
    id: 'remoto-operation',
    config: { servidor: { autoSesion: 'nunca' } },
    grupo: 'Cierre remoto',
    titulo: 'Central cierra por `operation` (key=sesion)',
    riesgo: 'processOperation corre DENTRO del dispatcher y espera la respuesta de driver_logout (hasta 60 s), pero esa respuesta la procesa el mismo dispatcher: se bloquea 60 s y todos los mensajes del socket quedan en cola.',
    pasos: [['login'], ['esperar', { s: 5 }], ['cerrarRemoto', { via: 'operation' }], ['esperar', { s: 90 }]],
    checks: w => {
      const pedido = primerLog(w, /logout solicitado: 35417/)
      const confirmado = primerLog(w, /Decoded Driver Logout: .*id=35417/)
      const demora = confirmado && pedido ? (confirmado.t - pedido.t) / 1000 : null
      return [
        c(hay(w, /\[ENVIADO\] .*operation \[DATA\]: \{id=/), 'eco del id al servidor'),
        c(hay(w, /ACK 35417:RECV/) && hay(w, /ACK 35417:OK/), 'ACK RECV y OK por android_command'),
        c(w.sesion == null && !hay(w, /Autoretorno/), 'cierra sin autoretorno'),
        c(demora != null && demora >= 59, `la respuesta de driver_logout se procesa ${demora ?? '?'} s después (dispatcher bloqueado)`),
      ]
    },
  },
  {
    id: 'remoto-android-command',
    config: { servidor: { autoSesion: 'nunca' } },
    grupo: 'Cierre remoto',
    titulo: 'Central cierra por `android_command` (key=sesion)',
    riesgo: 'Mismo bloqueo de 60 s del dispatcher que por `operation`.',
    pasos: [['login'], ['esperar', { s: 5 }], ['cerrarRemoto', { via: 'android_command' }], ['esperar', { s: 90 }]],
    checks: w => [c(w.sesion == null, 'sesión cerrada'), c(ev(w, /dispatcher ocupado/), 'hubo mensajes esperando en cola del dispatcher')],
  },
  {
    id: 'remoto-reenvio-id-fijo',
    config: { servidor: { autoSesion: 'nunca' } },
    grupo: 'Cierre remoto',
    riesgo: 'Los reenvíos de la central usan un id fijo (09374710268af53289c05871). El deduper recuerda ids atendidos: un segundo cierre remoto que solo llega por reenvío se descarta como "ya atendido" y la sesión sigue abierta.',
    titulo: 'Dos cierres remotos perdidos que llegan por reenvío',
    pasos: [
      ['login'], ['esperar', { s: 3 }],
      ['red', { on: false }], ['cerrarRemoto', { via: 'operation' }], ['esperar', { s: 30 }], ['red', { on: true }], ['esperar', { min: 6 }],
      ['login'], ['esperar', { s: 3 }],
      ['red', { on: false }], ['cerrarRemoto', { via: 'operation' }], ['esperar', { s: 30 }], ['red', { on: true }], ['esperar', { min: 6 }],
    ],
    checks: w => [
      c(hay(w, /logout solicitado: 35417/), 'la 1ra sesión se cierra por el reenvío'),
      c(hay(w, /operation 09374710268af53289c05871 ya atendida/), 'el 2do reenvío se toma como "ya atendida"'),
      c(w.sesion?.id === 35418, 'la 2da sesión (35418) sigue abierta'),
    ],
  },
  {
    id: 'remoto-a-central-reabre-b',
    grupo: 'Cierre remoto',
    titulo: 'Cierre remoto de una A: la central reabre B',
    riesgo: 'Con la regla observada (al cerrar A crea B) el cierre remoto de una A no deja al bus sin sesión: la central empuja la B y el equipo la acepta (cierre remoto no bloquea logins).',
    pasos: [['login'], ['irA', { paradero: 'AV. CENTRAL@A' }], ['cerrarRemoto', { via: 'operation' }], ['esperar', { s: 90 }]],
    checks: w => [c(hay(w, /Logout confirmado: 35417/), 'cierra la 35417'), c(lado(w) === 'B', 'queda en B (automática de la central)')],
  },
  {
    id: 'remoto-ya-finalizada',
    config: { servidor: { autoSesion: 'nunca' } },
    grupo: 'Cierre remoto',
    titulo: 'Cierre remoto de una sesión ya finalizada',
    pasos: [['login'], ['esperar', { s: 3 }], ['terminarVenta'], ['esperar', { s: 3 }], ['cerrarRemoto', { via: 'android_command', sesion: 35417 }], ['esperar', { s: 3 }]],
    checks: w => [c(hay(w, /ACK 35417:WARN:SESION_YA_FINALIZADA/), 'ACK WARN SESION_YA_FINALIZADA'), c(cuenta(w, /\[ENVIADO\].*driver_logout/) === 1, 'no reenvía driver_logout')],
  },
  {
    id: 'remoto-desconocida',
    grupo: 'Cierre remoto',
    titulo: 'Cierre remoto de una sesión que el equipo no conoce',
    pasos: [['cerrarRemoto', { via: 'android_command', sesion: 99999 }], ['esperar', { s: 3 }]],
    checks: w => [c(hay(w, /ACK 99999:WARN:SESION_NO_ENCONTRADA/), 'ACK WARN SESION_NO_ENCONTRADA')],
  },
  {
    id: 'logout-conductor-sin-sesion',
    grupo: 'Cierre remoto',
    titulo: 'logout-conductor sin sesión',
    pasos: [['logoutConductor'], ['esperar', { s: 3 }]],
    checks: w => [c(hay(w, /ACK logout-conductor:ERROR:SIN_SESION_ACTIVA/), 'ACK ERROR SIN_SESION_ACTIVA')],
  },
  {
    id: 'login-conductor-remoto',
    grupo: 'Cierre remoto',
    titulo: 'login-conductor remoto usa el lado por GPS',
    pasos: [['irA', { paradero: 'Butter' }], ['loginConductor'], ['esperar', { s: 5 }]],
    checks: w => [c(hay(w, /performLogin origen=remoto/), 'performLogin origen=remoto'), c(lado(w) === 'B', 'abre B (orden 1 más cercano)'), c(hay(w, /ACK 40000001 0001:OK/), 'ACK OK')],
  },
  {
    id: 'login-conductor-invalido',
    grupo: 'Cierre remoto',
    titulo: 'login-conductor sin clave',
    pasos: [['loginConductor', { value: '40000001' }], ['esperar', { s: 3 }]],
    checks: w => [c(hay(w, /ACK 40000001:ERROR:VALOR_INVALIDO/), 'ACK ERROR VALOR_INVALIDO'), c(w.sesion == null, 'sin sesión')],
  },

  // ── Cierres forzados ────────────────────────────────────────────────────────
  {
    id: 'forzado-sesion-huerfana',
    grupo: 'Cierres forzados (Protector)',
    titulo: 'ENERGY en la base: la central abre B y el equipo lo descarta',
    riesgo: 'Tras un logout forzado la central crea la sesión automática del otro lado; el equipo la descarta (blockIncomingLogin) pero en la central queda ABIERTA sin que nadie la use (visto en 130LOG 20-08 y 28LOG 12-08).',
    pasos: [['login'], ['esperar', { s: 3 }], ['energy'], ['esperar', { s: 210 }]],
    checks: w => [
      c(hay(w, /ENERGY: cerrando sesión 35417/), 'Protector cierra la sesión'),
      c(hay(w, /onLoginSuccess: bloqueado por logout forzado \(descartada sesión 35418 lado=B/), 'descarta la sesión automática 35418'),
      c(w.sesion == null, 'el equipo queda sin sesión'),
      c(abiertas(w).some(s => s.id === 35418), 'la central deja abierta la 35418'),
    ],
  },
  {
    id: 'forzado-otro-conductor-bloqueado',
    grupo: 'Cierres forzados (Protector)',
    titulo: '…y al día siguiente otro chofer no puede entrar',
    riesgo: 'Reproduce 28LOG (13-08): "La unidad tiene una sesión abierta con otro conductor - 1187" repetido toda la mañana.',
    pasos: [['login'], ['esperar', { s: 3 }], ['energy'], ['esperar', { s: 210 }], ['hora', { hora: '05:30' }], ['login', { dni: '40000002', clave: '0002' }], ['esperar', { s: 3 }]],
    checks: w => [c(hay(w, /sesión abierta con otro conductor {2}- 35418/), 'rechazo por la sesión huérfana 35418'), c(w.sesion == null, 'el chofer 2 no puede trabajar')],
  },
  {
    id: 'forzado-reingreso-rebote',
    grupo: 'Cierres forzados (Protector)',
    titulo: '…y el mismo chofer reingresa a B y rebota a A',
    descripcion: 'Pide A en la base, la central devuelve la B huérfana ("Ha reingresado"); el bus está dentro del TERMINAL de B → cierra al instante y el autoretorno abre A.',
    pasos: [['login'], ['esperar', { s: 3 }], ['energy'], ['esperar', { s: 210 }], ['cargar'], ['login'], ['esperar', { s: 10 }]],
    checks: w => [
      c(hay(w, /Ha reingresado a su sesión anterior/), 'central devuelve la sesión B huérfana'),
      c(hay(w, /Terminal alcanzado lado=true \(TERMINAL\)/), 'cierra B al instante en TERMINAL'),
      c(lado(w) === 'A', 'termina en A'),
    ],
  },
  {
    id: 'forzado-come-login',
    grupo: 'Cierres forzados (Protector)',
    titulo: 'ENERGY a mitad de ruta (central sin automática): el primer login manual se pierde',
    config: { servidor: { autoSesion: 'nunca' } },
    riesgo: 'Si la central NO empuja sesión automática, blockIncomingLogin queda armado y descarta la respuesta del siguiente login legítimo del chofer.',
    pasos: [['login'], ['irA', { paradero: 'AV. EL SOL@A' }], ['energy'], ['esperar', { s: 210 }], ['cargar'], ['login'], ['esperar', { s: 5 }]],
    checks: w => [c(hay(w, /onLoginSuccess: bloqueado por logout forzado \(descartada sesión 35418/), 'la sesión del login manual se descarta'), c(w.sesion == null, 'el chofer queda sin sesión'), c(abiertas(w).some(s => s.id === 35418), 'pero en la central 35418 está abierta')],
  },
  {
    id: 'bateria-critica',
    grupo: 'Cierres forzados (Protector)',
    titulo: 'Batería crítica: cierra y apaga el equipo',
    pasos: [['irA', { paradero: 'AV. CENTRAL@A' }], ['login'], ['esperar', { s: 3 }], ['bateriaCritica'], ['esperar', { s: 30 }]],
    checks: w => [c(hay(w, /Bateria critica: cerrando sesión 35417/), 'cierra la sesión'), c(!w.device.encendido, 'equipo apagado'), c(abiertas(w).length === 1 && abiertas(w)[0].automatica, 'en la central queda una B automática huérfana')],
  },
  {
    id: 'noche',
    grupo: 'Cierres forzados (Protector)',
    titulo: 'Cierre nocturno 02:30 en la base',
    riesgo: 'Mismo efecto que ENERGY: la central crea la B automática y queda huérfana.',
    config: { inicio: Date.UTC(2026, 8, 23, 23, 50) },
    pasos: [['login'], ['esperar', { s: 3 }], ['noche'], ['esperar', { min: 2 }]],
    checks: w => [c(hay(w, /NIGHT: cerrando sesión 35417/), 'NIGHT cierra la sesión'), c(w.sesion == null, 'equipo sin sesión'), c(abiertas(w).length === 1, 'la central tiene 1 sesión huérfana')],
  },

  // ── Reinicio y restauración ─────────────────────────────────────────────────
  {
    id: 'reinicio-restaura-y-hereda',
    grupo: 'Reinicio y restauración',
    titulo: 'Reinicio a mitad de A: restaura y el autoretorno usa el DNI de Room',
    descripcion: 'Tras reiniciar las credenciales en memoria se pierden; el autoretorno las toma de la sesión cerrada en Room.',
    pasos: [['login'], ['irA', { paradero: 'AV. EL SOL@A' }], ['reiniciar'], ['esperar', { s: 10 }], ['irA', { paradero: 'R. PANAMA' }], ['irA', { paradero: 'Butter' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /Restauración: sesión 35417 lado=A restaurada desde BD \(creds=sí\)/), 'restaura 35417 con credenciales'),
      c(lado(w) === 'B', 'abre B tras el reinicio'),
      c(w.device.room.find(e => e.direction === true)?.dni === '40000001', 'la B nueva también guarda el DNI'),
    ],
  },
  {
    id: 'reinicio-sesion-ayer',
    grupo: 'Reinicio y restauración',
    titulo: 'Equipo apagado de noche: al encender cierra la sesión de ayer… y la central abre B',
    riesgo: 'Cerrar la A vencida dispara la B automática de la central y el equipo la acepta: al día siguiente la unidad amanece logueada en B con el chofer de ayer (y otro chofer no puede entrar).',
    pasos: [['irA', { paradero: 'AV. CENTRAL@A' }], ['login'], ['esperar', { s: 3 }], ['apagar'], ['hora', { hora: '05:00' }], ['encender'], ['esperar', { s: 10 }]],
    checks: w => [
      c(hay(w, /Restauración: sesión 35417 de un día anterior/), 'detecta la sesión de ayer y la cierra'),
      c(!hay(w, /Autoretorno/), 'el equipo no pide autoretorno'),
      c(w.sesion?.id === 35418 && w.sesion.driver_code === 'ID131' && lado(w) === 'B', 'amanece en B (35418) con el chofer de ayer'),
    ],
  },
  {
    id: 'reinicio-sesion-ayer-sin-automatica',
    grupo: 'Reinicio y restauración',
    titulo: 'Sesión de ayer sin sesión automática de la central',
    config: { servidor: { autoSesion: 'nunca' } },
    pasos: [['irA', { paradero: 'AV. CENTRAL@A' }], ['login'], ['esperar', { s: 3 }], ['apagar'], ['hora', { hora: '05:00' }], ['encender'], ['esperar', { s: 10 }]],
    checks: w => [c(w.sesion == null && abiertas(w).length === 0, 'queda sin sesión (equipo y central)')],
  },
  {
    id: 'cambio-viaje',
    grupo: 'Reinicio y restauración',
    titulo: 'Cambio de viaje con sesión activa',
    descripcion: 'El nuevo trip dispara la restauración; con la lógica actual la sesión en memoria no cambia.',
    pasos: [['login'], ['esperar', { s: 3 }], ['viaje'], ['esperar', { s: 3 }]],
    checks: w => [c(w.sesion?.id === 35417, 'misma sesión'), c(cuenta(w, /\[ENVIADO\].*driver_logout/) === 0, 'sin logout')],
  },

  // ── Red y GPS ───────────────────────────────────────────────────────────────
  {
    id: 'offline-en-terminal',
    grupo: 'Red y GPS',
    titulo: 'Sin señal al llegar a Butter',
    riesgo: 'driver_logout no sale y no se reintenta: el cierre solo se vuelve a evaluar cuando cambia el paradero actual (aquí en SURCO FINAL A).',
    pasos: [['login'], ['irA', { paradero: 'R. PANAMA' }], ['red', { on: false }], ['irA', { paradero: 'Butter' }], ['esperar', { s: 5 }], ['red', { on: true }], ['esperar', { min: 3 }], ['irA', { paradero: 'SURCO FINAL A' }], ['esperar', { s: 5 }]],
    checks: w => [
      c(hay(w, /driver_logout no enviado: socket desconectado/), 'driver_logout no enviado'),
      c(cuenta(w, /Terminal alcanzado lado=false/) === 2, 'segundo intento recién en SURCO FINAL A'),
      c(lado(w) === 'B', 'al final abre B'),
    ],
  },
  {
    id: 'sin-paraderos',
    grupo: 'Red y GPS',
    titulo: 'Ruta sin paraderos cargados',
    config: { ruta: { nombre: 'Ruta vacía', route: 1, vehicle: 15, paraderos: [] } },
    pasos: [['login'], ['esperar', { s: 3 }]],
    checks: w => [c(lado(w) === 'A', 'abre A por defecto'), c(hay(w, /Lado login=A por sin paradero orden 1/), 'log "sin paradero orden 1 → A por defecto"'), c(w.device.m.paraderoActual == null, 'sin paradero inicial')],
  },

  // ── Central ─────────────────────────────────────────────────────────────────
  {
    id: 'central-y-equipo-abren-b',
    grupo: 'Central',
    titulo: 'Central y equipo abren B a la vez: no se duplica',
    descripcion: 'La central crea la automática; el driver_login del autoretorno recibe "Ha reingresado".',
    pasos: [['login'], ['irA', { paradero: 'R. PANAMA' }], ['irA', { paradero: 'Butter' }], ['esperar', { s: 5 }]],
    checks: w => [c(hay(w, /nueva sesión automática/), 'push de la central'), c(hay(w, /Ha reingresado a su sesión anterior/), 'reingreso del equipo'), c(w.server.sesiones.length === 2, 'solo 2 sesiones en la central')],
  },
  {
    id: 'central-cierra-solo-bd',
    grupo: 'Central',
    titulo: 'Operador cierra la sesión solo en la web',
    descripcion: 'El equipo sigue vendiendo; en el terminal recibe "Ya estaba cerrada" y el autoretorno abre B igual.',
    pasos: [['login'], ['esperar', { s: 3 }], ['cerrarEnServidor', { sesion: 35417 }], ['irA', { paradero: 'R. PANAMA' }], ['irA', { paradero: 'Butter' }], ['esperar', { s: 5 }]],
    checks: w => [c(hay(w, /title=Ya estaba cerrada/), 'central responde "Ya estaba cerrada"'), c(lado(w) === 'B', 'abre B')],
  },

  // ── APK 1.0.66 ──────────────────────────────────────────────────────────────
  {
    id: 'v66-incidente-124',
    grupo: 'APK 1.0.66 (campo)',
    titulo: 'Incidente padrón 124 (23-09) con la 1.0.66',
    riesgo: 'Reproduce el incidente: autoLogin=false en memoria → no cierra en Butter; el cierre por `operation` se ignora y la central lo reenvía cada 5 min.',
    config: { perfil: 'v1066' },
    pasos: [['login'], ['recorrer', { lado: 'A' }], ['esperar', { s: 10 }], ['cerrarRemoto', { via: 'operation' }], ['esperar', { min: 16 }]],
    checks: w => [
      c(hay(w, /Retornogps: true/), 'Retornogps: true'),
      c(hay(w, /VALIDATE AutoLogin: false - Paradero actual: Paradero\(id=45/), 'VALIDATE AutoLogin: false en Butter'),
      c(cuenta(w, /\[RECIBIDO\].*operation \[DATA\]/) >= 4, 'operation recibido y reenviado varias veces'),
      c(w.sesion?.id === 35417, 'la sesión A sigue abierta'),
    ],
  },
  {
    id: 'actual-incidente-124',
    grupo: 'APK 1.0.66 (campo)',
    titulo: 'Mismo día con la lógica actual',
    pasos: [['login'], ['recorrer', { lado: 'A', hasta: 'Butter' }], ['esperar', { s: 10 }], ['cerrarRemoto', { via: 'operation' }], ['esperar', { s: 90 }]],
    checks: w => [c(hay(w, /Terminal alcanzado lado=false \(Butter\)/), 'cierra en Butter'), c(hay(w, /logout solicitado: 35418/), 'el cierre remoto cierra la B'), c(w.sesion == null, 'sin sesión al final')],
  },
  {
    id: 'v66-cambio-viaje',
    grupo: 'APK 1.0.66 (campo)',
    titulo: '1.0.66: el cambio de viaje "arregla" el autoLogin',
    descripcion: 'La restauración copia autoLogin=true desde Room; desde ahí sí cierra en terminal (como a las 13:46 del incidente).',
    config: { perfil: 'v1066' },
    pasos: [['login'], ['irA', { paradero: 'R. PANAMA' }], ['viaje'], ['esperar', { s: 3 }], ['irA', { paradero: 'Butter' }], ['esperar', { s: 5 }]],
    checks: w => [c(hay(w, /VALIDATE AutoLogin: true - Paradero actual: Paradero\(id=45/), 'VALIDATE AutoLogin: true en Butter'), c(hay(w, /Ejecutando auto-login/), 'Ejecutando auto-login'), c(lado(w) === 'B', 'abre B')],
  },
  {
    id: 'v66-b-pide-b',
    grupo: 'APK 1.0.66 (campo)',
    titulo: '1.0.66: al cerrar B vuelve a pedir B en cada cambio de viaje',
    descripcion: 'En la 1.0.66 el paradero actual se filtra por el lado del VIAJE (protoLogin.direction), por eso el guion cambia el viaje a B al empezar el lado B.',
    riesgo: 'executeAutoLogin siempre pide direction=true. Con autoLogin=true (restaurado de Room en cada cambio de viaje) cada viaje en el terminal de B cierra la B y abre otra B. Hipótesis para el bucle login/logout de 124LOG 07-09.',
    config: { perfil: 'v1066', servidor: { autoSesion: 'nunca' } },
    pasos: [
      ['login'], ['viaje'], ['recorrer', { lado: 'A', hasta: 'Butter' }], ['esperar', { s: 5 }],
      ['irA', { paradero: 'PDRO SURCO' }], ['viaje', { direction: true }], ['recorrer', { lado: 'B', hasta: 'PORTÓN' }], ['esperar', { s: 5 }],
      ['viaje', { direction: true }], ['esperar', { s: 5 }], ['viaje', { direction: true }], ['esperar', { s: 5 }],
    ],
    checks: w => {
      const b = w.server.sesiones.filter(s => s.direction === true)
      return [
        c(hay(w, /VALIDATE AutoLogin: false - Paradero actual: Paradero\(id=17,/),'con la B recién abierta no cierra en PORTÓN (autoLogin=false)'),
        c(b.length >= 3, `cada cambio de viaje en PORTÓN abre otra B (${b.length} sesiones B)`),
        c(!w.server.sesiones.some(s => s.direction === false && s.id > 35417), 'nunca pide A'),
      ]
    },
  },
]

/** Tras cada acción "humana" pasan 2 s (como en la UI) para que viajen los mensajes. */
export const PAUSA_MS = 2000
export const SIN_PAUSA = new Set(['esperar', 'hora', 'noche', 'recorrer'])

export function correrEscenario(esc, extra = {}) {
  const w = new World({ ...(esc.config ?? {}), ...extra })
  const errores = []
  for (const [accion, params] of esc.pasos) {
    try {
      w.accion(accion, params ?? {})
      if (!SIN_PAUSA.has(accion)) w.avanzar(PAUSA_MS)
    } catch (e) {
      errores.push(`${accion}: ${e.message}`)
      break
    }
  }
  const checks = errores.length ? errores.map(e => c(false, `error en el guion → ${e}`)) : esc.checks(w)
  return { esc, world: w, checks, ok: checks.every(x => x.ok) }
}

export const correrTodos = extra => ESCENARIOS.map(e => correrEscenario(e, extra))

export { MIN }
