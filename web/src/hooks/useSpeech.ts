import { useState, useEffect, useCallback } from 'react';

const STORAGE_ENABLED = 'koa.voice.enabled';
const STORAGE_VOICE = 'koa.voice.name';

function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/[*_`#>]/g, '')
    .slice(0, 600);
}

function getEnglishVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
}

export interface VoiceState {
  speak: (text: string) => void;
  stop: () => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  voices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  setSelectedVoiceName: (name: string) => void;
}

export function useSpeech(): VoiceState {
  const [enabled, setEnabledRaw] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_ENABLED) !== 'false'; } catch { return false; }
  });

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [selectedVoiceName, setSelectedVoiceNameRaw] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_VOICE) ?? ''; } catch { return ''; }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const update = () => setVoices(getEnglishVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledRaw(v);
    try { localStorage.setItem(STORAGE_ENABLED, String(v)); } catch { /* ignore */ }
    if (!v && typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  const setSelectedVoiceName = useCallback((name: string) => {
    setSelectedVoiceNameRaw(name);
    try { localStorage.setItem(STORAGE_VOICE, name); } catch { /* ignore */ }
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  const speak = useCallback((raw: string) => {
    if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    const text = cleanText(raw);
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const currentVoices = getEnglishVoices();
    const voice = currentVoices.find(v => v.name === selectedVoiceName) ?? currentVoices[0];
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }, [enabled, selectedVoiceName]);

  return { speak, stop, enabled, setEnabled, voices, selectedVoiceName, setSelectedVoiceName };
}
