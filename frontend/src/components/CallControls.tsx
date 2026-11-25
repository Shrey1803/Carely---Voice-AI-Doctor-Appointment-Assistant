import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import type { VoiceCallState } from '../hooks/useVoiceCall';

interface CallControlsProps {
  state: VoiceCallState;
  isMuted: boolean;
  durationSeconds: number;
  compact?: boolean;
  onStart: () => void;
  onOpenCall?: () => void;
  onToggleMute: () => void;
  onEnd: () => void;
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Renders call start, mute, duration, and end controls. */
export function CallControls({ state, isMuted, durationSeconds, compact = false, onStart, onOpenCall, onToggleMute, onEnd }: CallControlsProps) {
  if (compact) {
    const isConnected = state === 'connected';
    if (onOpenCall && (isConnected || state === 'connecting')) {
      return <div className="flex items-center gap-1.5">
        {isConnected && <span className="hidden font-mono text-xs tabular-nums text-slate-500 sm:inline">{formatDuration(durationSeconds)}</span>}
        <button onClick={onOpenCall} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#7657cf] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6747c2] sm:px-4"><Phone className="h-4 w-4" />{state === 'connecting' ? 'Connecting…' : 'Return to call'}</button>
        {isConnected && <button onClick={onEnd} aria-label="End call" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#b84f68] text-white transition hover:bg-[#a9425b]"><PhoneOff className="h-4 w-4" /></button>}
      </div>;
    }
    return <button onClick={isConnected ? onEnd : onStart} disabled={state === 'connecting'} className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px disabled:opacity-60 sm:px-4 ${isConnected ? 'bg-[#b84f68] hover:bg-[#a9425b]' : 'bg-[#7657cf] hover:bg-[#6747c2]'}`}>
      {isConnected ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}{state === 'connecting' ? 'Connecting…' : isConnected ? 'End call' : state === 'ended' ? 'New call' : 'Try call'}
    </button>;
  }

  return <div className="flex items-center gap-2">
    {state === 'idle' && <button onClick={onStart} className="flex min-h-11 items-center gap-2 rounded-lg bg-[#7657cf] px-4 text-sm font-semibold text-white hover:bg-[#6747c2]"><Phone className="h-4 w-4" />Try call</button>}
    {state === 'connecting' && <><span className="flex min-h-10 items-center gap-2 px-2 text-sm text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />Connecting…</span><button onClick={onEnd} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button></>}
    {state === 'connected' && <><span className="mr-1 font-mono text-sm font-medium tabular-nums text-slate-600">{formatDuration(durationSeconds)}</span><button onClick={onToggleMute} aria-pressed={isMuted} className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${isMuted ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{isMuted ? 'Unmute' : 'Mute'}</button><button onClick={onEnd} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#b84f68] px-3 text-sm font-semibold text-white hover:bg-[#a9425b]"><PhoneOff className="h-4 w-4" />End call</button></>}
    {state === 'ended' && <><span className="text-sm text-slate-500">Call ended</span><button onClick={onStart} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#7657cf] px-3 text-sm font-semibold text-white hover:bg-[#6747c2]"><Phone className="h-4 w-4" />New call</button></>}
  </div>;
}
