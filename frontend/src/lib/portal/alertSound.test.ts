import { expect, it, vi } from "vitest";

// A minimal Web Audio stand-in that records what gets played.
const started: number[] = [];
class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 10;
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createGain() {
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: (target: unknown) => target,
    };
    return gain;
  }
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0 },
      connect: (target: unknown) => target,
      start: (at: number) => started.push(at),
      stop: vi.fn(),
    };
  }
}

it("plays a short two-note chime", async () => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  const { playAlertSound } = await import("./alertSound");

  playAlertSound();

  expect(started).toEqual([10, 10.16]);
  vi.unstubAllGlobals();
});
