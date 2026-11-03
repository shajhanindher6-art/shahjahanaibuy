/**
 * Voice language table for the browser-native Web Speech API layer.
 *
 * HONESTY RULES:
 * - Recognition and synthesis run ENTIRELY in the user's browser/OS
 *   (SpeechRecognition + speechSynthesis). No audio is sent to any
 *   server, no STT key exists, and SmartBuy cannot make a browser
 *   understand a language or accent it does not support — the UI
 *   must say quality varies by browser and always offer typed input.
 * - Roman Urdu is spoken as Urdu: the BCP-47 code is ur-PK and the
 *   UI notes that results for Roman Urdu may vary, because browsers
 *   recognise spoken Urdu, not a separate "Roman Urdu" acoustic model.
 * - This module never fabricates a transcript: when recognition is
 *   unavailable or the mic is denied, callers must fall back to text.
 */

export interface VoiceLanguage {
  /** BCP-47 code used for both recognition (lang) and synthesis (utterance.lang). */
  code: string;
  /** Label shown in the picker. */
  label: string;
  /** Short honest note shown under the picker for this language, if any. */
  note?: string;
}

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: 'en-US', label: 'English' },
  {
    code: 'ur-PK',
    label: 'Roman Urdu',
    note: 'Spoken as Urdu (ur-PK) — browsers have no separate Roman Urdu voice model, so recognition may vary.',
  },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese' },
  { code: 'tr-TR', label: 'Turkish' },
];

export function voiceLanguageByCode(code: string): VoiceLanguage {
  return VOICE_LANGUAGES.find((l) => l.code === code) ?? VOICE_LANGUAGES[0];
}

/** True only in a browser that exposes SpeechRecognition (incl. webkit prefix). */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** True only in a browser that exposes speechSynthesis. */
export function isSpeechSynthesisSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window;
}

export interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

/** Creates a recognition instance, or null when the browser lacks the API. */
export function createSpeechRecognition(): SpeechRecognitionInstance | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionInstance)
    | undefined;
  if (!Ctor) return null;
  return new Ctor();
}

/** Speaks text in the given language. No-op when synthesis is unavailable. */
export function speakText(text: string, langCode: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Synthesis failure must never break search — voice is an enhancement.
  }
}
