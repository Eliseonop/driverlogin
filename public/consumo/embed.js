// Modo embebido (?embed): driverlogin pasa el texto del log y elige qué grupo de paneles mostrar en cada pestaña.
// Usa las funciones globales de app.js (analizarTextos, pintar, construirNav, informeHtml) sin tocar ese archivo.
;(() => {
  if (!new URLSearchParams(location.search).has('embed')) return
  document.documentElement.classList.add('embed')

  // Panel → pestaña por su título. Un panel sin título va con el anterior (la tabla de "por tipo de mensaje").
  const GRUPOS = [
    ['sesiones', /Bucles de re-login|Solicitó vs Recibió|Cierre y autoretorno|Liquidación sesión|Boletos por sesión|\(objeto\)/],
    ['ventas', /Boletos vendidos|Impresión por toque|Intentos de impresión|Vendidos sin imprimir|Diagnóstico de la impresora|Errores de impresión|[Dd]uplicados|Envío de boletos/],
    ['consumo', /Versión del APK|Reinicios|Consumo/],
  ]
  let activo = null

  const titulo = el => (el.querySelector('h2')?.textContent ?? '').replace(/\s*\(\d+\).*$/s, '').trim()

  function clasificar() {
    let prev = 'consumo'
    for (const el of document.getElementById('report').children) {
      const t = titulo(el)
      let g = prev
      if (t) {
        g = GRUPOS.find(([, re]) => re.test(t))?.[0]
        if (!g) {
          console.warn('[embed] panel sin pestaña, va a Consumo:', t)
          g = 'consumo'
        }
      }
      el.dataset.grupo = g
      prev = g
    }
    mostrar()
  }

  function mostrar() {
    for (const el of document.getElementById('report').children) el.hidden = activo != null && el.dataset.grupo !== activo
    avisar()
  }

  function paneles() {
    const out = { sesiones: [], ventas: [], consumo: [] }
    for (const el of document.querySelectorAll('#report > [data-grupo]')) if (el.id && titulo(el)) out[el.dataset.grupo]?.push({ id: el.id, titulo: titulo(el) })
    return out
  }

  const avisar = () => parent.postMessage({ consumoAlto: document.documentElement.scrollHeight }, location.origin)

  // render() de app.js termina siempre en construirNav(): ahí se reclasifica después de cada repintado.
  const nav = window.construirNav
  window.construirNav = () => {
    nav()
    clasificar()
  }

  window.consumoEmbed = {
    cargar(texto, nombre, sesiones = '') {
      analizarTextos([texto])
      _files = nombre
      document.getElementById('sesiones').value = sesiones
      pintar()
      return paneles()
    },
    /** Sesiones de la plataforma (JSON o filas): las mismas que acepta el cuadro "Comparar" de la app. */
    sesiones(texto) {
      document.getElementById('sesiones').value = texto
      pintar()
      return paneles()
    },
    grupo(g) {
      activo = g
      mostrar()
    },
    paneles,
  }
  new ResizeObserver(avisar).observe(document.body)
})()
