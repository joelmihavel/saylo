import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

env.allowLocalModels = false;

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

async function getTranscriber() {
  if (!transcriber) {
    self.postMessage({ type: "status", data: "Loading Whisper model..." });
    transcriber = (await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-base",
      {
        dtype: "fp32",
        device: "wasm",
      }
    )) as AutomaticSpeechRecognitionPipeline;
    self.postMessage({ type: "status", data: "Model loaded!" });
  }
  return transcriber;
}

self.onmessage = async (e) => {
  try {
    const { audio, language } = e.data;

    const pipe = await getTranscriber();

    const float32Audio = new Float32Array(audio);

    self.postMessage({ type: "status", data: "Transcribing..." });

    const result = await pipe(float32Audio, {
      language: language || undefined,
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = Array.isArray(result)
      ? result.map((r: { text: string }) => r.text).join(" ")
      : (result as { text: string }).text;

    self.postMessage({ type: "result", data: text.trim() });
  } catch (err) {
    self.postMessage({
      type: "error",
      data: err instanceof Error ? err.message : "Unknown error",
    });
  }
};
