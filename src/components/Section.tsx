import React from 'react'

type Props = {
  id: string
  title: string
  children: React.ReactNode
}

export default function Section({ id, title, children }: Props) {
  return (
    <section id={id} className="mx-auto max-w-4xl py-12">
      <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 shadow-xl p-8">
        <h2 className="text-2xl font-bold text-white/95">{title}</h2>
        <div className="mt-6 text-white/85">{children}</div>
      </div>
    </section>
  )
}
