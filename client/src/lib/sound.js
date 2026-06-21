let audioContextInstance = null;

const getAudioContext = () => {
  if (typeof window === "undefined") return null;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioContextInstance) {
    audioContextInstance = new AudioContextClass();
  }

  if (audioContextInstance.state === "suspended") {
    audioContextInstance.resume().catch(() => {});
  }

  return audioContextInstance;
};

const playTone = ({ frequency, durationMs, gain = 0.05, type = "sine" }) => {
  const context = getAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);

  gainNode.gain.setValueAtTime(gain, context.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(
    0.0001,
    context.currentTime + durationMs / 1000
  );

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + durationMs / 1000);
};

export const playSendSound = () => {
  playTone({ frequency: 650, durationMs: 80, gain: 0.045, type: "triangle" });
  setTimeout(() => {
    playTone({ frequency: 820, durationMs: 70, gain: 0.03, type: "triangle" });
  }, 45);
};

export const playReceiveSound = () => {
  playTone({ frequency: 440, durationMs: 95, gain: 0.05, type: "sine" });
};
