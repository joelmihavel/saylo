"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type TranscriptionMode = "mic" | "file";
type Language = "en" | "hi" | "auto";

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  hi: "Hindi / Hinglish",
  auto: "Auto-detect",
};

const CHUNK_DURATION = 30;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++)
      view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export default function Home() {
  const [mode, setMode] = useState<TranscriptionMode>("mic");
  const [language, setLanguage] = useState<Language>("auto");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [fileName, setFileName] = useState("");
  const [detectedLang, setDetectedLang] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const startMicRecording = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatus("Web Speech API not supported. Please use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    if (language === "hi") {
      recognition.lang = "hi-IN";
    } else if (language === "en") {
      recognition.lang = "en-US";
    } else {
      recognition.lang = "hi-IN";
    }

    let finalTranscript = transcript;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        setStatus(`Mic error: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setStatus("Listening...");
  }, [language, transcript]);

  const stopMicRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    setStatus("");
  }, []);

  const transcribeFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setProgress(0);
      setStatus("Decoding audio...");
      setTranscript("");
      setDetectedLang("");
      setDuration(null);
      abortRef.current = false;

      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const fullSamples = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const totalDuration = audioBuffer.duration;
        await audioCtx.close();

        const chunkSamples = CHUNK_DURATION * sampleRate;
        const totalChunks = Math.ceil(fullSamples.length / chunkSamples);

        let fullText = "";
        let lang = "";

        for (let i = 0; i < totalChunks; i++) {
          if (abortRef.current) break;

          const start = i * chunkSamples;
          const end = Math.min(start + chunkSamples, fullSamples.length);
          const chunk = fullSamples.slice(start, end);

          setStatus(
            `Transcribing chunk ${i + 1} of ${totalChunks}...`
          );
          setProgress(Math.round((i / totalChunks) * 100));

          const wavBlob = encodeWav(chunk, sampleRate);
          const formData = new FormData();
          formData.append(
            "audio",
            new File([wavBlob], `chunk-${i}.wav`, { type: "audio/wav" })
          );
          if (language !== "auto") {
            formData.append("language", language);
          }

          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Transcription failed");
          }

          const data = await res.json();
          if (data.text) {
            fullText += (fullText ? " " : "") + data.text;
            setTranscript(fullText);
          }
          if (data.language && !lang) {
            lang = data.language;
            setDetectedLang(lang);
          }
        }

        setDuration(Math.round(totalDuration));
        setProgress(100);
        setStatus("Done!");
      } catch (err) {
        setStatus(
          `Error: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [language]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      transcribeFile(file);
    }
  };

  const cancelProcessing = () => {
    abortRef.current = true;
    setIsProcessing(false);
    setStatus("Cancelled");
    setProgress(0);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(transcript);
    setStatus("Copied to clipboard!");
    setTimeout(() => setStatus(""), 2000);
  };

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex flex-1 w-full max-w-2xl flex-col gap-6 py-12 px-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Saylo
          </h1>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            Transcribe audio to text — English, Hindi & Hinglish
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          <button
            onClick={() => {
              setMode("mic");
              stopMicRecording();
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "mic"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            Microphone
          </button>
          <button
            onClick={() => {
              setMode("file");
              stopMicRecording();
            }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "file"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            Upload File
          </button>
        </div>

        {/* Language Selector */}
        <div className="flex gap-2">
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                language === lang
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              {LANGUAGE_LABELS[lang]}
            </button>
          ))}
        </div>

        {/* Mic Mode */}
        {mode === "mic" && (
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={isRecording ? stopMicRecording : startMicRecording}
              className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-colors ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-300"
              }`}
            >
              {isRecording && (
                <span className="absolute inset-0 rounded-full bg-red-400 animate-pulse-ring" />
              )}
              {isRecording ? (
                <svg
                  className="h-8 w-8 text-white"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg
                  className="h-8 w-8 text-white dark:text-zinc-900"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </button>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {isRecording ? "Tap to stop" : "Tap to start recording"}
            </p>
          </div>
        )}

        {/* File Mode */}
        {mode === "file" && (
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 p-8 transition-colors hover:border-zinc-400 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50"
            >
              <svg
                className="h-10 w-10 text-zinc-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                {fileName || "Choose an audio file"}
              </span>
              <span className="text-xs text-zinc-400">
                MP3, WAV, M4A, WEBM, OGG
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        )}

        {/* Progress Bar */}
        {isProcessing && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {status}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {progress}%
                </span>
                <button
                  onClick={cancelProcessing}
                  className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all duration-300 dark:bg-zinc-100"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Status (non-processing) */}
        {status && !isProcessing && (
          <div
            className={`rounded-lg px-4 py-2 text-sm ${
              status.startsWith("Error")
                ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            }`}
          >
            {status}
          </div>
        )}

        {/* Transcript */}
        {transcript && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Transcript
                </h2>
                {(detectedLang || duration) && (
                  <span className="text-xs text-zinc-400">
                    {detectedLang && `Language: ${detectedLang}`}
                    {detectedLang && duration && " · "}
                    {duration && `${duration}s`}
                  </span>
                )}
              </div>
              <button
                onClick={copyToClipboard}
                className="rounded-md px-3 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Copy
              </button>
            </div>
            <div className="min-h-[120px] rounded-xl bg-white p-4 text-sm leading-relaxed text-zinc-800 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
              {transcript}
            </div>
          </div>
        )}

        {transcript && !isProcessing && (
          <button
            onClick={() => {
              setTranscript("");
              setFileName("");
              setStatus("");
              setDetectedLang("");
              setDuration(null);
              setProgress(0);
            }}
            className="self-center rounded-md px-4 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Clear
          </button>
        )}
      </main>

      <footer className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
        Powered by Whisper large-v3 via Groq
      </footer>
    </div>
  );
}
