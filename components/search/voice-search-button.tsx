'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  VOICE_LANGUAGES,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speakText,
  voiceLanguageByCode,
  type SpeechRecognitionInstance,
} from '@/lib/voice-languages';

/**
 * Browser-native voice input layer (Web Speech API only — no server
 * STT, no key, no audio leaves the device).
 *
 * - The transcript is shown as text and handed to the parent, which
 *   runs it through the SAME search path as typed input.
 * - Recognition quality depends on the user's browser/OS: the UI says
 *   so plainly, offers a language picker, and always leaves typed
 *   input available. An unsupported browser or a denied mic degrades
 *   to typed input with a plain note — never a fake transcript and
 *   never a spinner pretending to listen.
 */
export function VoiceSearchButton({
  onTranscript,
  disabled,
}: {
  /** Called with the final transcript + chosen language; the parent runs a normal search with it. */
  onTranscript: (text: string, langCode: string) => void;
  disabled?: boolean;
}) {
  const [supported] = useState(() => isSpeechRecognitionSupported());
  const [listening, setListening] = useState(false);
  const [langCode, setLangCode] = useState('en-US');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalRef = useRef('');

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped — ignore.
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore teardown errors.
      }
      if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  function toggleListening() {
    if (listening) {
      stopListening();
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setError(
        'Voice input is not supported in this browser — please type your search instead.'
      );
      return;
    }
    setError(null);
    setInterim('');
    finalRef.current = '';
    recognition.lang = langCode;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event: unknown) => {
      const e = event as {
        results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number };
        resultIndex: number;
      };
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i] as ArrayLike<{ transcript: string }> & {
          isFinal?: boolean;
        };
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalRef.current += text;
        } else {
          interimText += text;
        }
      }
      setInterim(interimText);
    };
    recognition.onerror = (event: unknown) => {
      const e = event as { error?: string };
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone permission was denied — please type your search instead.');
      } else if (e.error === 'no-speech') {
        setError('No speech was heard — try again or type your search.');
      } else if (e.error === 'audio-capture') {
        setError('No microphone was found — please type your search instead.');
      } else {
        setError('Voice input failed — please type your search instead.');
      }
      stopListening();
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const text = finalRef.current.trim();
      if (text) {
        setInterim('');
        onTranscript(text, langCode);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('Voice input could not start — please type your search instead.');
      recognitionRef.current = null;
    }
  }

  const lang = voiceLanguageByCode(langCode);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Select value={langCode} onValueChange={setLangCode}>
          <SelectTrigger aria-label="Voice language" className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICE_LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={listening ? 'destructive' : 'outline'}
          onClick={toggleListening}
          disabled={disabled || !supported}
          title={
            supported
              ? 'Speak your search'
              : 'Voice input is not supported in this browser'
          }
        >
          {listening ? (
            <MicOff className="mr-2 h-4 w-4" />
          ) : (
            <Mic className="mr-2 h-4 w-4" />
          )}
          {listening ? 'Stop' : 'Voice'}
        </Button>
      </div>
      {!supported && (
        <p className="text-xs text-muted-foreground">
          Voice input is not supported in this browser — type your search instead.
        </p>
      )}
      {listening && (
        <p className="text-xs text-blue-600" role="status">
          Listening… {interim ? `“${interim}”` : 'speak now'}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {lang.note && <p className="text-xs text-muted-foreground">{lang.note}</p>}
      <p className="text-xs text-muted-foreground">
        Voice recognition runs in your browser and quality varies by browser and accent —
        if it mishears you, just type instead.
      </p>
    </div>
  );
}

/** Spoken reply for a completed voice search (same language as input). */
export function speakSearchSummary(resultCount: number, langCode: string): void {
  speakText(
    resultCount === 1
      ? 'Found 1 product.'
      : `Found ${resultCount} products.`,
    langCode
  );
}
