"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hello! I’m Rick from Blueridge AI Agency. How can I help today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [lastSlots, setLastSlots] = useState<Array<{ start: string; end: string }> | null>(null);
  const [selectedStartISO, setSelectedStartISO] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const next = [...messages, { role: "user", content: text } as Msg];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, lastSlots: lastSlots || undefined, selectedStartISO: selectedStartISO || undefined }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json();
      const content = data?.content || "Sorry, I didn’t catch that. Could you rephrase?";
      setMessages((m) => [...m, { role: "assistant", content } as Msg]);
  if (data?.meta?.slots) setLastSlots(data.meta.slots);
      if (data?.meta?.selectedStartISO) setSelectedStartISO(data.meta.selectedStartISO);
      if (data?.ui?.type === "contact_form") {
        setShowForm(true);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Hmm, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-4 right-3 z-50 sm:bottom-6 sm:right-6">
        <button
          onClick={() => setOpen((v) => !v)}
          className="group flex w-28 flex-col items-center gap-2 rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/70 sm:w-32"
          aria-label={open ? "Close chat with Rick" : "Chat with Rick"}
          aria-expanded={open}
        >
          {!open && (
            <span className="aspect-square w-full overflow-hidden rounded-2xl border-2 border-white bg-white shadow-xl transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-2xl">
              <img
                src="/Rick.jpg"
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
                loading="eager"
              />
            </span>
          )}
          <span className="w-full whitespace-nowrap rounded-full bg-blue-600 px-2 py-2.5 text-center text-sm font-semibold text-white shadow-lg transition-colors group-hover:bg-blue-700 sm:py-3 sm:text-base">
            {open ? "Close" : "Chat with Rick"}
          </span>
        </button>
      </div>

      {open && (
        <div className="fixed bottom-20 right-3 z-40 flex h-[min(28rem,calc(100dvh-6rem))] w-[calc(100vw-1.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:bottom-24 sm:right-6">
          <div className="px-4 py-3 border-b bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <div className="flex items-center gap-3">
              <img
                src="/Rick.jpg"
                alt="Rick from Blueridge AI Agency"
                className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow"
                loading="eager"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">Rick</span>
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" aria-label="online" />
                </div>
                <div className="text-xs text-white/90 truncate">Blueridge AI Agency</div>
              </div>
            </div>
          </div>
          <div ref={boxRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={
                    "inline-block max-w-[85%] rounded-2xl px-3 py-2 " +
                    (m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800")
                  }
                >
                  {m.content}
                </span>
              </div>
            ))}
            {loading && <div className="text-xs text-gray-500">Rick is typing…</div>}
          </div>
          {showForm ? (
            <ContactForm
              onCancel={() => setShowForm(false)}
              onSubmit={async (payload: { name: string; email: string; phone?: string }) => {
                setShowForm(false);
                setLoading(true);
                try {
                  // Send contact details to server without echoing raw JSON into the transcript
                  const res = await fetch("/api/ai/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages, contact: payload, selectedStartISO: selectedStartISO || undefined }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const data = await res.json();
                  const content = data?.content || "Thanks — got your details. Which of those times should I book?";
                  setMessages((m) => [...m, { role: "assistant", content } as Msg]);
                } catch (e) {
                  setMessages((m) => [...m, { role: "assistant", content: "Hmm, something went wrong. Please try again." }]);
                } finally {
                  setLoading(false);
                }
              }}
            />
          ) : (
            <div className="p-2 border-t flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Type your message…"
                className="flex-1 border rounded-xl px-3 py-2 text-sm text-black placeholder-gray-500 focus:outline-none focus:ring"
              />
              <button
                onClick={send}
                className="rounded-xl bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ContactForm({ onSubmit, onCancel }: { onSubmit: (p: { name: string; email: string; phone?: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const valid = name.trim() && /.+@.+\..+/.test(email);
  return (
    <div className="p-3 border-t space-y-2">
      <div className="grid grid-cols-1 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="border rounded-xl px-3 py-2 text-sm text-black placeholder-gray-500 focus:outline-none focus:ring" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="border rounded-xl px-3 py-2 text-sm text-black placeholder-gray-500 focus:outline-none focus:ring" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="border rounded-xl px-3 py-2 text-sm text-black placeholder-gray-500 focus:outline-none focus:ring" />
      </div>
      {err && <div className="text-xs text-red-500">{err}</div>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="rounded-xl border px-3 py-2 text-sm">Cancel</button>
        <button
          onClick={() => {
            if (!valid) { setErr("Enter a valid name and email."); return; }
            onSubmit({ name: name.trim(), email: email.trim(), phone: phone.trim() || undefined });
          }}
          className="rounded-xl bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
