// Libro .xlsx sin dependencias: XML de SpreadsheetML dentro de un zip sin compresión.
// hojas = [{ nombre, columnas: [{ titulo, ancho, fecha }], filas: [[valor | { v, rojo }]] }]
// Las fechas son ms "hora del log" (UTC sin zona, ver parseStamp) y se escriben como fecha de Excel.

const enc = new TextEncoder()
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const S = { titulo: 1, fecha: 2, rojo: 3 }

const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const letra = k => (k >= 26 ? letra(Math.floor(k / 26) - 1) : '') + String.fromCharCode(65 + (k % 26))
const serial = ms => Math.floor(ms / 1000) / 86_400 + 25569 // al segundo, como horaLog: Excel redondearía .807 hacia arriba

function celda(x, col, ref) {
  const rojo = x != null && typeof x === 'object'
  const v = rojo ? x.v : x
  if (v == null || v === '' || Number.isNaN(v)) return ''
  const s = rojo && x.rojo ? ` s="${S.rojo}"` : ''
  if (col.fecha) return `<c r="${ref}" s="${S.fecha}"><v>${serial(v)}</v></c>`
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(v)}</t></is></c>`
}

function hoja({ columnas, filas }) {
  const fin = `${letra(columnas.length - 1)}${filas.length + 1}`
  const titulos = columnas.map((c, k) => `<c r="${letra(k)}1" t="inlineStr" s="${S.titulo}"><is><t>${esc(c.titulo)}</t></is></c>`).join('')
  const cuerpo = filas.map((f, i) => `<row r="${i + 2}">${columnas.map((c, k) => celda(f[k], c, `${letra(k)}${i + 2}`)).join('')}</row>`).join('')
  return `${XML}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${columnas.map((c, k) => `<col min="${k + 1}" max="${k + 1}" width="${c.ancho ?? 12}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData><row r="1">${titulos}</row>${cuerpo}</sheetData><autoFilter ref="A1:${fin}"/></worksheet>`
}

const nombreHoja = s => String(s).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)

function partes(hojas) {
  const nombres = hojas.map(h => nombreHoja(h.nombre))
  const filtros = hojas.map((h, k) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${k}" hidden="1">'${nombres[k]}'!$A$1:$${letra(h.columnas.length - 1)}$${h.filas.length + 1}</definedName>`).join('')
  return {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>${nombres.map((n, k) => `<sheet name="${esc(n)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets><definedNames>${filtros}</definedNames></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, k) => `<Relationship Id="rId${k + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm:ss"/></numFmts>`
      + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFDC2626"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    ...Object.fromEntries(hojas.map((h, k) => [`xl/worksheets/sheet${k + 1}.xml`, hoja(h)])),
  }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = b => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const cab = (firma, largo) => {
  const b = new DataView(new ArrayBuffer(largo))
  b.setUint32(0, firma, true)
  return b
}

/** Zip "stored" (sin compresión): alcanza para Excel y no necesita librerías. */
function zip(archivos) {
  const locales = []
  const central = []
  let offset = 0
  for (const [nombre, texto] of Object.entries(archivos)) {
    const n = enc.encode(nombre)
    const d = enc.encode(texto)
    const crc = crc32(d)
    const l = cab(0x04034b50, 30)
    l.setUint16(4, 20, true)
    l.setUint16(8, 0, true)
    l.setUint16(12, 33, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, d.length, true)
    l.setUint32(22, d.length, true)
    l.setUint16(26, n.length, true)
    locales.push(new Uint8Array(l.buffer), n, d)
    const c = cab(0x02014b50, 46)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(14, 33, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, d.length, true)
    c.setUint32(24, d.length, true)
    c.setUint16(28, n.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), n)
    offset += 30 + n.length + d.length
  }
  const tam = central.reduce((a, b) => a + b.length, 0)
  const fin = cab(0x06054b50, 22)
  fin.setUint16(8, central.length / 2, true)
  fin.setUint16(10, central.length / 2, true)
  fin.setUint32(12, tam, true)
  fin.setUint32(16, offset, true)
  const todo = [...locales, ...central, new Uint8Array(fin.buffer)]
  const out = new Uint8Array(todo.reduce((a, b) => a + b.length, 0))
  let k = 0
  for (const b of todo) out.set(b, k), (k += b.length)
  return out
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Bytes del .xlsx con las hojas dadas. */
export const libroXlsx = hojas => zip(partes(hojas))
