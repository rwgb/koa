import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_ENABLED = 'koa.voice.enabled';
const TOKEN_KEY = 'koa_web_token';

function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'code block omitted')
    .replace(/[*_`#>]/g, '')
    .slice(0, 500);
}

function getAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export interface VoiceState {
  speak: (text: string) => void;
  stop: () => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  available: boolean;
}

export function useSpeech(): VoiceState {
  const [enabled, setEnabledRaw] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_ENABLED) !== 'false'; } catch { return false; }
  });

  const [available, setAvailable] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/voice/tts-status', { headers: getAuthHeaders() })
      .then(res => res.ok ? res.json() : { available: false })
      .then((data: { available: boolean }) => {
        if (!cancelled) setAvailable(!!data.available);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => { cancelled = true; };
  }, []);

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    revokeCurrentUrl();
  }, [revokeCurrentUrl]);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledRaw(v);
    try { localStorage.setItem(STORAGE_ENABLED, String(v)); } catch { /* ignore */ }
    if (!v) stop();
  }, [stop]);

  const speak = useCallback(async (raw: string) => {
    if (!enabled || !available) return;
    const text = cleanText(raw);
    if (!text) return;

    // Cancel any currently playing audio
    stop();

    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        if (res.status === 503) setAvailable(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener('ended', () => {
        audioRef.current = null;
        revokeCurrentUrl();
      }, { once: true });

      audio.play().catch(() => {
        audioRef.current = null;
        revokeCurrentUrl();
      });
    } catch {
      // Network error — ignore silently
    }
  }, [enabled, available, stop, revokeCurrentUrl]);

  return { speak, stop, enabled, setEnabled, available };
}
