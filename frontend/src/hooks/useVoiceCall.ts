import { useCallback, useEffect, useRef, useState } from 'react';
import type { WSMessage } from '../types';

export type VoiceCallState = 'idle' | 'connecting' | 'connected' | 'ended';

function pcm16ToFloat32(buffer: ArrayBuffer) {
  const samples = new Int16Array(buffer);
  const decoded = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) decoded[i] = samples[i] / 32768;
  return decoded;
}

export function useVoiceCall() {
  const [state, setState] = useState<VoiceCallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [audioAnalyser, setAudioAnalyser] = useState<AnalyserNode | null>(null);
  const [microphoneAnalyser, setMicrophoneAnalyser] = useState<AnalyserNode | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const mutedRef = useRef(false);
  const callStartedAtRef = useRef<number | null>(null);
  const sessionIdRef = useRef(0);
  const playbackChunksRef = useRef(0);
  const autoEndRequestedRef = useRef(false);
  const assistantResponseAudioStartedRef = useRef(false);
  const autoEndFallbackTimerRef = useRef<number | null>(null);

  const cleanup = useCallback((closeSocket: boolean) => {
    if (autoEndFallbackTimerRef.current !== null) {
      window.clearTimeout(autoEndFallbackTimerRef.current);
      autoEndFallbackTimerRef.current = null;
    }
    autoEndRequestedRef.current = false;
    assistantResponseAudioStartedRef.current = false;
    const socket = socketRef.current;
    socketRef.current = null;
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Call ended');
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    microphoneAnalyserRef.current?.disconnect();
    microphoneAnalyserRef.current = null;
    setAudioAnalyser(null);
    setMicrophoneAnalyser(null);
    playbackChunksRef.current = 0;
    setIsAssistantSpeaking(false);
    if (context && context.state !== 'closed') void context.close();
    callStartedAtRef.current = null;
  }, []);

  const endCall = useCallback((clearTranscript = false) => {
    sessionIdRef.current += 1;
    cleanup(true);
    setIsMuted(false);
    mutedRef.current = false;
    if (clearTranscript) setMessages([]);
    setState('ended');
  }, [cleanup]);

  const resetCall = useCallback(() => {
    sessionIdRef.current += 1;
    cleanup(true);
    setError(null);
    setMessages([]);
    setIsMuted(false);
    mutedRef.current = false;
    setDurationSeconds(0);
    setState('idle');
  }, [cleanup]);

  const startCall = useCallback(async ({ preserveMessages = false }: { preserveMessages?: boolean } = {}) => {
    const sessionId = ++sessionIdRef.current;
    cleanup(true);
    setError(null);
    if (!preserveMessages) setMessages([]);
    setIsMuted(false);
    mutedRef.current = false;
    setDurationSeconds(0);
    setState('connecting');

    let socket: WebSocket | null = null;
    let context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable. Use a secure connection and allow microphone access.');
      }

      // Start/resume audio during the button gesture to satisfy browser autoplay rules.
      context = new AudioContext({ sampleRate: 16000 });
      contextRef.current = context;
      await context.resume();
      if (sessionIdRef.current !== sessionId) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      analyser.connect(context.destination);
      analyserRef.current = analyser;
      setAudioAnalyser(analyser);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (permissionError) {
        const name = permissionError instanceof DOMException ? permissionError.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw new Error('Microphone access was denied. Allow microphone access in your browser and try again.');
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          throw new Error('No microphone was found. Connect a microphone and try again.');
        }
        throw permissionError;
      }
      if (sessionIdRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const input = context.createMediaStreamSource(stream);
      const microphoneAnalyser = context.createAnalyser();
      microphoneAnalyser.fftSize = 128;
      microphoneAnalyser.smoothingTimeConstant = 0.72;
      microphoneAnalyserRef.current = microphoneAnalyser;
      setMicrophoneAnalyser(microphoneAnalyser);
      input.connect(microphoneAnalyser);

      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${scheme}//${window.location.host}/ws/voice`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onmessage = async (event: MessageEvent<ArrayBuffer | Blob | string>) => {
        try {
          if (sessionIdRef.current !== sessionId) return;
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data) as WSMessage | { type: 'error'; message: string };
            if (message.type === 'error') {
              setError(message.message);
              return;
            }
            if (message.type === 'call_action' && message.action === 'end_after_response') {
              autoEndRequestedRef.current = true;
              if (autoEndFallbackTimerRef.current !== null) window.clearTimeout(autoEndFallbackTimerRef.current);
              // The goodbye audio can finish before the tool event reaches the
              // browser. In that case the queue is already drained, so hang up.
              if (assistantResponseAudioStartedRef.current && playbackChunksRef.current === 0) {
                endCall(true);
                return;
              }
              autoEndFallbackTimerRef.current = window.setTimeout(() => {
                if (autoEndRequestedRef.current) endCall(true);
              }, 8000);
              return;
            }
            if (message.type === 'call_state') {
              if (message.state === 'connected') {
                callStartedAtRef.current ??= Date.now();
                setState('connected');
              } else {
                cleanup(false);
                setState('ended');
              }
            }
            if (message.type === 'transcript' && message.role === 'user') {
              // Track assistant playback per caller turn, so a previous reply
              // cannot make the next farewell look already played.
              assistantResponseAudioStartedRef.current = false;
            }
            if (message.type === 'transcript' && message.role === 'assistant' && /thank you for calling[\s\S]*take care/i.test(message.text)) {
              // Fall back to the explicit farewell when a provider omits the
              // call_action event. The normal tool event remains the primary path.
              autoEndRequestedRef.current = true;
              if (assistantResponseAudioStartedRef.current && playbackChunksRef.current === 0) {
                endCall(true);
                return;
              }
              if (autoEndFallbackTimerRef.current !== null) window.clearTimeout(autoEndFallbackTimerRef.current);
              autoEndFallbackTimerRef.current = window.setTimeout(() => {
                if (autoEndRequestedRef.current) endCall(true);
              }, 8000);
            }
            if (message.type === 'transcript' || message.type === 'tool_call' || message.type === 'call_state' || message.type === 'caller_identity') {
              setMessages((current) => [...current, message]);
            }
            return;
          }
          const audioContext = contextRef.current;
          if (!audioContext) return;
          const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
          if (!(data instanceof ArrayBuffer) || data.byteLength < 2 || data.byteLength % 2 !== 0) return;
          if (audioContext.state !== 'running') await audioContext.resume();

          const audio = audioContext.createBuffer(1, data.byteLength / 2, 16000);
          audio.copyToChannel(pcm16ToFloat32(data), 0);
          const player = audioContext.createBufferSource();
          player.buffer = audio;
          const outputAnalyser = analyserRef.current;
          if (outputAnalyser) {
            player.connect(outputAnalyser);
          } else {
            player.connect(audioContext.destination);
          }
          const startAt = Math.max(audioContext.currentTime, nextPlaybackTimeRef.current);
          playbackChunksRef.current += 1;
          assistantResponseAudioStartedRef.current = true;
          if (autoEndFallbackTimerRef.current !== null) {
            window.clearTimeout(autoEndFallbackTimerRef.current);
            autoEndFallbackTimerRef.current = null;
          }
          setIsAssistantSpeaking(true);
          player.onended = () => {
            playbackChunksRef.current = Math.max(0, playbackChunksRef.current - 1);
            if (playbackChunksRef.current === 0) {
              setIsAssistantSpeaking(false);
              if (autoEndRequestedRef.current && assistantResponseAudioStartedRef.current) endCall(true);
            }
          };
          player.start(startAt);
          nextPlaybackTimeRef.current = startAt + audio.duration;
        } catch (playbackError) {
          console.error('Could not handle assistant WebSocket message', playbackError);
          setError('The assistant audio could not be played. Check your output device and browser audio permissions.');
        }
      };

      await new Promise<void>((resolve, reject) => {
        let opened = false;
        socket!.onopen = () => {
          if (sessionIdRef.current !== sessionId) {
            socket!.close();
            reject(new Error('Call was ended before connecting.'));
            return;
          }
          opened = true;
          resolve();
        };
        socket!.onerror = () => {
          if (!opened) reject(new Error('Could not connect to the voice server. Check that the backend is running.'));
        };
        socket!.onclose = (event) => {
          if (!opened) {
            reject(new Error('The voice server closed before the call connected.'));
            return;
          }
          if (sessionIdRef.current !== sessionId || socketRef.current !== socket) return;
          cleanup(false);
          if (!event.wasClean && event.code !== 1000) setError('The voice server closed unexpectedly. Check the backend terminal for its error.');
          setState('ended');
        };
      });

      if (sessionIdRef.current !== sessionId) return;
      callStartedAtRef.current = Date.now();
      setState('connected');
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      microphoneAnalyser.connect(silentGain);
      processor.onaudioprocess = (audioEvent) => {
        const activeSocket = socketRef.current;
        const activeContext = contextRef.current;
        if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || mutedRef.current || !activeContext) return;
        const samples = audioEvent.inputBuffer.getChannelData(0);
        const outputLength = Math.floor((samples.length * 16000) / activeContext.sampleRate);
        const pcm = new Int16Array(outputLength);
        for (let i = 0; i < outputLength; i += 1) {
          const position = (i * activeContext.sampleRate) / 16000;
          const left = Math.floor(position);
          const fraction = position - left;
          const sample = samples[left] * (1 - fraction) + (samples[left + 1] ?? samples[left]) * fraction;
          pcm[i] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767);
        }
        activeSocket.send(pcm.buffer);
      };
      input.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      sourceRef.current = input;
      processorRef.current = processor;
      silentGainRef.current = silentGain;
    } catch (startError) {
      if (sessionIdRef.current !== sessionId) return;
      cleanup(true);
      setError(startError instanceof Error ? startError.message : 'Unable to start the voice call.');
      setState('ended');
    }
  }, [cleanup, endCall]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      mutedRef.current = !current;
      return !current;
    });
  }, []);

  useEffect(() => {
    if (state !== 'connected') return;
    const updateDuration = () => {
      if (callStartedAtRef.current !== null) setDurationSeconds(Math.floor((Date.now() - callStartedAtRef.current) / 1000));
    };
    updateDuration();
    const timer = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => () => {
    sessionIdRef.current += 1;
    cleanup(true);
  }, [cleanup]);

  return { state, error, messages, isMuted, durationSeconds, audioAnalyser, microphoneAnalyser, isAssistantSpeaking, startCall, endCall, toggleMute, resetCall };
}
