import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

function getGroq() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("audio") as File | null;
  const language = formData.get("language") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  const transcription = await getGroq().audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    language: language || undefined,
    response_format: "verbose_json",
  }) as { text: string; language?: string; duration?: number };

  return NextResponse.json({
    text: transcription.text,
    language: transcription.language,
    duration: transcription.duration,
  });
}
