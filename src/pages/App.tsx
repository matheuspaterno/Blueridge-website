import React from 'react'
import Hero from '../components/Hero'


export default function App() {
  return (
    <div className="min-h-screen">
      <header className="fixed top-4 left-0 right-0 z-50 flex justify-center">
        <nav className="bg-white/6 backdrop-blur rounded-full px-4 py-2 flex items-center shadow-md" aria-label="Top navigation">
          <span className="sr-only">Top navigation</span>
        </nav>
      </header>

      <main>
        <Hero />

        <div className="py-20 px-6">
          <section id="demo" className="mx-auto max-w-4xl py-12">
            <div
              className="h-[420px] rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-xl mx-auto"
              aria-label="Live demo placeholder"
            />
          </section>

          <section id="financials" className="mx-auto max-w-4xl py-12">
            <div
              className="h-[360px] rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-xl mx-auto"
              aria-label="Financials placeholder"
            />
          </section>
        </div>
      </main>
    </div>
  )
}
