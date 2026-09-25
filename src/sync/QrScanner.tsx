import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

interface QrScannerProps {
  onResult: (text: string) => void
  onError?: (message: string) => void
}

// Live camera preview decoded with the platform BarcodeDetector when present and
// jsQR otherwise. Stops the camera when unmounted.
export function QrScanner({ onResult, onError }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'failed'>('starting')

  useEffect(() => {
    let stream: MediaStream | undefined
    let frame = 0
    let done = false

    const detector = typeof BarcodeDetector !== 'undefined' ? new BarcodeDetector({ formats: ['qr_code'] }) : undefined

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('failed')
        onError?.('Camera access is not available here. Enter the code instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        setStatus('failed')
        onError?.('Camera permission was not granted. Enter the code instead.')
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => undefined)
      setStatus('scanning')
      frame = requestAnimationFrame(tick)
    }

    async function tick() {
      if (done) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        let text: string | undefined
        if (detector) {
          try {
            const codes = await detector.detect(video)
            text = codes[0]?.rawValue
          } catch {
            // fall through to jsQR
          }
        }
        if (!text) {
          const size = 480
          const scale = Math.min(size / video.videoWidth, size / video.videoHeight, 1)
          canvas.width = Math.floor(video.videoWidth * scale)
          canvas.height = Math.floor(video.videoHeight * scale)
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (context && canvas.width > 0) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            const image = context.getImageData(0, 0, canvas.width, canvas.height)
            text = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data
          }
        }
        if (text) {
          done = true
          onResult(text)
          return
        }
      }
      frame = requestAnimationFrame(tick)
    }

    void start()
    return () => {
      done = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onResult, onError])

  return (
    <div className="qr-scanner" data-status={status}>
      <video ref={videoRef} playsInline muted aria-label="Camera preview" />
      <canvas ref={canvasRef} className="sr-only" aria-hidden="true" />
      {status === 'starting' && <span className="qr-scanner-hint">Starting camera…</span>}
      {status === 'scanning' && <span className="qr-scanner-hint">Point at the QR code</span>}
    </div>
  )
}
