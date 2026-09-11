import { env, pipeline } from '/vendor/transformers/transformers.min.js';

// Only public model assets are downloaded. Inference receives in-memory PCM,
// never a recording URL, and runs entirely in this worker on the device.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = '/vendor/onnx/';
env.backends.onnx.wasm.proxy = false;

let transcriber = null;
let busy = false;

self.onmessage = async ({ data }) => {
  const { id, type, audio } = data || {};
  if (type !== 'prepare' && type !== 'transcribe') return;
  if (busy) {
    self.postMessage({ id, type: 'error', message: 'Local Whisper is busy. Cancel the current voice action and try again.' });
    return;
  }
  busy = true;
  try {
    if (type === 'prepare') {
      if (!transcriber) {
        const files = new Map([
          ['encoder_model_quantized.onnx', 0],
          ['decoder_model_merged_quantized.onnx', 0],
        ]);
        let lastProgress = 0;
        transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: event => {
            const file = event.file?.split('/').pop();
            if (files.has(file)) {
              if (event.status === 'done') files.set(file, 100);
              else if (Number.isFinite(event.progress)) files.set(file, Math.max(0, Math.min(100, event.progress)));
            }
            if (Date.now() - lastProgress < 100 && event.status !== 'done') return;
            lastProgress = Date.now();
            const progress = Math.min(99, [...files.values()].reduce((sum, value) => sum + value, 0) / files.size);
            self.postMessage({
              id, type: 'progress', progress,
              detail: progress >= 99 ? 'Initializing local Whisper...' : `Loading Whisper${file ? `: ${file}` : ''}. Completed downloads are cached in this browser.`,
            });
          },
        });
      }
      self.postMessage({ id, type: 'ready' });
    } else {
      if (!transcriber) throw new Error('Whisper is not prepared.');
      if (!(audio instanceof Float32Array) || !audio.length || audio.length > 16000 * 120) {
        throw new Error('Expected up to 120 seconds of 16 kHz mono PCM.');
      }
      const result = await transcriber(audio, {
        task: 'transcribe',
        language: null,
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        do_sample: false,
      });
      self.postMessage({ id, type: 'result', text: result.text || '' });
    }
  } catch {
    // The owner terminates failed workers, so even a poisoned WASM session is retryable.
    transcriber = null;
    self.postMessage({
      id, type: 'error',
      message: type === 'prepare'
        ? 'Whisper could not download or initialize. Check your connection and browser storage space, then try again. No audio was uploaded.'
        : 'Local transcription failed. Try again with a shorter, clearer audio clip. No audio was uploaded.',
    });
  } finally {
    busy = false;
  }
};
