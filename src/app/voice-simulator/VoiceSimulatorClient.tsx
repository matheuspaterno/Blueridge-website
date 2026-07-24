"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type ChatLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ToolLine = {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  status: "running" | "complete" | "failed";
};

const TIME_ZONE = "America/New_York";

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function etDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function etHour(iso: string) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso)));
}

function responseText(message: any): string {
  const output = Array.isArray(message?.response?.output) ? message.response.output : [];
  return output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((content: any) => content?.text || content?.transcript || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 2000);
    const onChange = () => {
      if (pc.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

export default function VoiceSimulatorClient() {
  const [status, setStatus] = useState<"disconnected" | "connecting" | "ready" | "thinking" | "error">("disconnected");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [tools, setTools] = useState<ToolLine[]>([]);
  const [draft, setDraft] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const modelRef = useRef("gpt-realtime-1.5");
  const draftRef = useRef("");
  const offeredSlotsRef = useRef<Set<string>>(new Set());
  const finalizedResponsesRef = useRef<Set<string>>(new Set());
  const currentResponseIdRef = useRef<string | undefined>(undefined);

  const addAssistantMessage = useCallback((text: string, responseId?: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (responseId && finalizedResponsesRef.current.has(responseId)) return;
    if (responseId) finalizedResponsesRef.current.add(responseId);
    setMessages((previous) => [...previous, { id: id(), role: "assistant", text: clean }]);
    draftRef.current = "";
    setDraft("");
    setStatus("ready");
  }, []);

  const runLiveTool = useCallback(async (name: string, args: any) => {
    if (name === "check_availability") {
      const requestedDate = String(args?.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
        return { ok: false, error: "A valid date in YYYY-MM-DD format is required." };
      }
      const anchor = new Date(`${requestedDate}T12:00:00.000Z`);
      if (Number.isNaN(anchor.getTime())) {
        return { ok: false, error: "The requested date is invalid." };
      }
      const durationMins = Number.isFinite(Number(args?.durationMins))
        ? Math.max(15, Math.min(120, Number(args.durationMins)))
        : 30;
      const from = new Date(anchor.getTime() - 18 * 60 * 60 * 1000);
      const to = new Date(anchor.getTime() + 18 * 60 * 60 * 1000);
      const query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        durationMins: String(durationMins),
      });
      const response = await fetch(`/api/availability?${query.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: data?.error || "Calendar availability is temporarily unavailable." };
      }
      const allSlots = (Array.isArray(data?.slots) ? data.slots : [])
        .filter((slot: unknown): slot is string => typeof slot === "string")
        .filter((slot: string) => etDate(new Date(slot)) === requestedDate)
        .map((slot: string) => new Date(slot).toISOString())
        .filter((slot: string, index: number, slots: string[]) => slots.indexOf(slot) === index)
        .slice(0, 12);
      offeredSlotsRef.current = new Set(allSlots);
      const requestedTimeOfDay = ["morning", "afternoon"].includes(args?.timeOfDay)
        ? args.timeOfDay
        : "any";
      const matchingSlots = allSlots.filter((slot: string) => {
        const hour = etHour(slot);
        if (requestedTimeOfDay === "morning") return hour >= 9 && hour < 12;
        if (requestedTimeOfDay === "afternoon") return hour >= 12 && hour < 17;
        return true;
      });
      return {
        ok: true,
        date: requestedDate,
        timeZone: TIME_ZONE,
        durationMins,
        requestedTimeOfDay,
        matchingSlots,
        allSlots,
        note: matchingSlots.length
          ? "Offer only returned matchingSlots."
          : allSlots.length
            ? "Requested period is full; offer same-day choices from allSlots."
            : "No availability on this date.",
      };
    }

    if (name === "book_appointment") {
      const start = new Date(String(args?.startISO || ""));
      if (Number.isNaN(start.getTime())) {
        return { ok: false, eventCreated: false, error: "A valid start time is required." };
      }
      const startISO = start.toISOString();
      if (!offeredSlotsRef.current.has(startISO)) {
        return {
          ok: false,
          eventCreated: false,
          error: "That time was not returned by the latest availability check.",
        };
      }
      const customerName = String(args?.name || "").trim();
      const email = String(args?.email || "").trim().toLowerCase();
      if (!customerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, eventCreated: false, error: "A valid name and email are required." };
      }
      const durationMins = Number.isFinite(Number(args?.durationMins))
        ? Math.max(15, Math.min(120, Number(args.durationMins)))
        : 30;
      const phone = String(args?.phone || "").trim();
      const notes = [String(args?.notes || "").trim(), phone ? `Phone: ${phone}` : ""]
        .filter(Boolean)
        .join("\n");
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: startISO,
          durationMins,
          name: customerName,
          email,
          phone: phone || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (data?.eventCreated) offeredSlotsRef.current.delete(startISO);
      return {
        ok: response.ok && Boolean(data?.eventCreated),
        eventCreated: Boolean(data?.eventCreated),
        confirmationEmailSent: Boolean(data?.customerEmailSent),
        startISO,
        timeZone: TIME_ZONE,
        emailErrors: data?.emailErrors,
        error: response.ok ? undefined : data?.error || "Booking failed.",
      };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  }, []);

  const handleEvent = useCallback(async (event: MessageEvent<string>) => {
    let message: any;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message?.type === "response.function_call_arguments.done") {
      const name = String(message?.name || "");
      let args: any = {};
      try {
        args = JSON.parse(message?.arguments || "{}");
      } catch {
        args = {};
      }
      const toolId = id();
      setTools((previous) => [...previous, { id: toolId, name, args, status: "running" }]);
      let result: any;
      try {
        result = await runLiveTool(name, args);
      } catch (toolError: any) {
        result = { ok: false, error: toolError?.message || "Tool execution failed." };
      }
      setTools((previous) => previous.map((tool) => tool.id === toolId
        ? { ...tool, result, status: result?.ok ? "complete" : "failed" }
        : tool));
      const channel = channelRef.current;
      if (channel?.readyState === "open") {
        channel.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: message?.call_id,
            output: JSON.stringify(result),
          },
        }));
        channel.send(JSON.stringify({
          type: "response.create",
          response: { output_modalities: ["text"] },
        }));
      }
      return;
    }

    if (message?.type === "response.created") {
      currentResponseIdRef.current = message?.response?.id;
      return;
    }

    if (message?.type === "response.output_text.delta" || message?.type === "response.text.delta") {
      const delta = String(message?.delta || "");
      draftRef.current += delta;
      setDraft(draftRef.current);
      return;
    }

    if (message?.type === "response.output_text.done" || message?.type === "response.text.done") {
      addAssistantMessage(
        String(message?.text || draftRef.current),
        message?.response_id || currentResponseIdRef.current,
      );
      return;
    }

    if (message?.type === "response.done") {
      const text = responseText(message);
      if (text) addAssistantMessage(text, message?.response?.id);
      return;
    }

    if (message?.type === "error") {
      setError(message?.error?.message || "Realtime session error.");
      setStatus("error");
    }
  }, [addAssistantMessage, runLiveTool]);

  const disconnect = useCallback(() => {
    channelRef.current?.close();
    pcRef.current?.close();
    channelRef.current = null;
    pcRef.current = null;
    offeredSlotsRef.current.clear();
    setStatus("disconnected");
  }, []);

  useEffect(() => disconnect, [disconnect]);

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "ready") return;
    setStatus("connecting");
    setError("");
    try {
      const tokenResponse = await fetch("/api/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textOnly: true,
          instructions: "This is a typed live simulation of the voice conversation. Behave exactly as Rick would on a voice call, but return text only. Never request or produce audio.",
        }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok) throw new Error(tokenData?.error || "Could not create the Realtime session.");
      const key = tokenData?.client_secret?.value || tokenData?.value;
      if (!key) throw new Error("The Realtime session did not return a client secret.");
      modelRef.current = tokenData?.model || "gpt-realtime-1.5";

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;
      // Data channel only: no microphone request, audio element, transceiver, or media track.
      const channel = pc.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onmessage = handleEvent;
      channel.onopen = () => setStatus("ready");
      channel.onerror = () => {
        setError("The text-only Realtime data channel failed.");
        setStatus("error");
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setStatus(pc.connectionState === "failed" ? "error" : "disconnected");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/sdp",
        },
        body: pc.localDescription?.sdp || "",
      });
      const answer = await sdpResponse.text();
      if (!sdpResponse.ok) throw new Error(answer || "Realtime connection failed.");
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (connectionError: any) {
      disconnect();
      setError(connectionError?.message || "Unable to start the simulator.");
      setStatus("error");
    }
  }, [disconnect, handleEvent, status]);

  const send = useCallback((text: string) => {
    const clean = text.trim();
    const channel = channelRef.current;
    if (!clean || channel?.readyState !== "open") return;
    setMessages((previous) => [...previous, { id: id(), role: "user", text: clean }]);
    draftRef.current = "";
    setDraft("");
    setInput("");
    setStatus("thinking");
    channel.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: clean }],
      },
    }));
    channel.send(JSON.stringify({
      type: "response.create",
      response: { output_modalities: ["text"] },
    }));
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
          <header className="border-b border-slate-700 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-400">Unlisted test page</p>
                <h1 className="mt-1 text-2xl font-bold">Rick Voice Agent Simulator</h1>
              </div>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300">
                Audio disabled
              </span>
            </div>
            <p className="mt-3 text-sm text-amber-200">
              Live mode: completing a booking creates a real Google Calendar event and sends real emails.
            </p>
          </header>

          <div className="h-[480px] space-y-4 overflow-y-auto p-5">
            {!messages.length && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">
                Connect, then type what a caller would say. Example: “I need an appointment tomorrow afternoon.”
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "bg-sky-600 text-white"
                    : "bg-slate-800 text-slate-100"
                }`}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                    {message.role === "user" ? "Test caller" : "Rick"}
                  </p>
                  {message.text}
                </div>
              </div>
            ))}
            {draft && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-slate-800 px-4 py-3 text-sm leading-6 text-slate-100">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">Rick</p>
                  {draft}
                </div>
              </div>
            )}
          </div>

          <footer className="border-t border-slate-700 p-5">
            {error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
            {status === "disconnected" || status === "error" ? (
              <button
                type="button"
                onClick={connect}
                className="w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-slate-950 hover:bg-sky-400"
              >
                Start text-only live session
              </button>
            ) : (
              <form onSubmit={submit} className="flex gap-3">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={status !== "ready"}
                  placeholder={status === "connecting" ? "Connecting…" : status === "thinking" ? "Rick is thinking…" : "Type the caller's next line"}
                  className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-sky-400 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={status !== "ready" || !input.trim()}
                  className="rounded-xl bg-sky-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  className="rounded-xl border border-slate-600 px-4 py-3 text-sm"
                >
                  End
                </button>
              </form>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Status: {status} · Model: {modelRef.current} · No microphone permission is requested.
            </p>
          </footer>
        </section>

        <aside className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
          <h2 className="text-lg font-bold">Live tool activity</h2>
          <p className="mt-2 text-sm text-slate-400">
            This proves whether Rick checked the calendar before offering or booking a time.
          </p>
          <div className="mt-5 space-y-4">
            {!tools.length && <p className="text-sm text-slate-500">No tools called yet.</p>}
            {tools.map((tool) => (
              <details key={tool.id} open className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  {tool.name}
                  <span className={`ml-2 text-xs ${
                    tool.status === "complete"
                      ? "text-emerald-400"
                      : tool.status === "failed"
                        ? "text-red-400"
                        : "text-amber-400"
                  }`}>
                    {tool.status}
                  </span>
                </summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-400">
                  {JSON.stringify({ arguments: tool.args, result: tool.result }, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
