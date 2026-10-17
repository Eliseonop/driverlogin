import { useEffect, useRef, useState } from 'react'

// La app de consumo (WebstormProjects/consumo, copiada en public/consumo con `npm run consumo`) corre en un iframe del
// mismo origen: analiza el mismo log y cada pestaña muestra un grupo de sus paneles. Se monta la primera vez que hace falta.
const RUTA = '/consumo/index.html?embed'

export const TITULO_GRUPO = {
  sesiones: 'Más análisis de sesiones (app de consumo)',
  ventas: 'Ventas, impresión y envío a la central',
  consumo: 'Consumo de datos, reinicios y red',
}

export function useConsumo(rep, plataforma) {
  const [montado, setMontado] = useState(false)
  const [paneles, setPaneles] = useState(null)
  const [error, setError] = useState(null)
  const [alto, setAlto] = useState(400)
  const frame = useRef(null)
  const pendientes = useRef([])
  const sesionesCargadas = useRef(null)

  useEffect(() => {
    const oir = e => e.source === frame.current?.contentWindow && e.data?.consumoAlto && setAlto(e.data.consumoAlto)
    window.addEventListener('message', oir)
    return () => window.removeEventListener('message', oir)
  }, [])

  const alCargar = () => {
    const w = frame.current?.contentWindow
    // Deja pintar el "Analizando…" antes de bloquear con el análisis.
    setTimeout(() => {
      try {
        sesionesCargadas.current = plataforma
        setPaneles(w.consumoEmbed.cargar(rep.texto, rep.archivo, plataforma))
        pendientes.current.splice(0).forEach(f => f(w))
      } catch (e) {
        setError(e.message)
      }
    }, 30)
  }

  const conVentana = f => {
    if (paneles) return f(frame.current.contentWindow)
    setMontado(true)
    pendientes.current.push(f)
  }

  /** Informe de boletos de la app de consumo. La pestaña se abre dentro del clic para que el navegador no la bloquee. */
  const informe = imprimir => {
    const pestana = imprimir ? null : window.open('', '_blank')
    if (pestana) pestana.document.title = 'Generando informe…'
    conVentana(w => {
      const html = w.informeHtml()
      if (pestana) {
        pestana.location.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
        return
      }
      const f = document.createElement('iframe')
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
      f.onload = () => {
        f.contentWindow.addEventListener('afterprint', () => f.remove())
        f.contentWindow.focus()
        f.contentWindow.print()
      }
      f.srcdoc = html
      document.body.appendChild(f)
    })
  }

  /** Las sesiones de la plataforma pegadas en Cuadre también alimentan los paneles de sesión de la app de consumo. */
  const ponerSesiones = texto => {
    if (!paneles || sesionesCargadas.current === texto) return
    sesionesCargadas.current = texto
    setPaneles(frame.current.contentWindow.consumoEmbed.sesiones(texto))
  }

  return { montado, setMontado, paneles, error, alto, frame, alCargar, informe, ponerSesiones, listo: !!paneles }
}

/** Lleva el scroll de la vista principal al panel `id` del iframe (el iframe no tiene scroll propio: crece con su contenido). */
function irAPanel(frame, id) {
  const el = frame.contentDocument?.getElementById(id)
  if (!el) return
  const y = frame.getBoundingClientRect().top + el.getBoundingClientRect().top
  const main = frame.closest('.main')
  if (main && main.scrollHeight > main.clientHeight) main.scrollBy({ top: y - main.getBoundingClientRect().top - 56, behavior: 'smooth' })
  else window.scrollBy({ top: y - 56, behavior: 'smooth' })
}

export default function ConsumoFrame({ c, grupo, plataforma }) {
  const visible = grupo != null
  useEffect(() => {
    if (visible) c.setMontado(true)
  }, [visible])
  useEffect(() => {
    if (c.listo) c.frame.current?.contentWindow.consumoEmbed.grupo(grupo ?? null)
  }, [c.listo, grupo])
  useEffect(() => c.ponerSesiones(plataforma), [c.listo, plataforma])
  if (!c.montado) return null
  const lista = (grupo && c.paneles?.[grupo]) ?? []
  return (
    <section className="consumo" hidden={!visible}>
      <nav className="consumo-saltos">
        <span className="consumo-tit">{TITULO_GRUPO[grupo]}</span>
        {c.error ? <b className="mal">No se pudo analizar: {c.error}</b> : !c.listo ? <span className="sutil">Analizando el log…</span> : lista.length === 0 ? <span className="sutil">El log no trae datos para esta parte.</span> : null}
        {lista.map(p => (
          <button key={p.id} className="chico" onClick={() => irAPanel(c.frame.current, p.id)}>{p.titulo}</button>
        ))}
      </nav>
      <iframe ref={c.frame} className="consumo-frame" src={RUTA} onLoad={c.alCargar} style={{ height: c.listo && lista.length ? c.alto : 0 }} title="Análisis de la app de consumo" />
    </section>
  )
}
