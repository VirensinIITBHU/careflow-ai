import { useCallback, useEffect, useRef, useState } from 'react'

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }

export type Recording = { blob: Blob; file: File; seconds: number; peak: number }

/**
 * Microphone capture with a live level meter and a silence check. Some browsers (notably Firefox with some
 * devices) can produce silent recordings, so the peak level is measured while recording and reported.
 */
export function useRecorder() {
  const [state, setState] = useState<'idle' | 'recording' | 'stopping'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(28).fill(0))
  const [error, setError] = useState('')
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(0), peak = useRef(0), raf = useRef(0), tick = useRef<number>()
  const resolver = useRef<((r: Recording | null) => void) | null>(null)
  const cancelled = useRef(false)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current); clearInterval(tick.current)
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null
    ctx.current?.close().catch(() => {}); ctx.current = null
    setLevels(Array(28).fill(0))
  }, [])

  useEffect(() => () => { cancelled.current = true; rec.current?.state === 'recording' && rec.current.stop(); cleanup() }, [cleanup])

  const start = useCallback(async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('This browser cannot record audio. Type the answer instead.'); return false }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      stream.current = s
      const type = TYPES.find(t => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined)
      rec.current = r; chunks.current = []; peak.current = 0; cancelled.current = false
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      r.onstop = () => {
        const mime = (r.mimeType || type || 'audio/webm').split(';')[0]
        const blob = new Blob(chunks.current, { type: mime })
        const secs = (performance.now() - started.current) / 1000
        cleanup(); setState('idle')
        const out = cancelled.current || !blob.size ? null
          : { blob, seconds: secs, peak: peak.current, file: new File([blob], `answer-${Date.now()}.${EXT[mime] ?? 'webm'}`, { type: mime }) }
        resolver.current?.(out); resolver.current = null
      }
      const ac = new AudioContext(); ctx.current = ac
      const an = ac.createAnalyser(); an.fftSize = 512
      ac.createMediaStreamSource(s).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const loop = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x }
        const rms = Math.sqrt(sum / buf.length)
        peak.current = Math.max(peak.current, rms)
        setLevels(l => [...l.slice(1), Math.min(1, rms * 5)])
        raf.current = requestAnimationFrame(loop)
      }
      loop()
      r.start(250)
      started.current = performance.now(); setSeconds(0)
      tick.current = window.setInterval(() => setSeconds(Math.floor((performance.now() - started.current) / 1000)), 250)
      setState('recording')
      return true
    } catch (e) {
      cleanup()
      setError((e as Error).name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start the microphone.')
      return false
    }
  }, [cleanup])

  const stop = useCallback(() => new Promise<Recording | null>(resolve => {
    if (!rec.current || rec.current.state !== 'recording') { resolve(null); return }
    resolver.current = resolve; setState('stopping'); rec.current.stop()
  }), [])

  const cancel = useCallback(() => { cancelled.current = true; if (rec.current?.state === 'recording') rec.current.stop(); else cleanup() }, [cleanup])

  return { state, seconds, levels, error, start, stop, cancel, setError }
}
