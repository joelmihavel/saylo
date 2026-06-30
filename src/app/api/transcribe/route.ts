import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

function getGroq() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

interface GroqSegment {
  start: number;
  end: number;
  text: string;
}

interface GroqVerboseResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: GroqSegment[];
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;
    const language = formData.get("language") as string | null;
    const chunkOffset = parseFloat(
      (formData.get("chunkOffset") as string) || "0"
    );

    if (!file) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY not configured" },
        { status: 500 }
      );
    }

    const transcription = (await getGroq().audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language: language || undefined,
      response_format: "verbose_json",
    })) as GroqVerboseResponse;

    const segments = (transcription.segments || []).map((seg) => ({
      start: seg.start + chunkOffset,
      end: seg.end + chunkOffset,
      text: seg.text.trim(),
    }));

    return NextResponse.json({
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      segments,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
