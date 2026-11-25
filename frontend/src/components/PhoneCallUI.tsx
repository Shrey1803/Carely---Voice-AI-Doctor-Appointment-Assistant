import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDays, Check, ChevronDown, HeartPulse, Mic, MicOff, Phone, PhoneOff,
  ShieldCheck, Sparkles, X,
} from 'lucide-react';
import type { VoiceCallState } from '../hooks/useVoiceCall';
import type { WSMessage } from '../types';
import { AudioWaveform } from './AudioWaveform';

interface PhoneCallUIProps {
  state: VoiceCallState;
  messages: WSMessage[];
  error: string | null;
  durationSeconds: number;
  isMuted: boolean;
  audioAnalyser: AnalyserNode | null;
  microphoneAnalyser: AnalyserNode | null;
  isAssistantSpeaking: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
  onCallAgain: () => void;
  onReconnect: () => void;
  onDismiss: () => void;
  onMinimize: () => void;
}

type CallVisualState = 'connecting' | 'listening' | 'speaking' | 'muted' | 'error' | 'ended';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8060cc] focus-visible:ring-offset-2';

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function displayDate(value: unknown) {
  if (typeof value !== 'string') return 'Date to be confirmed';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function displayTime(value: unknown) {
  if (typeof value !== 'string') return 'Time to be confirmed';
  const date = new Date(`2000-01-01T${value}`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Shows Ava's call identity and real voice activity through restrained animation. */
function VoiceOrb({ speaking, ended, analyser, active }: { speaking: boolean; ended: boolean; analyser: AnalyserNode | null; active: boolean }) {
  return <div className="call-voice-orb relative flex h-[142px] w-[142px] items-center justify-center" aria-hidden="true">
    <div className={`call-voice-orb-halo absolute inset-0 rounded-full border border-[#e8e1f7] ${!speaking && !ended ? 'motion-safe:animate-[breathe_4s_ease-in-out_infinite]' : ''}`} />
    <div className="call-voice-orb-middle absolute inset-3 rounded-full bg-[#f1ecfa]" />
    <div className={`call-voice-orb-core relative flex h-[100px] w-[100px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#c2acef_0%,#9874d9_45%,#7350b8_100%)] shadow-[0_8px_30px_#9678ce33,inset_0_2px_3px_#ffffff66] ${ended ? 'grayscale' : ''}`}>
      <AudioWaveform analyser={analyser} active={active} />
    </div>
    <span className="call-voice-orb-badge absolute bottom-1 right-4 flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-[#e5f3eb] text-[#34805c]"><HeartPulse className="h-4 w-4" /></span>
  </div>;
}

/** Renders a transcript entry with caller and receptionist visually distinguished. */
function TranscriptMessage({ message, callerName }: { message: Extract<WSMessage, { type: 'transcript' }>; callerName: string | null }) {
  const isUser = message.role === 'user';
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
    <span className={`mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isUser ? 'bg-[#eaf0f3] text-slate-600' : 'bg-[#eee7f9] text-[#7552b5]'}`} aria-hidden="true">{isUser ? <span className="text-xs font-semibold">{callerName?.charAt(0).toUpperCase() || 'Y'}</span> : <Sparkles className="h-3.5 w-3.5" />}</span>
    <div className={`max-w-[87%] ${isUser ? 'text-right' : ''}`}>
      <div className={`mb-1.5 flex items-center gap-2 text-xs ${isUser ? 'justify-end' : ''}`}><span className="font-medium text-slate-600">{isUser ? callerName || 'You' : 'Ava'}</span><time className="text-slate-500" dateTime={message.timestamp}>{time}</time></div>
      <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-3 text-sm leading-[1.65] ${isUser ? 'rounded-tr-sm bg-[#f1f4f6] text-[#3e4855]' : 'rounded-tl-sm bg-[#f4f1fa] text-[#41384f]'}`}>{message.text}</p>
    </div>
  </motion.div>;
}

/** Shows a confirmed booking from the backend tool result without exposing the phone number. */
function AppointmentCard({ booking }: { booking: Record<string, unknown> }) {
  return <div className="ml-9 rounded-xl border border-[#dcece3] bg-[#f5faf7] p-3.5">
    <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-[#337452]"><Check className="h-3.5 w-3.5" />Appointment confirmed</div>
    <div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#5c816b]"><CalendarDays className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-[#252638]">{String(booking.doctor_name ?? 'Doctor')}</p><p className="mt-1 text-xs text-slate-600">{displayDate(booking.date)} · {displayTime(booking.time)}</p>{typeof booking.specialty === 'string' && <p className="mt-1 text-xs text-slate-500">{booking.specialty}</p>}</div></div>
  </div>;
}

/** Accessible mobile call experience backed by the live voice WebSocket. */
export function PhoneCallUI({ state, messages, error, durationSeconds, isMuted, audioAnalyser, microphoneAnalyser, isAssistantSpeaking, onToggleMute, onEnd, onCallAgain, onReconnect, onDismiss, onMinimize }: PhoneCallUIProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const visualState: CallVisualState = state === 'connecting'
    ? 'connecting'
    : error
      ? 'error'
      : state === 'ended'
        ? 'ended'
        : isMuted
          ? 'muted'
          : isAssistantSpeaking ? 'speaking' : 'listening';
  const callerName = [...messages].reverse().find((message) => message.type === 'caller_identity')?.name ?? null;
  const active = state === 'connected';
  const waveformActive = active && !error && (isAssistantSpeaking || !isMuted);
  const waveformAnalyser = isAssistantSpeaking ? audioAnalyser : microphoneAnalyser;

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }, [messages, error]);

  const statusText = {
    connecting: 'Connecting to Ava…',
    listening: 'Listening',
    speaking: 'Ava is speaking',
    muted: 'Your microphone is muted',
    error: 'Connection interrupted',
    ended: 'Call ended',
  }[visualState];

  return <>
    <motion.div key="phone-backdrop" className="fixed inset-0 z-50 bg-[#20212c]/35 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} />
    <div className="pointer-events-none fixed inset-0 z-[51] flex items-center justify-center overflow-y-auto sm:p-5 lg:p-8">
      <motion.section role="dialog" aria-modal="true" aria-label="Call with Ava" className="call-phone-panel pointer-events-auto relative flex h-dvh min-h-0 w-full max-w-[440px] flex-col overflow-hidden bg-white text-[#252638] shadow-2xl shadow-slate-900/15 sm:h-[min(844px,calc(100dvh-40px))] sm:min-h-0 sm:rounded-[28px] sm:border sm:border-[#e7e3ee]" initial={{ y: 18, opacity: 0, scale: 0.985 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0, scale: 0.985 }} transition={{ type: 'spring', stiffness: 280, damping: 28 }}>
        <header className="flex shrink-0 items-center justify-between border-b border-[#eeebf2] px-5 pb-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
          <div className="flex min-h-11 items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#8060c5] text-white"><HeartPulse className="h-5 w-5" /></span><div><p className="text-sm font-semibold tracking-wide">Carely</p><p className="text-[11px] text-slate-500">Ava · AI receptionist</p></div></div>
          {visualState === 'ended' ? <button onClick={onDismiss} aria-label="Close call summary" className={`flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 ${focusRing}`}><X className="h-4 w-4" /></button> : <button onClick={onMinimize} aria-label="Minimize call" className={`flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 ${focusRing}`}><ChevronDown className="h-5 w-5" /></button>}
        </header>

        <section className="call-identity-section flex shrink-0 flex-col items-center px-5 pb-4 pt-2 text-center sm:pb-5">
          <VoiceOrb speaking={visualState === 'speaking'} ended={visualState === 'ended'} analyser={waveformAnalyser} active={waveformActive} />
          <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.6px]">Ava</h1>
          <p className="mt-0.5 text-sm text-slate-500">Your AI receptionist</p>
          {callerName && <p className="mt-1 text-xs text-slate-500">Call with {callerName}</p>}
          <div className={`mt-3 flex min-h-8 items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${visualState === 'muted' ? 'bg-[#fff0ed] text-[#a64b40]' : visualState === 'error' ? 'bg-rose-50 text-rose-700' : visualState === 'ended' ? 'bg-slate-100 text-slate-600' : 'bg-[#eef7f1] text-[#367454]'}`} role="status" aria-live="polite">
            {visualState === 'connecting' ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#b4d1c0] border-t-[#367454]" /> : visualState === 'muted' ? <MicOff className="h-3.5 w-3.5" /> : <span className={`h-1.5 w-1.5 rounded-full ${visualState === 'error' ? 'bg-rose-600' : visualState === 'ended' ? 'bg-slate-500' : 'bg-[#54946e]'}`} />}
            {statusText}{state !== 'connecting' && <><span className="mx-0.5 h-3 w-px bg-current" /><span className="tabular-nums">{formatTime(durationSeconds)}</span></>}
          </div>
        </section>

        {!(visualState === 'ended' && messages.length === 0 && !error) && <>
        <div className="mx-5 flex shrink-0 items-center justify-between border-t border-[#eeebf2] pb-3 pt-3 sm:mx-6 sm:pt-4"><h2 className="text-xs font-semibold tracking-[0.1em] text-slate-600">CONVERSATION</h2><span className="flex items-center gap-1.5 text-xs text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${active && !error ? 'bg-[#977bc7]' : 'bg-slate-300'}`} />{active && !error ? 'Live transcript' : 'Call transcript'}</span></div>
        <div ref={transcriptRef} role="log" aria-label="Call transcript" aria-live="polite" aria-relevant="additions text" className="call-transcript-scroll phone-transcript-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">
          {messages.map((message, index) => message.type === 'transcript'
            ? <TranscriptMessage key={`${message.timestamp}-${index}`} message={message} callerName={callerName} />
            : message.type === 'tool_call'
              ? <div key={`${message.timestamp}-${index}`} className="space-y-3"><div className="ml-9 rounded-xl border border-violet-100 bg-violet-50/70 px-3.5 py-3 text-xs leading-5 text-slate-600"><span className="font-semibold capitalize text-[#6243ad]">{message.tool.replaceAll('_', ' ')}</span><span className="mx-1.5 text-slate-400"> · </span>{String(message.result.message ?? 'Completed')}</div>{message.tool === 'book_appointment' && message.result.status === 'success' && <AppointmentCard booking={message.result} />}</div>
              : null)}
          {!messages.some((message) => message.type === 'transcript' || message.type === 'tool_call') && <p className="py-6 text-center text-sm text-slate-500">{state === 'connecting' ? 'Getting everything ready for you…' : 'Your conversation will appear here.'}</p>}
          {error && <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-4"><p className="text-sm font-semibold text-rose-800">We lost the connection.</p><p className="mt-1 text-sm leading-6 text-rose-800">Your conversation is still here. Reconnect when you’re ready.</p><button onClick={onReconnect} className={`mt-2 min-h-10 rounded-lg px-2 text-sm font-semibold text-[#68469f] underline underline-offset-2 ${focusRing}`}>Reconnect</button></div>}
          {visualState === 'ended' && <p className="rounded-xl bg-[#f6f4fa] p-4 text-center text-sm leading-6 text-slate-600">Thanks for calling. Take good care.</p>}
        </div>
        </>}

        <footer aria-label="Call controls" className="call-footer z-10 shrink-0 border-t border-[#eeebf2] bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_#ffffffcc] sm:px-6 sm:pt-4">
          {visualState === 'connecting' ? <button onClick={onEnd} className={`min-h-14 w-full rounded-2xl bg-[#fdf0f1] text-sm font-semibold text-[#b64455] ${focusRing}`}>Cancel call</button> : visualState === 'ended' ? <div className="flex gap-2"><button onClick={onDismiss} className={`min-h-12 flex-1 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 ${focusRing}`}>Close</button><button onClick={onCallAgain} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#8060c5] text-sm font-semibold text-white ${focusRing}`}><Phone className="h-4 w-4" />Call again</button></div> : <div className="call-control-row flex items-center justify-center gap-10">
            <button onClick={onToggleMute} aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={isMuted} className={`flex min-w-20 flex-col items-center gap-2 rounded-xl text-xs font-medium ${focusRing} ${isMuted ? 'text-[#a15035]' : 'text-[#68527f]'}`}><span className={`call-control-icon flex h-14 w-14 items-center justify-center rounded-full border ${isMuted ? 'border-[#e5cebc] bg-[#fff0e6]' : 'border-[#e8e3ee] bg-[#f6f3fa]'}`}>{isMuted ? <MicOff className="h-[22px] w-[22px]" /> : <Mic className="h-[22px] w-[22px]" />}</span>{isMuted ? 'Unmute' : 'Mute'}</button>
            <button onClick={onEnd} aria-label="End call" className={`flex min-w-20 flex-col items-center gap-2 rounded-xl text-xs font-medium text-[#a74754] ${focusRing}`}><span className="call-control-icon flex h-14 w-14 items-center justify-center rounded-full bg-[#df6574] text-white shadow-[0_4px_12px_#df657426] transition active:scale-95"><PhoneOff className="h-6 w-6" /></span>End call</button>
          </div>}
          <div className="call-privacy mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" />Private, secure conversation</div>
        </footer>
      </motion.section>
    </div>
  </>;
}
