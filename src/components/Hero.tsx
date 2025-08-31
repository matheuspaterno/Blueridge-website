"use client";
import React, { useRef } from 'react'
import useVantaFog from '../hooks/useVantaFog'

export default function Hero() {
  const fogRef = useRef<HTMLDivElement | null>(null)
  useVantaFog(fogRef)

  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Vanta fog layer (fixed so it doesn't move when scrolling) */}
      <div ref={fogRef as any} className="fixed inset-0 -z-10" aria-hidden />

      {/* Mountain image - fixed so transparent sky always reveals fog behind */}
      <img
        src="/website background.png"
        alt="Mountain range with transparent sky"
        className="fixed inset-0 h-full w-full object-cover z-0"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 10%, rgba(0,0,0,0.85) 30%, rgba(0,0,0,0.6) 60%, rgba(0,0,0,1) 100%)'
        }}
      />

      {/* subtle gradient overlays (fixed to viewport) */}
      <div className="fixed inset-0 bg-gradient-to-t from-black/55 via-black/35 to-transparent pointer-events-none" />
      <div className="fixed inset-0 bg-[radial-gradient(60%_40%_at_50%_20%,rgba(13,71,161,0.18),transparent)] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-12 text-center">
        <img
          src="/Bluerigde Logo 1.png"
          alt="Blueridge AI Agency logo"
          className="block mx-auto mb-[50px] w-11/12 sm:w-3/4 md:w-1/2 lg:w-auto max-w-[300px] transform origin-center scale-[0.9] sm:scale-100"
        />
        <p className="max-w-3xl mx-auto text-white/90 text-lg leading-relaxed">
          We create AI solutions that connect people and businesses more efficiently. Blueridge AI Agency blends innovation with local expertise to deliver responsible, intelligent tools that streamline operations and maximize results. </p>

  {/* Buttons removed as requested */}
      </div>
    </section>
  )
}
