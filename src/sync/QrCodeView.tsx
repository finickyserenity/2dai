import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Renders a QR code as inline SVG. Text is whatever the other device will scan.
export function QrCodeView({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let cancelled = false
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((markup) => { if (!cancelled) setSvg(markup) })
      .catch(() => { if (!cancelled) setSvg('') })
    return () => { cancelled = true }
  }, [text])
  if (!svg) return <div className="qr-code qr-code-empty" aria-label={label} />
  return <div className="qr-code" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
}
