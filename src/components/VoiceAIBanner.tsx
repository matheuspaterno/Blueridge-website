"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image"; // retained for possible future assets
import { BlueRidgeVoiceAura } from "./BlueRidgeVoiceAura";

/**
 * VoiceAIBanner
 *
 * README / Developer Notes:
 * This component implements a push‑to‑talk WebRTC session with the OpenAI Realtime API.
 * It fetches an ephemeral session token from /api/realtime (server route) and then creates
 * a peer connection that streams microphone audio to the model and receives synthesized
 * voice responses. Transcripts are collected via an RTCDataChannel ("oai-events").
 *
 * Required server env:
 *  - OPENAI_API_KEY (never exposed client-side)
 * Optional public env overrides (else defaults applied server-side):
 *  - NEXT_PUBLIC_OPENAI_REALTIME_MODEL (e.g. gpt-4o-realtime-preview)
 *  - NEXT_PUBLIC_OPENAI_VOICE (e.g. verse)
 *
 * Local testing:
 * 1. Ensure OPENAI_API_KEY is set in .env.local.
 * 2. Start dev server.
 * 3. Open the site over http(s) and allow microphone permissions.
 * 4. Click the big voice button to start listening; click again (or Stop) to end your turn.
 *
 * Accessibility:
 *  - Button has aria-label and supports Space (hold) and Enter (toggle hold) semantics.
 *  - Status text is mirrored to an aria-live region.
 *
 * Security:
 *  - Ephemeral session JSON returned by /api/realtime is short-lived.
 *  - Primary OPENAI_API_KEY never sent to browser.
 */

// ---- Types ----
export type TranscriptRole = "user" | "assistant";
export interface TranscriptLine {
  role: TranscriptRole;
  text: string;
  ts: number; // epoch ms
}

type ConnState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "muted"
  | "error";

// Helper to format transcript lines (unit tested)
export function formatTranscriptLine(l: TranscriptLine): string {
  const who = l.role === "user" ? "You" : "Rick";
  return `${who}: ${l.text}`;
}

interface EphemeralSessionResp {
  id?: string;
  client_secret?: { value?: string; expires_at?: number };
  [k: string]: any; // tolerate upstream structure differences
}

interface BannerProps {
  instructionsOverride?: string;
}

