import { useEffect, useRef } from 'react';
import { Activity, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WSMessage } from '../types';

/** Displays live transcript, tool result, and call state events. */
export function TranscriptPanel({ messages, state }: { messages: WSMessage[]; state: 'idle' | 'connecting' | 'connected' | 'ended' }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const callerName = [...messages].reverse().find((message) => message.type === 'caller_identity')?.name;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return <div className="max-h-[340px] min-h-24 space-y-3 overflow-y-auto px-4 py-4 sm:px-5" aria-label="Call transcript" aria-live="polite" aria-relevant="additions text">
    {messages.length === 0 && <p className="py-5 text-center text-sm text-slate-500">{state === 'connecting' ? 'Connecting securely. Please wait…' : state === 'connected' ? 'You’re connected. Say hello to Ava when you’re ready.' : 'Your conversation will appear here.'}</p>}
    <AnimatePresence initial={false}>{messages.map((message, index) => {
      if (message.type === 'transcript') {
        const isUser = message.role === 'user';
        return <motion.div key={`${message.timestamp}-${index}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }} className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-6 shadow-sm sm:max-w-[75%] ${isUser ? 'rounded-br-md bg-[#7657cf] text-white' : 'rounded-bl-md border border-slate-100 bg-[#f7f7fa] text-[#252737]'}`}><p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${isUser ? 'text-violet-100' : 'text-[#7654c4]'}`}>{isUser ? callerName || 'You' : 'Ava'}</p><p>{message.text}</p><time dateTime={message.timestamp} title={new Date(message.timestamp).toLocaleString()} className={`mt-1 block text-right text-[10px] opacity-0 transition-opacity group-hover:opacity-70 ${isUser ? 'text-white' : 'text-slate-500'}`}>{new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
        </motion.div>;
      }
      if (message.type === 'tool_call') return <motion.div key={`${message.timestamp}-${index}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-[90%] items-start gap-2 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2.5 text-xs text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7654c4]" /><p><span className="font-semibold capitalize text-[#6243ad]">{message.tool.replaceAll('_', ' ')}</span><span className="mx-1">·</span>{String(message.result.message ?? 'Completed')}</p></motion.div>;
      if (message.type === 'call_state') return <p key={`${message.timestamp}-${index}`} className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400"><Activity className="h-3 w-3" />{message.state === 'connected' ? 'Call connected' : 'Call ended'}</p>;
      return null;
    })}</AnimatePresence>
    <div ref={bottomRef} />
  </div>;
}
