# DriverLogin Lab

Simulador y diagnóstico del flujo de sesión del chofer (`driver_login` / `driver_logout`) de la ticketera TCONTUR
(`portable-bus-printer`). Corre la **misma lógica** que la app Android (port 1:1 de `DriverSessionPolicy`) y escribe
los **mismos logs** que `LogManager`, así un log simulado y uno real se leen igual.

```bash
npm install
npm run dev          # http://localhost:5178
npm test             # 70 tests: port de la policy, 41 escenarios, analizador contra 3 logs reales
npm run escenarios   # resumen en consola (o: npm run escenarios -- ciclo-a-b)
npm run diagnosticar -- ruta/LOG.txt --reproducir actual
```

## Pestañas

- **Simulador**: mapa con los paraderos reales de la ruta 1 (padrón 124), el bus, la central y el equipo. Se eligen
  la lógica (actual o APK 1.0.66), la config de la ruta (`retorno_auto_b`/`retorno_auto_a`: booleano, texto o ausente) y
  cómo se comporta la central. Botones para login manual/NFC, Terminar venta, conducir un lado, cierre remoto por
  `operation` o `android_command`, `login-conductor`, reinicio, apagado, señal, batería crítica, ENERGY, 02:30, día
  siguiente… Muestra la memoria del equipo, Room, la central, una línea de tiempo y el log. "Convertir lo hecho en
  escenario" genera un guion pegable en `src/engine/scenarios.js`.
- **Escenarios**: 41 variantes con lo que se espera de cada una. Las marcadas *riesgo* documentan un comportamiento
  actual indeseado (pasan mientras el problema exista). Se pueden abrir en el simulador para seguir jugando.
- **Diagnóstico de logs**: arrastra el `.txt` que sube el equipo. Reconstruye las sesiones (cómo se abrió y cerró
  cada una), lista hallazgos con las líneas de evidencia y **reproduce el día** con otra lógica: toma del log el GPS, los
  logins, las órdenes de la central, reinicios, señal y batería, y deja que la lógica elegida decida el resto.
- **Cómo funciona**: el flujo, lo que hace la central y las líneas de log que se entienden.

## Estructura

```
src/engine/policy.js     port 1:1 de DriverSessionPolicy.kt + LogoutIntents + OperationDeduper
src/engine/device.js     la ticketera: repository, coordinator, ParaderoManager, dispatcher, GpsViewModel, Protector
src/engine/server.js     la central (reglas deducidas de logs de ago–sep 2026)
src/engine/world.js      reloj virtual, cola de eventos, red y acciones
src/engine/scenarios.js  catálogo de escenarios con verificaciones
src/analyzer/            parser del log, reconstrucción de sesiones, hallazgos y reproducción
fixtures/                3 logs reales anonimizados (DNI y claves reemplazados)
scripts/anonimizar.js    node scripts/anonimizar.js LOG.txt salida.log --recortar
```

## Lo que se sabe de la central (de los logs)

- Al cerrar una sesión **A** abierta, por cualquier motivo, crea sola la **B** y la empuja como `driver_login`
  "Se ha creado una nueva sesión automática" (8 de 8 casos; nunca al cerrar B).
- Si el chofer ya tiene una sesión abierta, un login devuelve **esa** sesión ("Ha reingresado…") aunque pida el otro lado.
- Otro chofer con la unidad ocupada recibe "La unidad tiene una sesión abierta con otro conductor - id".
- Un `operation` sin eco se reenvía cada ~5 min; los reenvíos usan el id fijo `09374710268af53289c05871`.

La regla de la sesión automática se puede cambiar en el simulador para probar hipótesis.

## Mantenerlo fiel

Si cambia la lógica en Android: actualiza `policy.js` / `device.js`, corre `npm test` y revisa los escenarios que
cambian de resultado. Un escenario de riesgo que empieza a fallar suele significar que el riesgo se corrigió.
