import { useEffect, useRef } from 'react';

/** Draws the live time-domain audio signal from the active call audio source. */
export function AudioWaveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let animationFrame = 0;
    const bars = 13;
    const timeData = analyser ? new Uint8Array(analyser.fftSize) : null;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      context.clearRect(0, 0, width, height);
      if (active && analyser && timeData) analyser.getByteTimeDomainData(timeData);
      const gap = 2;
      const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
      const gradient = context.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
      gradient.addColorStop(1, '#ffffff');
      context.fillStyle = gradient;

      for (let index = 0; index < bars; index += 1) {
        const start = Math.floor((index / bars) * (timeData?.length ?? 0));
        const end = Math.max(start + 1, Math.floor(((index + 1) / bars) * (timeData?.length ?? 0)));
        let squaredTotal = 0;
        if (active && timeData) {
          for (let sample = start; sample < end; sample += 1) {
            const normalized = ((timeData[sample] ?? 128) - 128) / 128;
            squaredTotal += normalized * normalized;
          }
        }
        const rms = active && timeData ? Math.sqrt(squaredTotal / Math.max(1, end - start)) : 0;
        const idleHeight = active ? 4 : 3;
        const barHeight = Math.min(height - 2, Math.max(idleHeight, rms * height * 2.4));
        const x = index * (barWidth + gap);
        context.beginPath();
        context.roundRect(x, (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
        context.fill();
      }
      if (!reduceMotion) animationFrame = window.requestAnimationFrame(draw);
    };

    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [active, analyser]);

  return <canvas ref={canvasRef} className="h-10 w-14" role="img" aria-label={active ? 'Live call audio waveform' : 'Audio waveform idle'} />;
}
