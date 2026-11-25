let ringContext: AudioContext | null = null;
let ringInterval: number | null = null;
let activeRingOscillators: OscillatorNode[] = [];

/** Start a soft repeating two-tone ring and return a function that stops it. */
export function startRingTone(): () => void {
  stopRingTone();
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return () => undefined;

  try {
    ringContext = new AudioContextConstructor();
    void ringContext.resume();
    const context = ringContext;
    const ringBurst = () => {
      if (!ringContext || ringContext !== context || context.state === 'closed') return;
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.035);
      gain.gain.setValueAtTime(0.035, now + 0.48);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      gain.connect(context.destination);

      for (const frequency of [440, 480]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.onended = () => {
          oscillator.disconnect();
          activeRingOscillators = activeRingOscillators.filter((active) => active !== oscillator);
          if (activeRingOscillators.length === 0) gain.disconnect();
        };
        activeRingOscillators.push(oscillator);
        oscillator.start(now);
        oscillator.stop(now + 0.56);
      }
    };

    ringBurst();
    ringInterval = window.setInterval(ringBurst, 3000);
  } catch (error) {
    console.warn('Could not start ring tone', error);
    stopRingTone();
  }
  return stopRingTone;
}

export function stopRingTone() {
  if (ringInterval !== null) window.clearInterval(ringInterval);
  ringInterval = null;
  for (const oscillator of activeRingOscillators) {
    try { oscillator.stop(); } catch { /* It may already have stopped. */ }
  }
  activeRingOscillators = [];
  const context = ringContext;
  ringContext = null;
  if (context && context.state !== 'closed') void context.close();
}

/** Play a short, quiet confirmation beep after a connected call ends. */
export function playEndCallTone() {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return;
  try {
    const context = new AudioContextConstructor();
    void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      void context.close();
    };
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  } catch (error) {
    console.warn('Could not play call end tone', error);
  }
}
