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
      "onnx-community/whisper-small",
      {
        dtype: "q8",
        device: "wasm",
      }
    )) as AutomaticSpeechRecognitionPipeline;
    self.postMessage({ type: "status", data: "Model loaded!" });
  }
  return transcriber;
}

async function decodeAudio(arrayBuffer: ArrayBuffer): Promise<Float32Array> {
  const audioContext = new OfflineAudioContext(1, 1, 16000);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const offlineCtx = new OfflineAudioContext(
    1,
    audioBuffer.duration * 16000,
    16000
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();

  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

self.onmessage = async (e) => {
  try {
    const { audio, language } = e.data;

    const pipe = await getTranscriber();
    self.postMessage({ type: "status", data: "Decoding audio..." });

    const float32Audio = await decodeAudio(audio);

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
