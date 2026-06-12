import { useCallback, useRef } from 'react';
import { useAgent } from '../context/AgentContext.js';
import { synthesizeSpeech } from '../api.js';

function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/[*_`#>]/g, '')
    .slice(0, 500);
}

export function useSpeech(): { speak: (text: string) => void; stop: () => void } {
  const { agentStatus } = useAgent();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const speak = useCallback((raw: string) => {
    const text = cleanText(raw);
    if (!text) return;
    stop();

    const provider = agentStatus?.ttsProvider;

    if (!provider || provider === 'none') {
      // Browser-side TTS via Web Speech API (used on Linux/headless servers).
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
      return;
    }

    // Server-side TTS (say or elevenlabs).
    synthesizeSpeech(text)
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; };
        audio.play().catch(() => { URL.revokeObjectURL(url); });
      })
      .catch(() => {
        // Server TTS failed — fall back to browser speech.
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        }
      });
  }, [agentStatus?.ttsProvider, stop]);

  return { speak, stop };
}