export const VoiceAIBanner: React.FC<BannerProps> = ({ instructionsOverride }) => {
  // Defer RTC capability detection until after mount to prevent SSR/client HTML mismatch
  const [supportRTC, setSupportRTC] = useState<boolean | null>(null);
  const [connState, setConnState] = useState<ConnState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  // Conversational slot capture state (Rick-like flow)
  const [introDone, setIntroDone] = useState(false);
  const [pendingDateConfirm, setPendingDateConfirm] = useState<string | null>(null); // (legacy) no longer used for yes/no flow
  const [confirmedDate, setConfirmedDate] = useState<Date | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Track when email last updated (watchdog assistance)
  const lastEmailSetRef = useRef<number>(0);
  // Email confirmation flow removed: we now ask user to spell email first time and accept directly.
  const [pendingEmailCandidate, setPendingEmailCandidate] = useState<string | null>(null); // retained for backward compatibility but unused
  const [awaitingEmailConfirmation, setAwaitingEmailConfirmation] = useState<boolean>(false); // always false in new flow
  const [userPhone, setUserPhone] = useState<string | null>(null);
  const [waitingForPhone, setWaitingForPhone] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  // Spelled email buffering (captures letters across multiple utterances until full domain provided)
  const spelledLocalRef = useRef<string>('');
  const spellingActiveRef = useRef<boolean>(true); // active until we capture a solid email
  const spellingLastUpdateRef = useRef<number>(0);
  const domainRootRef = useRef<string>('');
  const [spellingProgress, setSpellingProgress] = useState<string>('');
  const domainPromptedRef = useRef<number>(0); // last time we asked for domain
  const spelledLettersRef = useRef<string[]>([]); // chronological individual letters collected for local part

  // Local speech recognition fallback (Web Speech API) to extract user utterances when realtime events not yet parsed.
  const recognitionRef = useRef<any>(null);
  const [speechFallbackActive, setSpeechFallbackActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChanRef = useRef<RTCDataChannel | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Orb visualization reactive sources
  const [activeMicStream, setActiveMicStream] = useState<MediaStream | null>(null);
  const [ttsAudioEl, setTtsAudioEl] = useState<HTMLAudioElement | null>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const holdActiveRef = useRef(false); // legacy ref no longer used for UI semantics
  const sessionKeyRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  const listeningRef = useRef(false); // true while mic streaming
  const negotiatedRef = useRef(false); // tracks if SDP negotiation done
  const sessionModelRef = useRef<string | undefined>(undefined);

  // Derived status text for UI pill
  const statusText = (() => {
    if (error) return "Error";
    switch (connState) {
      case "disconnected": return "Ready";
      case "connecting": return "Connecting";
      case "connected": return isMuted ? "Muted" : "Ready";
      case "listening": return "Listening";
      case "thinking": return "Thinking";
      case "muted": return "Muted";
      default: return connState;
    }
  })();

  const pushTranscript = useCallback((line: TranscriptLine) => {
    setTranscript(prev => {
      const next = [...prev, line];
      // keep only last ~50 internal; we show last 3 lines in UI
      return next.slice(-50);
    });
    // After adding a user transcript line, attempt scripted flow
    if (line.role === 'user') {
      scriptedFlowRef.current?.(line.text);
    }
  }, []);

  // Scripted flow logic encapsulated in a ref to avoid re-register churn
  const scriptedFlowRef = useRef<((latestUser: string) => void) | null>(null);

  // Utility: parse weekday in user utterance
  function extractWeekday(text: string): string | null {
    const wd = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const lower = text.toLowerCase();
    return wd.find(d => new RegExp(`\\b${d}\\b`).test(lower)) || null;
  }
  // Utility: robust name extraction (prioritize explicit patterns, skip fillers like Yes/Yeah)
  function extractName(text: string): string | null {
    const explicit = text.match(/(?:my name is|my name's|i am|i'm)\s+([A-Z][a-z]{1,20})/i);
    if (explicit) return capitalize(explicit[1]);
    // Fallback: first capitalized word not in fillers list
    const fillers = new Set(['Yes','Yeah','Sure','Okay','Ok','Well','No','Hey']);
    const m = text.match(/\b([A-Z][a-z]{1,20})\b/);
    if (m && !fillers.has(m[1])) return m[1];
    return null;
  }
  function capitalize(s: string){ return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(); }
  // Utility: email extraction including "name at domain dot com" variants.
  function extractEmail(raw: string): string | null {
    let original = raw.trim();
    // Preserve a copy for reconstruction heuristics
    let text = original;
    // Normalize spoken separators first (but keep original for fallback)
    text = text.replace(/\s+at\s+/gi,'@').replace(/\s+dot\s+/gi,'.');
    // Remove stray spaces around @ and .
    text = text.replace(/\s*@\s*/g,'@').replace(/\s*\.\s*/g,'.');
    // Quick attempt
    let match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    let candidate = match ? match[0].toLowerCase() : '';
    // If we got a suspiciously short local part (<=2) but the raw input appeared to be spelled, attempt reconstruction
    const suspicious = candidate && candidate.split('@')[0].length <= 2;
    const looksSpelled = /(\b[a-zA-Z]\b\s+){3,}.+\bat\b/i.test(original);
    if ((!candidate || suspicious) && looksSpelled) {
      // Reconstruct: split by ' at ' (first occurrence)
      const lower = original.toLowerCase();
      const atSplit = lower.split(/\bat\b/);
      if (atSplit.length >= 2) {
        const beforeAtRaw = original.slice(0, lower.indexOf(' at '));
        const afterAtRaw = original.slice(lower.indexOf(' at ') + 4); // skip ' at '
        // Build local part from tokens before ' at '
        const tok = beforeAtRaw.trim().split(/\s+/).filter(Boolean);
        const symbolMap: Record<string,string> = { dash:'-', underscore:'_', plus:'+', dot:'.', period:'.' };
        let local = '';
        for (const t of tok) {
          if (/^[a-zA-Z0-9]$/.test(t)) { local += t.toLowerCase(); continue; }
          const lm = t.toLowerCase();
            if (symbolMap[lm]) { local += symbolMap[lm]; continue; }
          // If token length >1 and still purely alnum, append directly (handles concatenated tail like 'paterno')
          if (/^[a-zA-Z0-9]+$/.test(t) && t.length > 1) { local += t.toLowerCase(); continue; }
        }
        // Domain reconstruction: take afterAtRaw tokens until punctuation end
        let domainSrc = afterAtRaw.trim();
        // Replace spoken dots
        domainSrc = domainSrc.replace(/\s+dot\s+/gi,'.');
        // Cut off trailing sentence fragments (e.g., 'please', 'thanks')
        domainSrc = domainSrc.split(/\s+(?:please|thanks|thank|confirm|and)\b/i)[0];
        // Grab first plausible domain pattern (words + dots) until space with non-domain char
        const domainMatch = domainSrc.match(/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/);
        if (local && domainMatch) {
          candidate = `${local}@${domainMatch[1].toLowerCase()}`;
        }
      }
    }
    if (!candidate) return null;
    candidate = sanitizeEmail(candidate);
    return candidate;
  }

  // Decide if newEmail should replace existingEmail (quality heuristic)
  function isBetterEmail(newEmail: string, existingEmail: string | null): boolean {
    if (!existingEmail) return true;
    if (newEmail === existingEmail) return false;
    const [nLocal] = newEmail.split('@');
    const [eLocal] = existingEmail.split('@');
    // Prefer longer local part (likely more complete)
    if (nLocal.length > eLocal.length) return true;
    // If same length but new has fewer non-alnum artifacts
    const nonAlnum = (s: string) => (s.match(/[^a-z0-9]/gi) || []).length;
    if (nLocal.length === eLocal.length && nonAlnum(nLocal) < nonAlnum(eLocal)) return true;
    // If existing looked truncated (<=2 chars)
    if (eLocal.length <= 2 && nLocal.length > eLocal.length) return true;
    return false;
  }

  // Heuristic cleanup of narrative pollution in local part
  function refineEmailCandidate(candidate: string, userNameCandidate?: string | null): string {
    if (!candidate || !candidate.includes('@')) return candidate;
    const [localRaw, domain] = candidate.split('@');
    let local = localRaw.toLowerCase();
    const original = local;
    const prefixPatterns = [
      'yesmynameis','yesmyemailis','yesmyemail','yesmy','mynameis','myemailis','emailis','nameis','emailaddressis','thisis','its'
    ];
    const simpleLeads = ['yes','okay','ok'];
    let changed = false;
    let guard = 0;
    while (guard < 8) {
      guard++;
      const before = local;
      for (const p of prefixPatterns) {
        if (local.startsWith(p)) { local = local.slice(p.length); changed = true; }
      }
      for (const s of simpleLeads) {
        if (local.startsWith(s)) { local = local.slice(s.length); changed = true; }
      }
      local = local.replace(/^(my|name|email)+/, () => { changed = true; return ''; });
      if (before === local) break;
    }
    // Remove embedded filler sequences repeatedly
    local = local.replace(/(mynameis|nameis|emailis|myemailis)/g, () => { changed = true; return ''; });
    // Deduplicate repeated username occurrences keeping the last
    if (userNameCandidate) {
      const uname = userNameCandidate.toLowerCase();
      const idx = local.lastIndexOf(uname);
      if (idx > 0) {
        // if earlier part mostly filler (length difference > uname length) drop it
        const tail = local.slice(idx);
        if (tail.length >= uname.length) { local = tail; changed = true; }
      }
    }
    // Leading repetition pattern e.g. mamatheus -> matheus
    local = local.replace(/^([a-z0-9]{2,3})\1+/, (_, grp) => { changed = true; return grp; });
    // Remove internal 'the' segments that commonly appear from ASR hallucination when not deliberate
    const withoutThe = local.replace(/the(?=[a-z]{3,})/g,'');
    if (withoutThe !== local) { local = withoutThe; changed = true; }
    // Trim leading non-alnum
    local = local.replace(/^[^a-z0-9._+-]+/,'');
    if (!local) local = original; // safety fallback
    if (changed && local !== original) {
      const cleaned = `${local}@${domain}`;
      pushDebug(`Refined email local '${original}' -> '${local}' => ${cleaned}`);
      return cleaned;
    }
    return candidate;
  }

  async function aiRefineEmail(candidate: string, nameHint?: string | null): Promise<string> {
    try {
      const res = await fetch('/api/tools/refine-email', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ raw: candidate, name: nameHint||undefined, letters: spelledLettersRef.current }) });
      if (!res.ok) return candidate;
      const j = await res.json();
      if (j?.email && j.email !== candidate) {
        pushDebug('AI refined email '+candidate+' -> '+j.email);
        return j.email;
      }
      return candidate;
    } catch (e:any) {
      pushDebug('aiRefineEmail error: '+(e?.message||e));
      return candidate;
    }
  }

  // Unconditional AI refinement pass (debounced by ref) to remove remaining narrative glue or duplication
  const lastAIRefinedEmailRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userEmail) return;
    if (userEmail === lastAIRefinedEmailRef.current) return; // already refined
    // Kick off refinement
    const current = userEmail;
    aiRefineEmail(current, userName).then(refined => {
      if (!refined) return;
      lastAIRefinedEmailRef.current = refined;
      if (refined !== current) {
        pushDebug('AI (post-effect) refined email '+current+' -> '+refined);
        setUserEmail(refined);
      } else {
        pushDebug('AI (post-effect) left email unchanged');
      }
    });
  }, [userEmail, userName]);

  // Attempt to reconstruct a spelled email across utterances; returns email or null
  function processSpelledEmailUtterance(raw: string): string | null {
    if (!spellingActiveRef.current) return null;
    let text = raw.toLowerCase();
    // Early exit if obviously contains a standard email; let extractEmail handle then.
    if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text) && !/(?:\b[a-z]\b\s+){3,}/.test(text)) return null;
    // Tokenize
    text = text.replace(/[,;:]/g,' ');
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    let beforeAt: string[] = [];
    let domainTokens: string[] = [];
    let phase: 'local' | 'domain' = 'local';
    const symbolMap: Record<string,string> = { dash:'-', hyphen:'-', underscore:'_', plus:'+', dot:'.', period:'.' };
    const fillerStop = new Set(['please','thanks','thank','confirm','and','skip']);
    const fillerDrop = new Set(['okay','ok','my','name','is','email','mail','address','the','its','it','this','hi','hello']);
    for (let idx=0; idx<tokens.length; idx++) {
      const rawTok = tokens[idx];
      const t = rawTok.trim().toLowerCase();
      if (!t) continue;
      if (fillerStop.has(t)) break; // stop processing further tokens
      if (fillerDrop.has(t)) continue; // ignore filler words entirely
      if (t === 'at') { phase = 'domain'; continue; }
      if (phase === 'local') {
        if (symbolMap[t]) { beforeAt.push(symbolMap[t]); continue; }
        if (/^[a-z0-9]$/.test(t)) { beforeAt.push(t); continue; }
        if (/^[a-z0-9]+$/.test(t) && t.length > 1) {
          const hasAtAhead = tokens.slice(idx+1).includes('at');
            if (beforeAt.length === 0 && spelledLocalRef.current.length === 0 && !hasAtAhead) {
              // treat as narrative word, drop it
              continue;
            }
            if (spelledLocalRef.current.length > 0 || beforeAt.length > 0) {
              // split into individual chars
              for (const ch of t.split('')) beforeAt.push(ch);
              continue;
            }
            beforeAt.push(t);
            continue;
        }
      } else { // domain phase
        if (symbolMap[t] === '.') { domainTokens.push('.'); continue; }
        if (t === 'dot') { domainTokens.push('.'); continue; }
        if (/^[a-z0-9-]+$/.test(t)) { domainTokens.push(t); continue; }
      }
    }
    if (beforeAt.length) {
      const combinedNew = beforeAt.join('').replace(/\.+/g,'.');
      if (combinedNew.length > spelledLocalRef.current.length) {
        spelledLocalRef.current = combinedNew;
        spellingLastUpdateRef.current = Date.now();
        // Append newly discovered letters to letter timeline (only single alphanumerics)
        for (const ch of beforeAt) {
          if (/^[a-z0-9]$/i.test(ch)) spelledLettersRef.current.push(ch.toLowerCase());
        }
      } else if (combinedNew.length === 1 && spelledLocalRef.current.length >= 2) {
        // Single-letter continuation after long token earlier
        if (!spelledLocalRef.current.endsWith(combinedNew)) {
          spelledLocalRef.current += combinedNew;
          spellingLastUpdateRef.current = Date.now();
          if (/^[a-z0-9]$/i.test(combinedNew)) spelledLettersRef.current.push(combinedNew.toLowerCase());
        }
      }
    }
    // Build domain string from tokens; collapse consecutive '.'
    let domainStr = '';
    if (domainTokens.length) {
      const parts: string[] = [];
      let current = '';
      for (const dt of domainTokens) {
        if (dt === '.') {
          if (current) { parts.push(current); current=''; }
          continue;
        }
        current += dt;
      }
      if (current) parts.push(current);
      if (parts.length) domainStr = parts.join('.');
      if (!domainRootRef.current && parts.length) domainRootRef.current = parts[0];
    }
    // Completion criteria
    const knownRoots = ['gmail','outlook','yahoo','icloud','proton','hotmail','live'];
    // Domain inference if user omits a dot but says 'gmail com'
    if (!domainStr && phase === 'domain' && domainTokens.length >=2) {
      // Attempt to insert dots between tokens where last token length 2-4 (tld)
      const tl = domainTokens[domainTokens.length-1];
      if (/^[a-z]{2,6}$/.test(tl)) {
        const root = domainTokens.slice(0, -1).join('');
        domainStr = `${root}.${tl}`;
        if (!domainRootRef.current) domainRootRef.current = root;
      }
    }
    // Heuristic: if only root spoken (gmail) and we already have many letters in local part, assume .com
    if (!domainStr && domainTokens.length === 1) {
      const root = domainTokens[0];
      if (knownRoots.includes(root)) {
        domainStr = `${root}.com`;
        if (!domainRootRef.current) domainRootRef.current = root;
      }
    }
    if (spelledLocalRef.current.length >= 3 && /\.[a-z]{2,6}$/i.test(domainStr) && domainStr.includes('.')) {
      let localPrimary = spelledLocalRef.current;
      // Build alternative from letters timeline (may be longer if multi-char tokens split inconsistently)
      if (spelledLettersRef.current.length >= 3) {
        const letterJoin = spelledLettersRef.current.join('');
        if (letterJoin.length > localPrimary.length && letterJoin.startsWith(localPrimary)) {
          pushDebug(`Letters timeline produced longer local '${letterJoin}' over '${localPrimary}'`);
          localPrimary = letterJoin;
        }
      }
      const email = `${localPrimary}@${domainStr}`.toLowerCase();
      spellingActiveRef.current = false; // finalize
      pushDebug(`Spelled email finalized (localLen=${spelledLocalRef.current.length} domain='${domainStr}') -> ${email}`);
      return sanitizeEmail(email);
    }
    // Update visible progress after domainStr known
    if (spellingActiveRef.current) setSpellingProgress(spelledLocalRef.current + (domainStr ? '@'+domainStr : ''));
    pushDebug(`Spelling progress: local='${spelledLocalRef.current}' len=${spelledLocalRef.current.length} domain='${domainStr||''}' tokensLocal=${beforeAt.length} tokensDomain=${domainTokens.length}`);
    // Timeout: if we collected many letters but no domain yet, keep waiting
    return null;
  }

  // Inactivity-based finalization: if user stopped speaking for 1.5s after giving a plausible root
  useEffect(() => {
    const id = setInterval(() => {
      if (!spellingActiveRef.current) return;
      if (userEmail) return; // already set
      if (!waitingForPhone) return;
      const now = Date.now();
      const idleMs = now - spellingLastUpdateRef.current;
      if (spelledLocalRef.current.length >= 5 && idleMs > 1500) {
        // If we have a domain root guess but no TLD, assume .com
        let domain = '';
        if (domainRootRef.current) domain = domainRootRef.current + '.com';
        if (!domainRootRef.current && Date.now() - domainPromptedRef.current > 4000) {
          // Prompt user for domain
          pushTranscript({ role:'assistant', text:'Got the local part. What comes after the at sign? (e.g. gmail dot com)', ts: Date.now() });
          domainPromptedRef.current = Date.now();
        }
        if (domain) {
          let localPrimary = spelledLocalRef.current;
          if (spelledLettersRef.current.length >= 3) {
            const letterJoin = spelledLettersRef.current.join('');
            if (letterJoin.length > localPrimary.length && letterJoin.startsWith(localPrimary)) {
              pushDebug(`(idle) Letters timeline produced longer local '${letterJoin}' over '${localPrimary}'`);
              localPrimary = letterJoin;
            }
          }
          let email = `${localPrimary}@${domain}`.toLowerCase();
          const refinedIdle = refineEmailCandidate(email, userName);
          if (refinedIdle !== email) pushDebug('Refined (idle) email '+email+' -> '+refinedIdle);
          email = refinedIdle;
          setUserEmail(email);
          if (/^(yes|ok|okay|mynameis|myemailis|yesmy)/i.test(email.split('@')[0])) {
            pendingAIRefineRef.current = aiRefineEmail(email, userName).then(e2 => { if (e2 !== email) setUserEmail(e2); });
          }
          spellingActiveRef.current = false;
          pushDebug('Inactivity finalized email: '+email);
          setSpellingProgress(email);
        }
      }
    }, 400);
    return () => clearInterval(id);
  }, [userEmail, waitingForPhone]);
  // Remove obvious hallucinated or trailing artifacts (e.g. '.phone', '.email') that the model sometimes appends
  function sanitizeEmail(e: string): string {
    // Strip trailing punctuation not valid in final position
    e = e.replace(/[;,]+$/,'');
    // Common spurious suffix words occasionally fused as a fake TLD
    e = e.replace(/\.(?:phone|number|email|thanks|please)$/i,'');
    // If domain has more than 3 dots and final segment length > 6, drop last segment (likely hallucination)
    const parts = e.split('@');
    if (parts.length === 2) {
      const [local, domain] = parts;
      const segs = domain.split('.');
      if (segs.length > 3) {
        const last = segs[segs.length-1];
        if (last.length > 6) {
          segs.pop();
        }
      }
      e = `${local}@${segs.join('.')}`;
    }
    return e;
  }
  function extractPhone(raw: string): string | null {
    // Collect digits; ignore sequences that look like a time (e.g., 9:00)
    const digits = raw.replace(/[^0-9]/g,'');
    if (digits.length >= 10 && digits.length <= 15) return digits; // basic heuristic
    return null;
  }
  function nextOccurrence(weekday: string): Date {
    const map: Record<string, number> = { sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6 };
    const target = map[weekday];
    const now = new Date();
    const current = now.getDay();
    let delta = (target - current + 7) % 7;
    // Previously we forced delta=7 when the weekday was today, which pushed to the following week.
    // User expectation: saying "next Monday" (or just "Monday") while it's Saturday should give the upcoming Monday (delta=2),
    // and saying it ON Monday should default to today, not a week later.
    // If a future behavior distinction is needed (e.g., differentiate "this" vs "next"), we can reintroduce conditional logic.
    const dt = new Date(now.getTime() + delta*86400000);
    // Normalize to midday ET for stability
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 16,0,0));
  }
  function fmtPretty(d: Date) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday:'long', month:'long', day:'numeric'}).format(d);
  }
  function spellEmail(e: string): string {
    const parts = e.split('@');
    if (parts.length !== 2) return e;
    const local = parts[0].split('').map(c => c.toLowerCase()==='@' ? 'at' : c).map(c => {
      if (/[a-zA-Z]/.test(c)) return c.toLowerCase();
      if (/[0-9]/.test(c)) return c;
      if (c === '.') return 'dot';
      if (c === '_') return 'underscore';
      if (c === '-') return 'dash';
      if (c === '+') return 'plus';
      return c;
    }).join(' ');
    const domain = parts[1].split('.').map(seg => seg.toLowerCase()).join(' dot ');
    return `${local} at ${domain}`;
  }

  // Chunked spelling fallback: some realtime voices truncate long single responses. We can emit smaller sequential responses.
  function sendChunkedSpelling(fullEmail: string, spelled: string) {
    const dc = dataChanRef.current;
    if (!dc || dc.readyState !== 'open') return sendAssistantSpeech(`I heard ${fullEmail}. That's ${spelled}. Please say yes to confirm or say your email again if that was wrong.`);
    // Break spelled phrase into manageable chunks (<= 25 chars)
    const baseIntro = `I heard ${fullEmail}.`;
    const confirmTail = `Please say yes to confirm or say your email again if that was wrong.`;
    const chunks: string[] = [];
    const parts = spelled.split(/\s+/);
    let buf: string[] = [];
    for (const p of parts) {
      if ((buf.join(' ').length + p.length + 1) > 25) { chunks.push(buf.join(' ')); buf = [p]; } else { buf.push(p); }
    }
    if (buf.length) chunks.push(buf.join(' '));
    // Send intro
    dc.send(JSON.stringify({ type:'response.create', response:{ modalities:['audio','text'], instructions: baseIntro } }));
    // Send each chunk prefixed with guidance to speak verbatim (short)
    chunks.forEach((ck, i) => {
      setTimeout(() => {
        try { dc.send(JSON.stringify({ type:'response.create', response:{ modalities:['audio','text'], instructions: ck } })); } catch {}
      }, 400 * (i+1));
    });
    // Final confirmation tail
    setTimeout(() => {
      try { dc.send(JSON.stringify({ type:'response.create', response:{ modalities:['audio','text'], instructions: confirmTail } })); } catch {}
    }, 400 * (chunks.length + 2));
    // Mirror in transcript (aggregate sentence)
    pushTranscript({ role:'assistant', text: `${baseIntro} That's ${spelled}. ${confirmTail}`, ts: Date.now() });
  }

  function sendAssistantSpeech(text: string) {
    pushTranscript({ role:'assistant', text, ts: Date.now() });
    try {
      const dc = dataChanRef.current;
      if (!dc || dc.readyState !== 'open') return;
      // Use content array with modalities hint for better reliability in spoken output
      const enforced = `Speak exactly (verbatim) with clear pacing: ${text}`;
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['audio','text'],
          instructions: enforced
        }
      }));
    } catch (e:any) {
      pushDebug('sendAssistantSpeech error: '+ (e?.message||e));
    }
  }

  // proposeEmail no longer used; kept as noop if accidentally called
  const lastProposedEmailRef = useRef<{ email: string; ts: number } | null>(null);
  const pendingAIRefineRef = useRef<Promise<void> | null>(null);
  function proposeEmail(_email: string, _origin: string) { pushDebug('proposeEmail noop under new direct-spell flow'); }
  async function attemptBooking() {
    // Defer booking if phone step still active so user can supply phone
    if (!confirmedDate || !userName || !userEmail || bookingComplete || waitingForPhone) return;
    pushDebug(`Booking prerequisites: date=${confirmedDate.toISOString()} name=${userName} email=${userEmail} phone=${userPhone||'none'}`);
    pushTranscript({ role:'assistant', text:'Great, sending your confirmation now...', ts: Date.now() });
    try {
      const EMAIL_ONLY_MODE = true; // Always true per user request to bypass calendar and just send emails.
      const tz = 'America/New_York';
      const day = confirmedDate;
      let startISO: string | null = null;
      let fallbackUsed = false;
      try {
        pushDebug('Attempting availability fetch for booking');
        const from = new Date(day.getTime() - 12*60*60*1000).toISOString();
        const to = new Date(day.getTime() + 36*60*60*1000).toISOString();
        const availUrl = `/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&durationMins=30`;
        const availRes = await fetch(availUrl);
        const availJson = await availRes.json().catch(()=>({}));
        let slots: Array<string> = Array.isArray(availJson?.slots) ? availJson.slots : [];
        const targetEtDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(day);
        slots = slots.filter(s => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(s)) === targetEtDate);
        if (slots.length) {
          startISO = slots[0];
          pushDebug('Booking earliest real slot: '+startISO);
        }
      } catch (inner:any) {
        pushDebug('Availability fetch failed: '+ (inner?.message||inner));
      }
      if (!startISO) {
        fallbackUsed = true;
        const now = new Date();
        const synthetic = new Date(day.getTime());
        synthetic.setHours(14,0,0,0); // Aim for 2 PM ET
        if (synthetic < now) {
          const adj = new Date(now.getTime() + 60*60*1000);
          adj.setMinutes(0,0,0);
          synthetic.setTime(adj.getTime());
        }
        startISO = synthetic.toISOString();
        pushDebug('Using fallback synthetic slot: '+startISO);
      }
      const start = new Date(startISO);
      const notesParts = ['Voice AI booking'];
      if (userPhone) notesParts.push('Phone: '+userPhone);
      if (EMAIL_ONLY_MODE) {
        // Direct email-only notification
        const emailPayload = { startISO, durationMins:30, name: userName, email: userEmail, phone: userPhone || undefined, notes: notesParts.join(' | ') };
        const res = await fetch('/api/email/simple-book', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(emailPayload) });
        const j = await res.json().catch(()=>({}));
        pushDebug('Email-only booking response: '+ JSON.stringify(j));
        const pretty = new Intl.DateTimeFormat('en-US',{ timeZone: tz, weekday:'long', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true }).format(start);
        if (res.ok && (j?.customerEmailSent || j?.ownerEmailSent)) {
          const emailNote = j?.customerEmailSent ? 'Confirmation email sent.' : '';
          const ownerNote = j?.ownerEmailSent ? '' : ' (Owner email may have failed)';
          const sourceNote = fallbackUsed ? ' (Provisional time used.)' : '';
          pushTranscript({ role:'assistant', text: `All set ${userName}! I noted ${pretty} ET. ${emailNote}${ownerNote}${sourceNote}`, ts: Date.now() });
        } else {
          const apiErrNote = j?.errors ? ` (${Array.isArray(j.errors) ? j.errors.join('; ') : j.errors})` : '';
          pushTranscript({ role:'assistant', text: `I captured your details but the email may not have sent${apiErrNote}. I'll follow up manually if needed.`, ts: Date.now() });
          pushDebug('Email-only route failure '+ JSON.stringify(j));
        }
        return; // Skip calendar path entirely
      }
      // (Calendar/email path retained but unreachable with EMAIL_ONLY_MODE=true)
    } catch (e:any) {
      pushDebug('Booking exception: '+ (e?.message||e));
      pushTranscript({ role:'assistant', text: 'Something went wrong booking that. I will email you to finalize.', ts: Date.now() });
    } finally {
      setBookingComplete(true);
    }
  }

  // Auto booking trigger when all required fields present
  useEffect(() => {
    if (confirmedDate && userName && userEmail && !bookingComplete && !waitingForPhone) {
      pushDebug('Auto-trigger booking conditions met');
      attemptBooking();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedDate, userName, userEmail, waitingForPhone]);

  // If we have date + name + email but are still waiting for phone (and none provided), auto proceed treating phone as optional
  useEffect(() => {
    if (bookingComplete) return;
    if (!confirmedDate || !userName || !userEmail) return;
    if (userPhone) return; // phone already supplied
    if (waitingForPhone) {
      pushDebug('Auto releasing phone gate (treating phone as optional)');
      setWaitingForPhone(false);
      pushTranscript({ role:'assistant', text:'Perfect, I have your details. Sending the confirmation now.', ts: Date.now() });
    }
  }, [confirmedDate, userName, userEmail, userPhone, waitingForPhone, bookingComplete, pushTranscript]);

  // Watchdog: if booking prerequisites satisfied but waitingForPhone never cleared, force booking after short delay
  useEffect(() => {
    if (bookingComplete) return;
    const id = setInterval(() => {
      if (bookingComplete) return;
      if (!confirmedDate || !userName || !userEmail) return;
      if (!waitingForPhone) return;
      if (lastEmailSetRef.current && Date.now() - lastEmailSetRef.current > 2500) {
        pushDebug('Watchdog forcing booking (waitingForPhone stuck)');
        setWaitingForPhone(false);
        attemptBooking();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [confirmedDate, userName, userEmail, waitingForPhone, bookingComplete]);

  useEffect(() => {
    scriptedFlowRef.current = (latestUser: string) => {
      if (!introDone) {
        pushTranscript({ role:'assistant', text: "Hi, I'm Rick. How can I help? You can mention a weekday for a meeting.", ts: Date.now() });
        setIntroDone(true);
      }
      // Allow email correction before booking completes (user restates a different email)
      if (userEmail && !bookingComplete) {
        const correctionCue = /(change|correction|actually|wrong|update|fix)\b/i.test(latestUser);
        const emNew = extractEmail(latestUser);
        if (emNew && emNew !== userEmail) {
          const refinedCorr = refineEmailCandidate(emNew, userName);
          pushDebug('Detected email correction with explicit address');
          setUserEmail(refinedCorr);
          // Trigger AI refinement if suspicious filler present
          if (/^(yes|ok|okay|mynameis|myemailis|yesmy)/i.test(refinedCorr.split('@')[0])) {
            pendingAIRefineRef.current = aiRefineEmail(refinedCorr, userName).then(e2 => { if (e2 !== refinedCorr) setUserEmail(e2); });
          }
          pushTranscript({ role:'assistant', text:'Updated your email. Continue with phone or say skip.', ts: Date.now() });
          return;
        }
        if (correctionCue && !emNew) {
          pushTranscript({ role:'assistant', text:'Sure—please state or spell the updated email now.', ts: Date.now() });
          return;
        }
      }
      if (!confirmedDate) {
        const wd = extractWeekday(latestUser);
        if (wd) {
          const dt = nextOccurrence(wd);
          setConfirmedDate(dt);
          setPendingDateConfirm(null);
            setWaitingForPhone(true); // reuse as general multi-field capture gate
            pushTranscript({ role:'assistant', text:`Great—I'll target next ${fmtPretty(dt)}. If that's not right just say another weekday. Please give me your first name, then spell your email letter by letter (e.g. j o h n at gmail dot com), and your phone number if you want to add it— or say skip for no phone. You can say them all in one go.`, ts: Date.now() });
          return;
        }
      } else if (confirmedDate && !userName) {
        // Allow user to override date by saying another weekday before giving name
        const wd2 = extractWeekday(latestUser);
        if (wd2) {
          const dt2 = nextOccurrence(wd2);
          setConfirmedDate(dt2);
            pushTranscript({ role:'assistant', text:`Updated to ${fmtPretty(dt2)}. Please provide your first name, spelled email, and phone (or say skip).`, ts: Date.now() });
          return;
        }
      }
        // Consolidated multi-field capture (name + email + phone) while waitingForPhone acts as general capture gate
        if (confirmedDate && waitingForPhone) {
          let capturedSomething = false;
          if (!userName) {
            const nm = extractName(latestUser) || (latestUser.match(/\b([A-Z][a-z]{1,20})\b/)?.[1] ?? null);
            if (nm) { setUserName(nm); pushDebug('Multi-capture: name '+nm); capturedSomething = true; }
          }
          // Spelled email attempt first
          const spelledCandidate = processSpelledEmailUtterance(latestUser);
          if (spelledCandidate) {
            if (!userEmail || isBetterEmail(spelledCandidate, userEmail)) {
              const refinedSpelled = refineEmailCandidate(spelledCandidate, userName);
              if (refinedSpelled !== spelledCandidate) pushDebug('Refined spelled email '+spelledCandidate+' -> '+refinedSpelled);
              setUserEmail(refinedSpelled);
              pushDebug('Multi-capture: spelled email set '+refinedSpelled);
              if (/^(yes|ok|okay|mynameis|myemailis|yesmy)/i.test(refinedSpelled.split('@')[0])) {
                pendingAIRefineRef.current = aiRefineEmail(refinedSpelled, userName).then(e2 => { if (e2 !== refinedSpelled) setUserEmail(e2); });
              }
              capturedSomething = true;
            }
          } else {
            // Fallback regex email extraction
            if (!userEmail) {
              const em = extractEmail(latestUser);
              if (em && (!spelledLocalRef.current || em.split('@')[0].length >= spelledLocalRef.current.length)) {
                // Avoid accepting trivial one-letter local if we have buffered letters
                if (!(spelledLocalRef.current.length >=3 && em.split('@')[0].length <=2)) {
                  const refined = refineEmailCandidate(em, userName);
                  if (refined !== em) pushDebug('Refined email '+em+' -> '+refined);
                  setUserEmail(refined); pushDebug('Multi-capture: email '+refined); capturedSomething = true;
                  if (/^(yes|ok|okay|mynameis|myemailis|yesmy)/i.test(refined.split('@')[0])) {
                    pendingAIRefineRef.current = aiRefineEmail(refined, userName).then(e2 => { if (e2 !== refined) setUserEmail(e2); });
                  }
                } else {
                  pushDebug('Ignored short local email candidate due to buffered spelling context: '+em);
                }
              }
            } else {
              const em2 = extractEmail(latestUser);
              if (em2 && isBetterEmail(em2, userEmail)) { setUserEmail(em2); pushDebug(`Multi-capture: upgraded email ${userEmail} -> ${em2}`); capturedSomething = true; }
            }
          }
          const skipPhone = /\b(skip|no phone|no number|nope)\b/i.test(latestUser);
          if (!userPhone && !skipPhone) {
            const phoneMatch = latestUser.match(/\+?\d[\d\-\s()]{6,}/);
            if (phoneMatch) {
              const digits = phoneMatch[0].replace(/[^\d+]/g,'');
              setUserPhone(digits);
              pushDebug('Multi-capture: phone '+digits);
              capturedSomething = true;
            }
          }
          if (skipPhone && !userPhone) {
            pushDebug('Multi-capture: phone skipped');
          }
          const haveName = !!userName || capturedSomething && !!(extractName(latestUser));
          const haveEmail = !!userEmail && /.+@.+\..+/.test(userEmail); // must be finalized email with domain
          const phoneResolved = !!userPhone || skipPhone;
          if (haveName && haveEmail && phoneResolved) {
            setWaitingForPhone(false); // release booking gate
            pushTranscript({ role:'assistant', text:`Thanks, got your details${userEmail ? '' : ' (email still processing)'}.`, ts: Date.now() });
            attemptBooking();
            return;
          }
          if (!capturedSomething) {
            // Build dynamic prompt listing missing pieces
              const missing: string[] = [];
              if (!haveName) missing.push('name');
              if (!haveEmail) missing.push('spelled email');
              if (!phoneResolved) missing.push('phone number (or say skip)');
              pushTranscript({ role:'assistant', text:`I still need your ${missing.join(', ')}. You can say them all together.`, ts: Date.now() });
            return;
          }
          // If we captured some but still missing others, list remaining
          if (!haveName || !haveEmail || !phoneResolved) {
            const missing: string[] = [];
            if (!haveName) missing.push('name');
            if (!haveEmail) missing.push('spelled email');
            if (!phoneResolved) missing.push('phone (or say skip)');
            pushTranscript({ role:'assistant', text:`Got that. Still need ${missing.join(', ')}.`, ts: Date.now() });
            return;
          }
        }
      // (Legacy waitingForPhone single-purpose branch removed; unified above.)
      if (bookingComplete) {
  pushTranscript({ role:'assistant', text:'Anything else I can help with today?', ts: Date.now() });
      }
    };
  }, [introDone, confirmedDate, pendingDateConfirm, userName, userEmail, userPhone, waitingForPhone, bookingComplete]);

  // Step capture instrumentation
  useEffect(() => { if (userName) pushDebug('State update: userName='+userName); }, [userName]);
  useEffect(() => { if (userEmail) { pushDebug('State update: userEmail='+userEmail); lastEmailSetRef.current = Date.now(); } }, [userEmail]);
  useEffect(() => { if (userPhone) pushDebug('State update: userPhone='+userPhone); }, [userPhone]);
  useEffect(() => { if (confirmedDate) pushDebug('State update: confirmedDate='+confirmedDate.toISOString()); }, [confirmedDate]);
  useEffect(() => { pushDebug('State update: waitingForPhone='+(waitingForPhone?'true':'false')); }, [waitingForPhone]);
  useEffect(() => { if (bookingComplete) pushDebug('State update: bookingComplete=true'); }, [bookingComplete]);

  // manualEmailTrigger removed: booking now always auto-sends once required fields captured.

  const pushDebug = useCallback((msg: string) => {
    setDebug(d => [...d.slice(-99), `[${new Date().toISOString()}] ${msg}`]);
    // eslint-disable-next-line no-console
    console.debug("[VoiceAI]", msg);
  }, []);

  // Render-time console marker (should appear on every client re-render if hydration succeeded)
  if (typeof window !== 'undefined') {
    (window as any).__VOICE_AI_RENDERS__ = ((window as any).__VOICE_AI_RENDERS__ || 0) + 1;
    // eslint-disable-next-line no-console
    console.log('[VoiceAI] render count', (window as any).__VOICE_AI_RENDERS__);
  }

  // Build ephemeral key once on first user gesture (lazy)
  const ensureSession = useCallback(async () => {
    if (sessionKeyRef.current) return sessionKeyRef.current;
    setConnState("connecting");
    try {
      const res = await fetch("/api/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructions: instructionsOverride,
        }),
      });
      const json: EphemeralSessionResp = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
      const key = json?.client_secret?.value;
      if (!key) throw new Error("Ephemeral key missing in response");
      pushDebug("Ephemeral session acquired");
      // Capture model from session if present
      sessionModelRef.current = (json as any)?.model || sessionModelRef.current;
      sessionKeyRef.current = key;
      return key;
    } catch (e: any) {
      setError(e?.message || "Failed to init session");
      pushDebug(`Session error: ${e?.message || e}`);
      setConnState("error");
      throw e;
    }
  }, [instructionsOverride]);

  const closeSession = useCallback(() => {
    // Do not permanently mark ended on generic cleanup; allow restarting.
    endedRef.current = false;
    holdActiveRef.current = false;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    try { senderRef.current?.replaceTrack(null); } catch {}
    pcRef.current?.getSenders().forEach(s => { try { s.replaceTrack(null); } catch {} });
    pcRef.current?.getReceivers().forEach(r => r.track?.stop());
    dataChanRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    setConnState("disconnected");
    try { recognitionRef.current && recognitionRef.current.stop(); } catch {}
    setSpeechFallbackActive(false);
  }, []);

  // Create peer connection (no negotiation yet)
  const createPeerConnection = useCallback(async () => {
    if (pcRef.current) return pcRef.current;
    await ensureSession();
    pushDebug("Creating RTCPeerConnection base");
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    const dc = pc.createDataChannel("oai-events");
    dataChanRef.current = dc;
    dc.onmessage = (ev) => {
      pushDebug(`DataChannel raw: ${ev.data.slice(0,200)}`);
      try {
        const msg = JSON.parse(ev.data);
        const t = msg?.type;
        switch(t) {
          case 'input_audio_buffer.committed':
          case 'input_audio_buffer.speech_started':
          case 'input_audio_buffer.speech_stopped':
          case 'output_audio_buffer.cleared':
          case 'conversation.item.truncated':
          case 'response.created':
          case 'response.output_item.added':
          case 'response.content_part.added':
          case 'response.content_part.done':
          case 'response.output_item.done':
          case 'response.done':
          case 'response.audio.done':
          case 'rate_limits.updated':
          case 'output_audio_buffer.started':
          case 'output_audio_buffer.stopped':
            // Low-value UI noise; ignore but don't log as unhandled to reduce clutter
            break;
          case 'transcript.delta':
          case 'response.audio_transcript.delta': {
            // Usually assistant partials; accumulate only if final? We'll still show minimal.
            const text = msg?.delta || msg?.text || msg?.content || '';
            if (text && t === 'transcript.delta') {
              pushTranscript({ role: msg.role === 'user' ? 'user' : 'assistant', text, ts: Date.now() });
            }
            break;
          }
          case 'transcript.final':
          case 'response.audio_transcript.done': {
            const text = msg?.text || msg?.content || '';
            if (text) {
              pushTranscript({ role: msg.role === 'user' ? 'user' : 'assistant', text, ts: Date.now() });
              // Scan for EMAIL_JSON line inside final assistant transcript
              if (msg.role !== 'user') {
                const lines = text.split(/\n+/);
                for (const ln of lines) {
                  const m = ln.match(/^EMAIL_JSON:(\{.*\})$/);
                  if (m) {
                    try {
                      const parsed = JSON.parse(m[1]);
                      if (parsed?.email && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(parsed.email)) {
                        // If different / longer local part, accept directly (bypass heuristic)
                        const cleaned = parsed.email.toLowerCase();
                        if (cleaned !== userEmail) {
                          pushDebug('EMAIL_JSON accepted: '+cleaned);
                          setUserEmail(cleaned);
                          spellingActiveRef.current = false; // stop local spelling capture
                        }
                      }
                    } catch (e:any) {
                      pushDebug('EMAIL_JSON parse error: '+(e?.message||e));
                    }
                  }
                }
              }
            }
            setConnState(prev => prev === 'listening' ? 'thinking' : prev);
            break;
          }
          case 'conversation.item.created': {
            const item = msg.item;
            // Attempt to extract user textual input from item.content array
            if (item?.type === 'message' || item?.object === 'realtime.item') {
              const role = item?.role || item?.metadata?.role;
              if (role === 'user') {
                const contentArr = item.content || item?.messages || [];
                const textParts: string[] = [];
                for (const c of contentArr) {
                  if (typeof c === 'string') textParts.push(c);
                  else if (c?.type === 'input_text' && c.text) textParts.push(c.text);
                  else if (c?.text) textParts.push(c.text);
                }
                const combined = textParts.join(' ').trim();
                if (combined) pushTranscript({ role: 'user', text: combined, ts: Date.now() });
              }
            }
            break;
          }
          default:
            pushDebug(`Unhandled event type: ${t}`);
        }
      } catch (e:any) { pushDebug(`Event parse error: ${e?.message || e}`); }
    };
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };
    pc.onconnectionstatechange = () => {
      pushDebug(`PC state: ${pc.connectionState}`);
      if (["failed","disconnected","closed"].includes(pc.connectionState)) setConnState("disconnected");
    };
    const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    senderRef.current = transceiver.sender;
    return pc;
  }, [ensureSession, pushDebug, pushTranscript]);

  // Negotiate SDP if not already
  const negotiateIfNeeded = useCallback(async () => {
    if (negotiatedRef.current) return;
    const key = await ensureSession();
    const pc = pcRef.current;
    if (!pc) throw new Error("PeerConnection missing during negotiate");
    pushDebug("Creating offer");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Wait for ICE gathering (bounded)
    await new Promise<void>((resolve) => {
      if (!pc) return resolve();
      if (pc.iceGatheringState === 'complete') return resolve();
      const to = setTimeout(() => { pushDebug('ICE gather timeout'); resolve(); }, 1200);
      const handler = () => {
        if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', handler); clearTimeout(to); resolve(); }
      };
      pc.addEventListener('icegatheringstatechange', handler);
    });
    const model = sessionModelRef.current || process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
    pushDebug(`Sending SDP offer (model=${model})`);
    const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/sdp', 'OpenAI-Beta': 'realtime=v1' },
      body: pc.localDescription?.sdp || ''
    });
    const answerSdp = await sdpRes.text();
    if (!sdpRes.ok) { pushDebug(`SDP error body: ${answerSdp.slice(0,300)}`); throw new Error('Realtime SDP exchange failed'); }
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    negotiatedRef.current = true;
    pushDebug('Negotiation complete');
    setConnState('connected');
  }, [ensureSession, pushDebug]);

  const startListening = useCallback(async () => {
    if (!supportRTC) { pushDebug('startListening abort: supportRTC false'); return; }
    if (endedRef.current) { pushDebug('startListening abort: endedRef true'); return; }
    if (listeningRef.current) { pushDebug('startListening abort: already listening'); return; }
    pushDebug('startListening begin');
    listeningRef.current = true;
    setConnState("connecting");
    try {
      await createPeerConnection();
      pushDebug("Requesting microphone (early)");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(err => {
        pushDebug(`getUserMedia error: ${err?.name || err}`);
        throw err;
      });
      micStreamRef.current = stream;
      setActiveMicStream(stream);
      const [track] = stream.getAudioTracks();
      await senderRef.current?.replaceTrack(track);
      pushDebug("Mic track attached");
      await negotiateIfNeeded();
      setConnState("listening");
      pushDebug("Listening started");
    } catch (e: any) {
      listeningRef.current = false;
      setError(e?.message || "Mic/connection failed");
      pushDebug(`Start listening failed: ${e?.message || e}`);
      setConnState("error");
    }
  }, [createPeerConnection, negotiateIfNeeded, supportRTC, pushDebug]);

  const stopListening = useCallback(async () => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    try { await senderRef.current?.replaceTrack(null); } catch {}
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    setActiveMicStream(null);
    setConnState("thinking");
  }, []);

  // Mute toggle affects remote audio element (not upstream speech generation)
  const toggleMute = useCallback(() => {
    const a = remoteAudioRef.current;
    if (!a) return;
    a.muted = !a.muted;
    setIsMuted(a.muted);
  }, []);

  const toggleListening = useCallback(() => {
    pushDebug(`toggleListening invoked (state=${connState}, listeningRef=${listeningRef.current})`);
    pushDebug(`guards before toggle: supportRTC=${supportRTC} ended=${endedRef.current} negotiated=${negotiatedRef.current}`);
    try {
      if (connState === "listening") {
        stopListening();
      } else {
        startListening();
      }
    } catch (e: any) {
      pushDebug(`toggleListening error: ${e?.message || e}`);
    }
  }, [connState, startListening, stopListening, pushDebug, supportRTC]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.code === "Space" || e.code === "Enter") {
      toggleListening();
      e.preventDefault();
    }
  };
  const onKeyUp = () => {};

  useEffect(() => {
    // Start a lightweight Web Speech recognition loop if available to feed scripted flow.
    if (typeof window === 'undefined') return;
    const SpeechRecognition: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return; // Browser unsupported
    if (speechFallbackActive) return; // already running
    // Only start after connection established so user has clicked the button at least once.
    if (connState === 'connected' || connState === 'listening') {
      try {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';
        rec.onresult = (e: any) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) {
              const text = res[0].transcript.trim();
              if (text) {
                pushDebug('SpeechFallback final: '+text);
              // Multi-field extraction in a single utterance (email + phone + name) with heuristics
              try {
                if (!userEmail) {
                  const e2 = extractEmail(text);
                  if (e2) { proposeEmail(e2, 'heuristic'); }
                }
                if (!userPhone) {
                  const p2 = extractPhone(text);
                  if (p2) { setUserPhone(p2); pushDebug('Extracted phone from line (heuristic)'); }
                }
                if (!userName) {
                  const n2 = extractName(text);
                  if (n2) { setUserName(n2); pushDebug('Extracted name from line (heuristic)'); }
                }
              } catch {}
                try { scriptedFlowRef.current && scriptedFlowRef.current(text); } catch {}
              }
            }
          }
        };
        rec.onerror = (ev: any) => { pushDebug('SpeechFallback error: '+ ev.error); };
        rec.onend = () => {
          // Auto-restart to keep capturing while any session still active
          if (['connecting','connected','listening','thinking','muted'].includes(connState)) {
            try { rec.start(); pushDebug('SpeechFallback restart'); } catch (e:any) { pushDebug('SpeechFallback restart failed: '+(e?.message||e)); }
          }
        };
        rec.start();
        recognitionRef.current = rec;
        setSpeechFallbackActive(true);
        pushDebug('SpeechFallback started');
      } catch (e:any) {
        pushDebug('SpeechFallback init failed: '+ (e?.message||e));
      }
    }
  }, [connState, speechFallbackActive, pushDebug]);

  useEffect(() => {
    // Stop recognition when booking complete and no further interaction expected
    if (speechFallbackActive && bookingComplete) {
      try { recognitionRef.current && recognitionRef.current.stop(); } catch {}
      setSpeechFallbackActive(false);
      pushDebug('SpeechFallback stopped after booking');
    }
  }, [speechFallbackActive, bookingComplete, pushDebug]);

  // Initial mount/setup effect
  useEffect(() => {
    try {
      const ok = typeof window !== 'undefined' && !!((window as any).RTCPeerConnection) && !!navigator.mediaDevices?.getUserMedia;
      setSupportRTC(ok);
      pushDebug(`RTC support: ${ok}`);
    } catch (e:any) {
      setSupportRTC(false);
      pushDebug(`RTC detection failed: ${e?.message || e}`);
    }
    endedRef.current = false;
    setHydrated(true);
    // Capture remote audio element ref once mounted for orb TTS reactivity
    setTimeout(() => { if (remoteAudioRef.current) setTtsAudioEl(remoteAudioRef.current); }, 0);
    return () => { closeSession(); };
  }, [closeSession, pushDebug]);

  // Initial skeleton (identical server/client) while we detect support
  if (supportRTC === null) {
    return (
      <section id="voice-ai" className="w-full">
        <div className="max-w-6xl mx-auto px-4 py-12 sm:py-16">
          <div className="rounded-2xl p-6 shadow-md bg-white/40 dark:bg-neutral-900/40 backdrop-blur h-48 animate-pulse" aria-hidden="true" />
        </div>
      </section>
    );
  }

  if (!supportRTC) {
    return (
      <section id="voice-ai" className="w-full">
        <div className="max-w-6xl mx-auto px-4 py-12 sm:py-16">
          <div className="rounded-2xl p-6 shadow-md bg-white/70 dark:bg-neutral-900/70 backdrop-blur">
            <h2 className="text-3xl font-semibold">Voice AI</h2>
            <p className="text-sm text-neutral-500 mt-1">Your browser does not support live voice. Use the text chat instead.</p>
            {!!debug.length && (
              <pre className="mt-4 max-h-40 overflow-auto text-[10px] whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{debug.join("\n")}</pre>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
  <section id="voice-ai" className="w-full" data-hydrated={hydrated ? 'true' : 'false'} onClick={() => pushDebug('Section root clicked')}> 
      <div className="max-w-6xl mx-auto px-4 py-12 sm:py-16">
  <div
    /* Previous wide classes: w-full p-8 sm:p-10 */
    className="relative mx-auto w-[240px] sm:w-[240px] overflow-hidden rounded-3xl border border-white/15 bg-white/10 dark:bg-white/5 backdrop-blur-xl p-4 shadow-2xl flex flex-col items-center text-center"
    style={{ minWidth: 240 }}
  >
          {/* Sanitized: status pills commented out
          <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-neutral-900 text-white dark:bg-neutral-200 dark:text-neutral-900" aria-live="polite">{statusText}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-600/80 text-white/90">{hydrated ? 'Hydrated' : 'SSR'}</span>
          </div>
          */}
          <h2 className="text-3xl font-semibold">Voice AI</h2>
          <p className="mt-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 tracking-wide">Click the orb to talk with Rick.</p>
          {/* Sanitized subtitle removed visually
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">Talk to Rick for quick answers.</p>
          */}

            {/* Sanitized error display (still logged internally)
            {error && (
              <div className="mt-4 text-xs text-red-600 dark:text-red-400" role="alert">{error}</div>
            )}
            */}

          <div className="mt-10 flex flex-col items-center gap-6">
            <div className="flex flex-col items-center">
              <button
                type="button"
                aria-label="Click to talk to Rick"
                title="Click to talk"
                onClick={(e) => { e.stopPropagation(); pushDebug('Voice button clicked'); toggleListening(); }}
                onTouchStart={(e) => { e.preventDefault(); pushDebug('Voice button touch'); toggleListening(); }}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                className="group relative rounded-2xl focus:outline-none focus-visible:ring-4 ring-blue-500/60 overflow-hidden shadow bg-white dark:bg-neutral-800 transition active:scale-95"
              >
                {/* Replaced static image with reactive aura orb */}
                <BlueRidgeVoiceAura
                  state={connState === 'listening' ? 'listen' : (connState === 'thinking' ? 'speak' : 'idle')}
                  size={200}
                  micStream={activeMicStream || undefined}
                  ttsAudioEl={ttsAudioEl || undefined}
                  backgroundColor="#041a37"
                />
                <span className="absolute inset-0 ring-2 ring-transparent group-hover:ring-blue-400/50 rounded-2xl" aria-hidden="true" />
              </button>
              {/* Sanitized: helper labels & extra buttons removed visually
              <div className="mt-2 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{connState === 'listening' ? 'Listening...' : 'Click to Talk'}</div>
              <div className="mt-2 flex gap-2 flex-wrap"> ...buttons... </div>
              */}
            </div>
            {/* Sanitized: transcript, status grids, debug input, logs commented out but preserved
            <div className="flex-1 w-full max-w-md"> ...existing transcript / debug panels... </div>
            */}
          </div>
          {/* Bottom control bar (Mute / End) */}
          <div className="mt-8 flex gap-3 justify-center">
            <button
              type="button"
              onClick={toggleMute}
              className="text-xs px-4 py-2 rounded-full bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition"
            >{isMuted ? "Unmute" : "Mute"}</button>
            {/* Conditional session control: show Start (green) before session, End (red) once active */}
            {connState === 'disconnected' ? (
              <button
                type="button"
                onClick={startListening}
                className="text-xs px-4 py-2 rounded-full bg-green-600 text-white hover:bg-green-500 transition"
              >Start</button>
            ) : (
              <button
                type="button"
                onClick={closeSession}
                className="text-xs px-4 py-2 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition"
              >End</button>
            )}
          </div>
          {/* Hidden audio element still required for playback */}
          <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        </div>
      </div>
    </section>
  );
};

// Simple inline debug input component (local only)
const ManualDebugInput: React.FC<{ onSubmit: (text: string) => void }> = ({ onSubmit }) => {
  const [val, setVal] = React.useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const v = val.trim(); if (v) { onSubmit(v); setVal(''); } }}
      className="mt-2 flex gap-2"
    >
      <input
        type="text"
        placeholder="Type utterance & Enter"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="flex-1 px-2 py-1 text-xs rounded border border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-800/60 focus:outline-none"
      />
      <button
        type="submit"
        className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
        disabled={!val.trim()}
      >Inject</button>
    </form>
  );
};

export default VoiceAIBanner;
