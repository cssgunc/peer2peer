// A short two-note chime made with Web Audio, so there's no sound file to ship.

let context: AudioContext | null = null;

function getContext() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  context ??= new AudioContext();
  return context;
}

/** Call from a click: browsers only let audio start after the person interacts with the page. */
export function primeAlertSound() {
  void getContext()
    ?.resume()
    .catch(() => {});
}

export function playAlertSound() {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const start = ctx.currentTime;
  for (const [frequency, offset] of [
    [880, 0],
    [660, 0.16],
  ]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.15);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.16);
  }
}
