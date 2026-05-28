"use client";

import { useEffect, useRef, useState } from "react";

function MicIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 12.5a3 3 0 0 0 3-3v-4a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z" />
      <path d="M5.5 9a.75.75 0 0 1 1.5 0 3 3 0 0 0 6 0 .75.75 0 0 1 1.5 0 4.5 4.5 0 0 1-3.75 4.437V15h2a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5h2v-1.563A4.5 4.5 0 0 1 5.5 9z" />
    </svg>
  );
}

function StopIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="10" height="10" rx="1.5" />
    </svg>
  );
}

/**
 * Dictation button that uses the browser's Web Speech API.
 *
 * Props:
 *   getBaseText: () => string  — returns the current text the user has typed so far
 *   onTranscript: (newText: string) => void  — called with base + final + interim
 *   lang: string  — defaults to "he-IL"
 *
 * The component captures the base text on start, then on every recognition update
 * it sends back: base + finalized speech + in-progress speech, so the field stays
 * in sync with what the user already typed PLUS new dictation.
 */
export default function VoiceButton({
  getBaseText,
  onTranscript,
  lang = "he-IL",
  size = "sm",
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    setSupported(!!SR);
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  function start() {
    const SR =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SR) {
      alert(
        "הדפדפן הזה לא תומך בהקלטה. נסי להשתמש ב-Chrome / Edge / Safari על מובייל.",
      );
      return;
    }

    const base = (getBaseText ? getBaseText() : "") || "";

    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const txt = e.results[i][0]?.transcript || "";
        if (e.results[i].isFinal) final += txt + " ";
        else interim += txt;
      }
      const sep = base && !base.endsWith(" ") && !base.endsWith("\n") ? " " : "";
      onTranscript(base + sep + final + interim);
    };

    r.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    r.onerror = (e) => {
      console.error("[voice] error:", e);
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        alert(
          "אין הרשאה למיקרופון. אפשרי בהגדרות הדפדפן (אייקון נעילה ליד הכתובת).",
        );
      } else if (e.error === "no-speech") {
        // common when user stays silent — no popup
      } else if (e.error === "audio-capture") {
        alert("לא נמצא מיקרופון. ודאי שהוא מחובר ופועל.");
      } else if (e.error === "network") {
        alert("שגיאת רשת. ה-Speech API דורש אינטרנט פעיל.");
      } else {
        alert("שגיאה בהקלטה: " + e.error);
      }
    };

    recognitionRef.current = r;
    setListening(true);
    try {
      r.start();
    } catch (err) {
      console.error("[voice] start failed:", err);
      setListening(false);
      alert("לא ניתן להתחיל הקלטה: " + err.message);
    }
  }

  function stop() {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setListening(false);
  }

  if (!supported) {
    return null; // hide button on unsupported browsers (e.g. Firefox)
  }

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      className={
        "inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors " +
        (listening
          ? "bg-red-100 text-red-700 border-red-300 animate-pulse"
          : "bg-white text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700")
      }
      title={listening ? "לחיצה לעצירת ההקלטה" : "הקלטה דרך מיקרופון"}
      aria-label={listening ? "עצירת הקלטה" : "התחלת הקלטה"}
    >
      {listening ? <StopIcon /> : <MicIcon />}
    </button>
  );
}
