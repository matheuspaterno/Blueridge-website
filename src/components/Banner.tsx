"use client";
import React from 'react'

async function startCheckout(tier: "starter" | "growth") {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier })
  });
  const data = await res.json();
  if (data?.url) window.location.href = data.url;
}

function IconCircle({ title, bg, children }: { title: string; bg: string; children: React.ReactNode }) {
  return (
    <div
      aria-label={title}
      className={`relative h-12 w-12 rounded-full flex items-center justify-center shadow-[0_0_40px_var(--glow)]`} 
      style={{
        background: bg,
        // subtle outer glow via CSS var consumed by shadow above
        // you can tweak per icon by passing gradients with matching end color
        // Fallback if no var is set
        // @ts-ignore - CSS var for shadow color used in class
        ['--glow' as any]: 'rgba(255,255,255,0.18)'
      }}
    >
      <div className="text-white/95">
        {children}
      </div>
    </div>
  )
}

export default function Banner() {
  return (
    <section className="relative w-full">
      {/* content container */}
      <div className="relative z-10 mx-auto flex max-w-6xl items-center px-0 sm:px-6 py-0">
        <div className="w-full">
          <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-6 sm:p-10 backdrop-blur-xl shadow-2xl">
            <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-stretch">
              {/* left: logo + icons */}
              <div className="relative flex w-full flex-col items-center justify-center gap-8 lg:w-1/2">
                {/* moving orbit of icons inside the glass card */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-64 w-64 animate-spin-slow">
                    <div className="absolute left-1/2 top-1/2" style={{ transform: 'translate(-50%, -50%)' }}>
                      <div className="absolute" style={{ transform: 'rotate(0deg) translateY(-110px)' }}>
                        <div style={{ ['--glow' as any]: 'rgba(214,41,118,0.35)' }}>
                          <div style={{ transform: 'rotate(0deg)' }}>
                            <div className="animate-spin-reverse">
                            <IconCircle title="Instagram" bg="radial-gradient(80% 80% at 30% 20%, #FEDA75 0%, #D62976 50%, #962FBF 75%, #4F5BD5 100%)">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="3.5" y="3.5" width="17" height="17" rx="5" ry="5" stroke="white"/>
                                <circle cx="12" cy="12" r="4" fill="white"/>
                                <circle cx="17.25" cy="6.75" r="1.25" fill="white"/>
                              </svg>
                            </IconCircle>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="absolute" style={{ transform: 'rotate(90deg) translateY(-110px)' }}>
                        <div style={{ ['--glow' as any]: 'rgba(37,211,102,0.30)' }}>
                          <div style={{ transform: 'rotate(-90deg)' }}>
                            <div className="animate-spin-reverse">
                            <IconCircle title="WhatsApp" bg="linear-gradient(135deg,#25D366 0%,#128C7E 100%)">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                <path d="M4 20l1.5-4A8 8 0 1120 12a8 8 0 01-12.5 6.5L4 20z" stroke="white" strokeWidth="1.5" fill="none"/>
                                <path d="M9.5 8.5c-.5 1.8.9 4 3.1 5.2 1.7.9 2.6.7 3.1.2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            </IconCircle>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="absolute" style={{ transform: 'rotate(180deg) translateY(-110px)' }}>
                        <div style={{ ['--glow' as any]: 'rgba(52,199,89,0.30)' }}>
                          <div style={{ transform: 'rotate(-180deg)' }}>
                            <div className="animate-spin-reverse">
                            <IconCircle title="iMessage" bg="linear-gradient(135deg,#30D158 0%,#34C759 100%)">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                                <path d="M12 4c-4.4 0-8 2.7-8 6s3.6 6 8 6c.6 0 1.2-.1 1.8-.2 1 .7 2.4 1.4 3.7 1.8-.5-.8-1-1.8-1.3-2.7 2-1.1 3.8-2.9 3.8-4.9 0-3.3-3.6-6-8-6z"/>
                              </svg>
                            </IconCircle>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="absolute" style={{ transform: 'rotate(270deg) translateY(-110px)' }}>
                        <div style={{ ['--glow' as any]: 'rgba(0,178,255,0.32)' }}>
                          <div style={{ transform: 'rotate(-270deg)' }}>
                            <div className="animate-spin-reverse">
                            <IconCircle title="Messenger" bg="linear-gradient(135deg,#00B2FF 0%,#006AFF 100%)">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                                <path d="M12 2C6.5 2 2 6 2 11.1c0 2.8 1.4 5.3 3.6 7l-.3 3.9 3.3-1.8c1 .3 2 .5 3.1.5 5.5 0 10-4.6 10-10.2C21.7 6 17.5 2 12 2zm-1.1 8.1l-3.7 3.9 4.7-2.5 1.9 2.5 3.7-3.9-4.7 2.5-1.9-2.5z"/>
                              </svg>
                            </IconCircle>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* center logo */}
                <img
                  src="/Bluerigde Logo 1.png"
                  alt="Blueridge AI Agency logo"
                  className="relative z-10 w-56 max-w-full drop-shadow-xl"
                />
              </div>

              {/* right: copy */}
              <div className="flex w-full flex-col items-center text-center lg:w-1/2 lg:items-start lg:justify-center lg:text-left">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-white/95">
                  Fully integrated across different platforms
                </h1>
                <p className="mt-3 text-base sm:text-lg text-white/80">
                  24/7 transforming leads into appointments
                </p>
                <p className="mt-5 text-sm sm:text-base font-medium text-white/90">
                  Never miss a client again!
                </p>
              </div>
            </div>

            {/* pricing section */}
            <div className="mt-8 pt-8 border-t border-white/15">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                {/* Starter */}
                <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 sm:p-6 flex flex-col">
                  <h3 className="text-white font-semibold text-lg">
                    Starter <span className="text-white/90 font-normal">— $300/month</span>
                  </h3>
                  <ul className="mt-3 space-y-2 text-white/90 text-sm leading-relaxed">
                    <li className="flex gap-2"><span>•</span><span>AI assistant that books appointments 24/7</span></li>
                    <li className="flex gap-2"><span>•</span><span>Monthly monitoring &amp; support</span></li>
                  </ul>
                  <button onClick={() => startCheckout("starter")} className="mt-auto w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
                    Get Started
                  </button>
                </div>

                {/* Growth */}
                <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 sm:p-6 flex flex-col">
                  <h3 className="text-white font-semibold text-lg">
                    Growth <span className="text-white/90 font-normal">— $600/month</span>
                  </h3>
                  <ul className="mt-3 space-y-2 text-white/90 text-sm leading-relaxed">
                    <li className="flex gap-2"><span>•</span><span>Everything in Starter</span></li>
                    <li className="flex gap-2"><span>•</span><span>Lead Generation</span></li>
                    <li className="flex gap-2"><span>•</span><span>Customer Relationship Management</span></li>
                    <li className="flex gap-2"><span>•</span><span>Follow-ups for reminders or Google reviews</span></li>
                  </ul>
                  <button onClick={() => startCheckout("growth")} className="mt-auto w-full rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
                    Choose Growth
                  </button>
                </div>

                {/* Consulting */}
                <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 sm:p-6 flex flex-col">
                  <h3 className="text-white font-semibold text-lg">
                    Consulting <span className="text-white/90 font-normal">— Contact for Pricing</span>
                  </h3>
                  <p className="mt-3 text-white/90 text-sm leading-relaxed">
                    We’ll sit down with your team, map your workflows, and design custom AI implementations that make your business more efficient, customer-friendly, and scalable
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
