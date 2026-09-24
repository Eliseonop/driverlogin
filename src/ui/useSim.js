// Estado del simulador en la UI: un World mutable + contador de versión para re-renderizar,
// reloj en vivo (play) y conducción animada punto a punto.

import { useEffect, useRef, useState } from 'react'
import { World } from '../engine/world.js'

export function useSim(cfgInicial) {
  const worldRef = useRef(null)
  if (!worldRef.current) worldRef.current = new World(cfgInicial)
  const [cfg, setCfg] = useState(cfgInicial)
  const [ver, setVer] = useState(0)
  const [play, setPlay] = useState(false)
  const [vel, setVel] = useState(30)
  const [error, setError] = useState(null)
  const ruta = useRef(null)
  const bump = () => setVer(v => v + 1)

  const reiniciar = (nuevo = cfg) => {
    worldRef.current = new World(nuevo)
    setCfg(nuevo)
    ruta.current = null
    setPlay(false)
    setError(null)
    bump()
  }

  const cargar = w => {
    worldRef.current = w
    ruta.current = null
    setPlay(false)
    bump()
  }

  const accion = (tipo, a = {}, pausaMs = 2000) => {
    try {
      worldRef.current.accion(tipo, a)
      if (pausaMs) worldRef.current.avanzar(pausaMs)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
    bump()
  }

  const avanzar = ms => {
    worldRef.current.avanzar(ms)
    bump()
  }

  const conducir = (lado, hasta, kmh = 30) => {
    const w = worldRef.current
    const plan = w.planRecorrido({ lado, hasta: hasta || undefined, kmh })
    if (!plan.puntos.length) return setError('No hay recorrido: el bus ya está al final de ese lado')
    w.evento('accion', `🚌 Conduce lado ${lado}${hasta ? ` hasta ${hasta}` : ''} (${plan.puntos.length} puntos)`)
    w.acciones.push({ t: w.now, tipo: 'recorrer', a: { lado, hasta: hasta || undefined, kmh }, duracionMs: plan.puntos.length * plan.pasoMs })
    ruta.current = { ...plan, i: 0, presupuesto: 0, autoPlay: !play }
    setPlay(true)
    bump()
  }

  const detener = () => {
    ruta.current = null
    setPlay(false)
    bump()
  }

  useEffect(() => {
    if (!play) return
    const id = setInterval(() => {
      const w = worldRef.current
      const r = ruta.current
      const ms = 100 * vel
      try {
        if (r) {
          r.presupuesto += ms
          while (r.presupuesto >= r.pasoMs && r.i < r.puntos.length) {
            w.avanzar(r.pasoMs)
            const p = r.puntos[r.i++]
            w.moverBus(p.lat, p.lng)
            r.presupuesto -= r.pasoMs
          }
          if (r.i >= r.puntos.length) {
            ruta.current = null
            if (r.autoPlay) setPlay(false)
          }
        } else w.avanzar(ms)
      } catch (e) {
        setError(e.message)
        setPlay(false)
      }
      bump()
    }, 100)
    return () => clearInterval(id)
  }, [play, vel])

  return {
    w: worldRef.current,
    ver,
    cfg,
    play,
    setPlay,
    vel,
    setVel,
    error,
    accion,
    avanzar,
    reiniciar,
    cargar,
    conducir,
    detener,
    conduciendo: ruta.current ? `${ruta.current.i}/${ruta.current.puntos.length}` : null,
  }
}
