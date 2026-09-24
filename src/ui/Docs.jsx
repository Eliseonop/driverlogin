export default function Docs() {
  return (
    <div className="docs">
      <h2 style={{ marginTop: 0 }}>Cómo funciona la sesión del chofer (lógica actual, rama validator)</h2>
      <p>
        El equipo es quien pide cada login y cada logout por el socket. La central responde creando o cerrando la sesión, <b>y además</b> puede crear sola una sesión (la
        "sesión automática") y empujarla como <code>driver_login</code>.
      </p>
      <div className="flujo">
        <div className="paso">
          <b>1 · Login</b>
          <br />
          Manual, tarjeta NFC (<code>uid_driver</code>) o <code>login-conductor</code> de la central. El lado pedido es el del paradero <b>orden 1 más cercano</b> de la ruta (de
          los dos lados). Si no hay paraderos, lado A. La config de retorno no interviene.
        </div>
        <div className="paso">
          <b>2 · Respuesta</b>
          <br />
          La central devuelve la sesión: nueva, <i>reingreso</i> (si el chofer ya tenía una abierta, aunque sea del otro lado) o error. El equipo activa la que llega, fija el
          paradero inicial (orden 1 de ese lado) y la guarda en Room con DNI y clave.
        </div>
        <div className="paso">
          <b>3 · Terminal</b>
          <br />
          Cuando el paradero actual (dentro del radio, lado de la sesión) es terminal o liquidar, pide el logout con <code>autoRetorno=true</code>.
        </div>
        <div className="paso">
          <b>4 · Autoretorno</b>
          <br />
          Al confirmarse ese logout: si cerró A y la ruta tiene <code>retorno_auto_b=true</code> abre B; si cerró B y tiene <code>retorno_auto_a=true</code> abre A. Usa el DNI de
          la sesión cerrada en Room.
        </div>
        <div className="paso">
          <b>5 · Otros cierres</b>
          <br />
          Terminar venta, cierre remoto (<code>operation</code> o <code>android_command</code> key=sesion) y <code>logout-conductor</code> solo cierran. Batería crítica, ENERGY y
          NIGHT cierran y bloquean el siguiente <code>driver_login</code> entrante.
        </div>
        <div className="paso">
          <b>6 · Reinicio</b>
          <br />
          Con cada viaje nuevo (y al arrancar) busca la última sesión abierta en Room: si es de hoy la restaura, si es de ayer manda el logout.
        </div>
      </div>

      <h2>Qué hace la central (deducido de los logs)</h2>
      <table className="t">
        <thead>
          <tr>
            <th>Situación</th>
            <th>Respuesta</th>
            <th>Evidencia</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Se cierra una sesión A abierta (cualquier motivo)</td>
            <td>crea sola la B y la empuja: "Se ha creado una nueva sesión automática"</td>
            <td>8 de 8 cierres de A (120, 125, 130, 133, 28, 124) · 0 de 7 cierres de B</td>
          </tr>
          <tr>
            <td>El chofer ya tiene sesión abierta</td>
            <td>"Ha reingresado a su sesión anterior" con ESA sesión, aunque pida el otro lado</td>
            <td>130LOG 06:09 pidió A → le dio B</td>
          </tr>
          <tr>
            <td>Otro chofer tiene la unidad</td>
            <td>error "La unidad tiene una sesión abierta con otro conductor - id"</td>
            <td>28LOG 13-08 ×16</td>
          </tr>
          <tr>
            <td>Cierre remoto sin eco</td>
            <td>reenvía la operation cada ~5 min con id fijo 09374710268af53289c05871</td>
            <td>124LOG 23-09 y 01-09</td>
          </tr>
        </tbody>
      </table>
      <p className="tenue">En el simulador la regla de la central se puede cambiar (pestaña Simulador → Central) para probar hipótesis.</p>

      <h2>Riesgos que el simulador reproduce</h2>
      <table className="t">
        <thead>
          <tr>
            <th>Riesgo</th>
            <th>Escenario</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tras un cierre forzado la central abre B, el equipo la descarta y queda <b>huérfana</b>: otro chofer no puede entrar.</td>
            <td>
              <code>forzado-sesion-huerfana</code>, <code>forzado-otro-conductor-bloqueado</code>
            </td>
          </tr>
          <tr>
            <td>Si la central no empuja nada tras el cierre forzado, el bloqueo se come el primer login legítimo.</td>
            <td>
              <code>forzado-come-login</code>
            </td>
          </tr>
          <tr>
            <td>El cierre remoto bloquea el dispatcher del socket hasta 60 s (espera su propia respuesta).</td>
            <td>
              <code>remoto-operation</code>, <code>remoto-android-command</code>
            </td>
          </tr>
          <tr>
            <td>Deduplicar solo por id: un segundo cierre remoto que llega solo por reenvío (id fijo) se descarta.</td>
            <td>
              <code>remoto-reenvio-id-fijo</code>
            </td>
          </tr>
          <tr>
            <td>Terminar venta / cierre remoto de una A: la central reabre B y el equipo la acepta.</td>
            <td>
              <code>terminar-venta-a-central-abre-b</code>, <code>remoto-a-central-reabre-b</code>
            </td>
          </tr>
          <tr>
            <td>Equipo apagado de noche: al encender cierra la A de ayer y amanece en una B automática del chofer de ayer.</td>
            <td>
              <code>reinicio-sesion-ayer</code>
            </td>
          </tr>
          <tr>
            <td>Sin fix GPS tras reiniciar el lado se calcula desde (0,0).</td>
            <td>
              <code>lado-sin-fix</code>
            </td>
          </tr>
          <tr>
            <td>Sin señal en el terminal: el logout no sale y no se reintenta hasta otro paradero terminal/liquidar.</td>
            <td>
              <code>offline-en-terminal</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Líneas de log que entiende el diagnóstico</h2>
      <p>Las marcadas ✚ son nuevas en la rama (agregadas para poder diagnosticar); el resto ya existían en la 1.0.66.</p>
      <table className="t">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Mensaje</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['SocketService', '[ENVIADO] | [NUEVO] (nB) [KEY]: driver_login|driver_logout|operation|android_command [DATA]: {...}'],
            ['SocketService', '[RECIBIDO]| #n | SID:x | nB | driver_login|driver_logout|operation|android_command|login [DATA]: {...}'],
            ['SocketService', '✅ CONECTADO … / [ENVIADO] | [ERROR🔴] :No conectado'],
            ['ParaderoManager', 'Paradero actual: NOMBRE (id=N) · Paradero más cercano[ orden 1]: Paradero(...) · TERMINAL …'],
            ['DriverLoginRepository', '✚ performLogin origen=manual|nfc|remoto dni=…'],
            ['DriverLoginRepository', '✚ Lado login=A|B por NOMBRE (id=N) gps=lat,lng acc=Nm fix=true|false'],
            ['DriverLoginRepository', 'driver_logout no enviado: socket desconectado · ✚ driver_logout N: sin respuesta en 60s'],
            ['DriverSessionCoordinator', 'logout solicitado: N allowAutoLogin=… autoRetorno=…'],
            ['DriverSessionCoordinator', '✚ Sesión activada: N lado=A|B \'mensaje de la central\''],
            ['DriverSessionCoordinator', '✚ onLoginSuccess: bloqueado por logout forzado (descartada sesión N lado=B \'…\')'],
            ['DriverSessionCoordinator', '✚ Login rechazado: título - mensaje · ✚ Logout confirmado: N lado=A autoRetorno=true \'…\''],
            ['DRIVERAUTO', 'Terminal alcanzado lado=… (NOMBRE) → cerrar sesión N · Autoretorno → abriendo lado B (retorno_auto_b)'],
            ['DRIVERAUTO', '1.0.66: Primera sesión obtenida · VALIDATE AutoLogin · Ejecutando logout automático · Ejecutando auto-login'],
            ['GpsViewModel', '✚ Restauración: sin sesión pendiente | sesión N de un día anterior → cerrando | sesión N lado=A restaurada desde BD (creds=sí)'],
            ['ProtectorVM', 'Bateria critica (10%) · ENERGY: … · NIGHT: … · X: cerrando sesión N'],
            ['SocketMessageDispatcher', 'Mensaje: Header: … · Processing operation · ↩️ ACK … · ↩️ operation … ya atendida · 👤 Operation login-conductor'],
          ].map(([t, m], i) => (
            <tr key={i}>
              <td className={`mono tag-${t}`}>{t}</td>
              <td className="mono">{m}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Mantener el simulador fiel al código</h2>
      <ul>
        <li>
          <code>src/engine/policy.js</code> es un port 1:1 de <code>DriverSessionPolicy.kt</code>, <code>LogoutIntents</code> y <code>OperationDeduper</code>.
        </li>
        <li>
          <code>src/engine/device.js</code> replica las clases que la usan (repository, coordinator, ParaderoManager, dispatcher, GpsViewModel, Protector) y escribe los mismos logs.
        </li>
        <li>
          Si cambias la lógica en Android, cambia el port y corre <code>npm test</code>: los escenarios marcados como riesgo fallarán cuando el riesgo se corrija (actualízalos).
        </li>
      </ul>
    </div>
  )
}
