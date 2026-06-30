"use client";

import { useState, useRef, useCallback } from "react";

type Language = "en" | "hi" | "auto";
type ActiveTab = "transcript" | "summary";

interface Segment {
  start: number;
  end: number;
  text: string;
}

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  hi: "Hindi / Hinglish",
  auto: "Auto-detect",
};

const CHUNK_DURATION = 30;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

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
  const [language, setLanguage] = useState<Language>("auto");
  const [activeTab, setActiveTab] = useState<ActiveTab>("transcript");
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [fileName, setFileName] = useState("");
  const [detectedLang, setDetectedLang] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  const transcribeFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setProgress(0);
      setStatus("Decoding audio...");
      setSegments([]);
      setDetectedLang("");
      setDuration(null);
      setActiveTab("transcript");
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

        let allSegments: Segment[] = [];
        let lang = "";

        for (let i = 0; i < totalChunks; i++) {
          if (abortRef.current) break;

          const start = i * chunkSamples;
          const end = Math.min(start + chunkSamples, fullSamples.length);
          const chunk = fullSamples.slice(start, end);
          const chunkOffset = i * CHUNK_DURATION;

          setStatus(`Transcribing ${i + 1} of ${totalChunks}...`);
          setProgress(Math.round((i / totalChunks) * 100));

          const wavBlob = encodeWav(chunk, sampleRate);
          const formData = new FormData();
          formData.append(
            "audio",
            new File([wavBlob], `chunk-${i}.wav`, { type: "audio/wav" })
          );
          formData.append("chunkOffset", chunkOffset.toString());
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
          if (data.segments?.length) {
            allSegments = [...allSegments, ...data.segments];
            setSegments(allSegments);
          }
          if (data.language && !lang) {
            lang = data.language;
            setDetectedLang(lang);
          }
        }

        setDuration(Math.round(totalDuration));
        setProgress(100);
        setStatus("");
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

  const fullText = segments.map((s) => s.text).join(" ");

  const copyToClipboard = () => {
    const formatted = segments
      .map((s) => `[${formatTime(s.start)}] ${s.text}`)
      .join("\n");
    navigator.clipboard.writeText(formatted);
    setStatus("Copied to clipboard!");
    setTimeout(() => setStatus(""), 2000);
  };

  const clearAll = () => {
    setSegments([]);
    setFileName("");
    setStatus("");
    setDetectedLang("");
    setDuration(null);
    setProgress(0);
  };

  const hasResult = segments.length > 0;

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex flex-1 w-full max-w-2xl flex-col gap-6 py-12 px-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Saylo
          </h1>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            Transcribe audio to text — English, Hindi & Hinglish
          </p>
        </div>

        {/* Language Selector */}
        <div className="flex gap-2 justify-center">
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              disabled={isProcessing}
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

        {/* Upload Area */}
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

        {/* Results Tabs */}
        {hasResult && (
          <>
            <div className="flex border-b border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setActiveTab("transcript")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === "transcript"
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
              >
                Transcript
              </button>
              <button
                onClick={() => setActiveTab("summary")}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === "summary"
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                }`}
              >
                AI Summary
              </button>
            </div>

            {/* Transcript Tab */}
            {activeTab === "transcript" && (
              <div className="flex flex-col gap-3">
                {/* Meta + Copy */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">
                    {detectedLang && `Language: ${detectedLang}`}
                    {detectedLang && duration ? " · " : ""}
                    {duration && `Duration: ${formatTime(duration)}`}
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="rounded-md px-3 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Copy
                  </button>
                </div>

                {/* Segments */}
                <div className="flex flex-col gap-1 rounded-xl bg-white p-2 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                  {segments.map((seg, i) => (
                    <div
                      key={i}
                      className="group flex gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <span className="shrink-0 pt-0.5 text-xs font-mono text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {formatTime(seg.start)}
                      </span>
                      <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                        {seg.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary Tab — Placeholder */}
            {activeTab === "summary" && (
              <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <svg
                  className="h-10 w-10 text-zinc-300 dark:text-zinc-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                  />
                </svg>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
                  AI-powered summary coming soon
                </p>
              </div>
            )}

            {/* Clear */}
            {!isProcessing && (
              <button
                onClick={clearAll}
                className="self-center rounded-md px-4 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Clear
              </button>
            )}
          </>
        )}
      </main>

      <footer className="py-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
        Powered by Whisper large-v3 via Groq
      </footer>
    </div>
  );
}
