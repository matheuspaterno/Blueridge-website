"use client";
import React from 'react'
import Hero from '../components/Hero'
import Banner from '../components/Banner'


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

        {/* Value proposition section between About and Demo */}
  <section aria-labelledby="value-prop-heading" className="relative z-20 -mt-4 sm:-mt-5 md:-mt-6 px-6 pt-4 sm:pt-6 pb-10 sm:pb-14">
          <div className="mx-auto max-w-4xl text-center">
            <h2 id="value-prop-heading" className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-white drop-shadow-xl">
              Stop losing money because of missed calls
            </h2>
            <p className="mt-4 text-base sm:text-lg text-white drop-shadow">
              Missed calls = missed revenue. Our AI Setters ensure every prospective customer gets a response, every time, 24/7. From first message to confirmed booking in seconds, your pipeline runs on autopilot.
            </p>
            <p className="mt-6 text-sm sm:text-base font-medium text-white inline-flex items-center gap-2 justify-center drop-shadow">
              <a href="#demo" className="hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white">Watch our demo</a>, or try it yourself
              <span aria-hidden="true" className="inline-block align-middle text-white/90">→</span>
              chat with Rick and book an appointment with us to get started!
            </p>
          </div>
        </section>

        <div className="py-20 px-6">
          <section id="demo" className="mx-auto max-w-4xl py-12">
            <DemoCard />
          </section>

          <section id="financials" className="mx-auto max-w-[96rem] py-12">
            <Banner />
          </section>
        </div>
      </main>
    </div>
  )
}

function DemoCard() {
  return (
    <div className="mx-auto text-center">
      <div className="inline-block rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-xl p-3 sm:p-4">
  <div className="mb-2 sm:mb-3 text-white/90 text-sm sm:text-base font-medium">Appointment Setter Demo</div>
        <div className="relative w-[220px] sm:w-[260px] md:w-[300px] lg:w-[340px] aspect-[9/16] overflow-hidden rounded-xl ring-1 ring-white/20 bg-black/40">
          <VideoPlayer src="/demo.mp4" />
        </div>
      </div>
    </div>
  )
}

function VideoPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const onPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={src}
        className="h-full w-full object-cover"
        playsInline
        muted
        controls={playing}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {!playing && (
        <button
          type="button"
          onClick={onPlay}
          className="absolute inset-0 grid place-items-center bg-black/35 text-white transition hover:bg-black/45"
          aria-label="Play demo video"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 ring-1 ring-white/30 backdrop-blur-md">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span className="text-sm font-medium">Play demo</span>
          </span>
        </button>
      )}
    </div>
  );
}
