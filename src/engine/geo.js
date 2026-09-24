// Distancias iguales a LocationValidator.calcularDistancia (haversine, R = 6371e3).

const R = 6371e3
const rad = d => (d * Math.PI) / 180

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export const distA = (loc, p) => haversine(loc.lat, loc.lng, p.latitud, p.longitud)

/** Punto desplazado `norte`/`este` metros. */
export function offset(lat, lng, norte, este) {
  return {
    lat: lat + (norte / R) * (180 / Math.PI),
    lng: lng + (este / (R * Math.cos(rad(lat)))) * (180 / Math.PI),
  }
}

/** Puntos cada `paso` metros entre a y b (sin incluir a, incluyendo b). */
export function tramo(a, b, paso = 40) {
  const d = haversine(a.lat, a.lng, b.lat, b.lng)
  const n = Math.max(1, Math.ceil(d / paso))
  const out = []
  for (let i = 1; i <= n; i++) {
    const f = i / n
    out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f })
  }
  return out
}
