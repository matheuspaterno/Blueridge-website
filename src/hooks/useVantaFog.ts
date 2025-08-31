import { useEffect } from 'react'

export default function useVantaFog(ref: React.RefObject<HTMLElement> | null) {
  useEffect(() => {
    if (!ref || !ref.current) return

    let effect: any = null
    let vanta: any = null
    let cancelled = false

    const init = async () => {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReduced) return

      const mod = await import('vanta/dist/vanta.fog.min')
      const THREE = (await import('three')) as any

      if (cancelled) return

      vanta = (mod as any).default?.({
        el: ref.current,
        THREE,
        highlightColor: 0x595c7a,
        midtoneColor: 0xe0ebe8,
        lowlightColor: 0x53505f,
        baseColor: 0x585b78,
        blurFactor: 0.35,
        zoom: 1.9,
        mouseControls: true,
        touchControls: true,
        minHeight: 200.0,
        minWidth: 200.0,
        speed: 1.2,
        density: 1.0,
      })
    }

    init()

    return () => {
      cancelled = true
      try {
        if (vanta && vanta.destroy) vanta.destroy()
      } catch (e) {
        /* ignore */
      }
    }
  }, [ref])
}
