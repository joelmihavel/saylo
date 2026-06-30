import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  return genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
}

const SYSTEM_PROMPT = `You are an expert at analyzing voice note transcripts. Given a transcript, produce a structured summary in JSON format with these fields:

{
  "overview": "2-3 sentence summary of what was discussed",
  "keyPoints": ["bullet point 1", "bullet point 2", ...],
  "topics": [{"name": "Topic Name", "detail": "Brief description"}],
  "actionItems": ["action item 1", "action item 2", ...],
  "sentiment": "overall tone (e.g. informative, casual, urgent, analytical)"
}

Rules:
- If the transcript is in Hindi or Hinglish, write the summary in English but preserve key Hindi terms in parentheses where they add meaning
- Keep key points concise — one sentence each
- If there are no action items, return an empty array
- Extract 3-6 key points and 2-5 topics
- Return ONLY valid JSON, no markdown fences or extra text`;

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json();

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { error: "No transcript provided" },
        { status: 400 }
      );
    }

    if (!process.env.GOOGLE_AI_API_KEY) {
      return NextResponse.json(
        { error: "GOOGLE_AI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const model = getModel();
    const result = await model.generateContent([
      SYSTEM_PROMPT,
      `Transcript:\n${transcript}`,
    ]);

    const text = result.response.text().trim();
    const cleaned = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    const summary = JSON.parse(cleaned);

    return NextResponse.json(summary);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Summary generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
