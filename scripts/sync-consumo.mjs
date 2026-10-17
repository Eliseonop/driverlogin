// Trae app.js y styles.css de la app de consumo (WebstormProjects/consumo) a public/consumo/, donde driverlogin la
// embebe en sus pestañas. index.html, embed.js y embed.css son de driverlogin y no se tocan.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const origen = process.env.CONSUMO_DIR ?? 'C:/Users/Edu/WebstormProjects/consumo'
const destino = new URL('../public/consumo/', import.meta.url)
for (const f of ['app.js', 'styles.css']) {
  const de = join(origen, f)
  if (!existsSync(de)) throw new Error(`No existe ${de} (CONSUMO_DIR=${origen})`)
  copyFileSync(de, new URL(f, destino))
  console.log(`✓ ${de} → public/consumo/${f}`)
}
