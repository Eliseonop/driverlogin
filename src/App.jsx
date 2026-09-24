import { useState } from 'react'
import Simulador from './ui/Simulador.jsx'
import Escenarios from './ui/Escenarios.jsx'
import Diagnostico from './ui/Diagnostico.jsx'
import Docs from './ui/Docs.jsx'
import { useSim } from './ui/useSim.js'
import { configPorDefecto } from './engine/world.js'

const TABS = [
  ['sim', 'Simulador'],
  ['esc', 'Escenarios'],
  ['diag', 'Diagnóstico de logs'],
  ['docs', 'Cómo funciona'],
]

const tabGuardada = () => {
  try {
    return localStorage.getItem('driverlogin.tab') ?? 'sim'
  } catch {
    return 'sim'
  }
}

export default function App() {
  const [tab, setTabState] = useState(tabGuardada)
  const sim = useSim(configPorDefecto())
  const setTab = t => {
    setTabState(t)
    try {
      localStorage.setItem('driverlogin.tab', t)
    } catch {
      /* sin almacenamiento */
    }
  }
  const abrirEnSimulador = w => {
    sim.cargar(w)
    setTab('sim')
  }

  return (
    <div className="app">
      <div className="barra">
        <h1>
          🚌 DriverLogin Lab <span>· sesión del chofer TCONTUR</span>
        </h1>
        <div className="tabs">
          {TABS.map(([k, t]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="contenido">
        {tab === 'sim' && <Simulador sim={sim} />}
        {tab === 'esc' && <Escenarios abrirEnSimulador={abrirEnSimulador} />}
        {tab === 'diag' && <Diagnostico abrirEnSimulador={abrirEnSimulador} />}
        {tab === 'docs' && <Docs />}
      </div>
    </div>
  )
}
