const SAMPLE_RATE = 16000;
const MAX_SECONDS = 120;
const MAX_BYTES = 25 * 1024 * 1024;
const CANCELLED = Symbol('voice-cancelled');

/**
 * Call prepare/start/transcribeFile only after the UI's download consent.
 * Async methods resolve true on success, false on cancellation/error/busy;
 * stop resolves after transcription. cancel/destroy discard work synchronously.
 * No microphone data or speech text is sent to a remote speech service.
 */
export function createVoice({ onTranscript, onState, onError } = {}) {
  const page = typeof document === 'undefined' ? null : document;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const OfflineContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const synthesis = globalThis.speechSynthesis;
  let worker = null;
  let pending = null;
  let current = null;
  let generation = 0;
  let requestId = 0;
  let ready = false;
  let phase = 'idle';
  let destroyed = false;

  function notify(callback, ...args) {
    // UI callbacks must not strand microphone resources or reject event handlers.
    try {
      Promise.resolve(callback?.(...args)).catch(() => {});
    } catch { /* The caller owns its UI errors. */ }
  }

  function state(next, extra = {}) {
    phase = next;
    if (!destroyed) notify(onState, { phase: next, ...extra });
  }

  function error(message) {
    if (!destroyed) notify(onError, message);
    return false;
  }

  function problem(message) {
    const result = new Error(message);
    result.name = 'VoiceError';
    return result;
  }

  function begin(kind, mode) {
    if (destroyed) return null;
    if (page?.hidden) {
      error('Return to this tab before using voice.');
      return null;
    }
    if (current) {
      error('Voice is busy. Stop or cancel the current voice action, then try again.');
      return null;
    }
    const op = { kind, mode, id: ++generation, stage: kind, chunks: [] };
    op.cancelled = new Promise(resolve => { op.abort = resolve; });
    current = op;
    return op;
  }

  function check(op) {
    if (destroyed || current !== op || page?.hidden) throw CANCELLED;
  }

  async function wait(op, promise) {
    const result = await Promise.race([promise, op.cancelled]);
    check(op);
    return result;
  }

  function closeContext(context) {
    if (!context || context.state === 'closed') return;
    try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already closing. */ }
  }

  function stopTracks(stream) {
    for (const track of stream?.getTracks() || []) {
      try { track.stop(); } catch { /* A removed device can already be stopped. */ }
    }
  }

  function releaseCapture(op) {
    clearInterval(op.meterTimer);
    clearTimeout(op.limitTimer);
    if (op.recorder) {
      op.recorder.ondataavailable = null;
      op.recorder.onstop = null;
      op.recorder.onerror = null;
      try {
        if (op.recorder.state !== 'inactive') op.recorder.stop();
      } catch { /* Cancellation must still release the microphone. */ }
    }
    stopTracks(op.stream);
    try { op.source?.disconnect(); op.analyser?.disconnect(); } catch { /* Already detached. */ }
    closeContext(op.meterContext);
    op.recorder = op.stream = op.source = op.analyser = op.meterContext = null;
    op.chunks = [];
  }

  function release(op) {
    releaseCapture(op);
    closeContext(op.decodeContext);
    op.decodeContext = null;
    clearTimeout(op.speechTimer);
    op.voicesCleanup?.();
    if (op.utterance) {
      op.utterance.onend = op.utterance.onerror = null;
      op.utterance = null;
      try { synthesis.cancel(); } catch { /* The platform may have already stopped. */ }
    }
  }

  function resetWorker(reason = CANCELLED) {
    const task = pending;
    pending = null;
    clearTimeout(task?.timer);
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    ready = false;
    task?.reject(reason);
  }

  function finish(op, next = 'idle') {
    if (current !== op) return;
    current = null;
    op.abort(CANCELLED);
    release(op);
    if (pending?.op === op) resetWorker();
    state(next);
  }

  function fail(op, cause) {
    if (current !== op) return false;
    let message = cause?.name === 'VoiceError' ? cause.message : null;
    if (!message && cause?.name === 'NotAllowedError') {
      message = 'Microphone access was not allowed. Allow it in your browser site settings, then try again.';
    } else if (!message && cause?.name === 'NotFoundError') {
      message = 'No microphone was found. Connect a microphone and try again.';
    } else if (!message && cause?.name === 'NotReadableError') {
      message = 'The microphone could not be opened. Close other apps using it and try again.';
    }
    message ||= op.kind === 'speak'
      ? 'Local speech playback failed. Try again or continue with text chat.'
      : 'Voice could not finish. Try again with a shorter recording or a browser-supported audio file.';
    finish(op);
    if (cause !== CANCELLED && !page?.hidden) error(message);
    return false;
  }

  function askWorker(op, type, audio) {
    check(op);
    return new Promise((resolve, reject) => {
      try {
        if (!worker) {
          // Creating this module is lazy: importing voice.js alone downloads no model.
          const instance = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
          worker = instance;
          instance.onmessage = ({ data }) => {
            if (worker !== instance || !pending || data?.id !== pending.id) return;
            const task = pending;
            if (current !== task.op) return;
            if (data.type === 'progress') {
              const extra = { detail: data.detail || 'Loading local Whisper...' };
              if (Number.isFinite(data.progress)) extra.progress = Math.max(0, Math.min(100, data.progress));
              state('downloading', extra);
              return;
            }
            if (data.type === 'error') {
              resetWorker(problem(data.message || 'Local Whisper failed. Try preparing voice again.'));
              return;
            }
            if (data.type !== (task.type === 'prepare' ? 'ready' : 'result')) return;
            pending = null;
            clearTimeout(task.timer);
            task.resolve(data);
          };
          const workerError = event => {
            event.preventDefault?.();
            if (worker !== instance) return;
            const hadTask = !!pending;
            resetWorker(problem('Local Whisper could not run. Reload and try again; check that the local model runtime is being served.'));
            if (!hadTask && !current && !destroyed) {
              state('idle');
              error('Local Whisper stopped. Prepare voice again to retry.');
            }
          };
          instance.onerror = instance.onmessageerror = workerError;
        }
        const id = ++requestId;
        pending = { op, id, type, resolve, reject };
        pending.timer = setTimeout(() => {
          resetWorker(problem(type === 'prepare'
            ? 'The Whisper download timed out. Check your connection, then retry; completed downloads can be reused.'
            : 'Local transcription took too long. Try a shorter recording.'));
        }, 10 * 60 * 1000);
        // Only a transferable PCM buffer crosses into our local worker, never a URL.
        worker.postMessage({ id, type, audio }, audio ? [audio.buffer] : []);
      } catch {
        const cause = problem('Local Whisper could not start. Use a current browser on HTTPS or localhost and try again.');
        resetWorker(cause);
        reject(cause);
      }
    });
  }

  async function ensureReady(op) {
    check(op);
    if (ready) return;
    if (!globalThis.Worker || !globalThis.WebAssembly || globalThis.isSecureContext === false) {
      throw problem('Local voice requires a current browser with WebAssembly, on HTTPS or localhost.');
    }
    op.stage = 'downloading';
    state('downloading', { progress: 0, detail: 'Loading local Whisper. The first use downloads model files; audio stays on this device.' });
    check(op);
    await wait(op, askWorker(op, 'prepare'));
    ready = true;
    state('ready', { progress: 100, detail: 'Whisper is ready. Transcription runs locally on this device.' });
    check(op);
  }

  async function prepare() {
    const op = begin('prepare');
    if (!op) return false;
    try {
      await ensureReady(op);
      check(op);
      finish(op, 'ready');
      return true;
    } catch (cause) { return fail(op, cause); }
  }

  async function decode(op, blob) {
    if (!AudioContextClass) throw problem('This browser cannot decode audio locally. Try a current version of Chrome, Edge, Firefox, or Safari.');
    if (!blob.size) throw problem('The recording is empty. Record a few seconds of speech and try again.');
    const bytes = await wait(op, blob.arrayBuffer());
    const context = new AudioContextClass();
    op.decodeContext = context;
    let decoded;
    try {
      decoded = await wait(op, context.decodeAudioData(bytes));
    } catch (cause) {
      if (cause === CANCELLED) throw cause;
      throw problem('This audio format could not be decoded. Try a WAV, MP3, M4A, or WebM file supported by your browser.');
    } finally {
      closeContext(context);
      if (op.decodeContext === context) op.decodeContext = null;
    }
    check(op);
    if (!Number.isFinite(decoded.duration) || !decoded.length || !decoded.numberOfChannels) {
      throw problem('No usable audio was found. Choose another file or record again.');
    }
    if (op.mode === 'file' && decoded.duration > MAX_SECONDS) {
      throw problem('Audio files must be 120 seconds or shorter. Trim this file and try again.');
    }
    // Clip recorder timer/codec padding; uploaded files are instead rejected above.
    const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * MAX_SECONDS));
    const mono = new Float32Array(length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
    }
    if (decoded.sampleRate === SAMPLE_RATE) return mono;
    if (!OfflineContextClass) throw problem('This browser cannot resample audio locally. Try another current browser.');
    const offline = new OfflineContextClass(1, Math.ceil(length * SAMPLE_RATE / decoded.sampleRate), SAMPLE_RATE);
    const buffer = offline.createBuffer(1, length, decoded.sampleRate);
    buffer.copyToChannel(mono, 0);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    try {
      const rendered = await wait(op, offline.startRendering());
      return rendered.getChannelData(0).slice();
    } finally {
      // OfflineAudioContext has no close/abort API and owns no microphone hardware.
      source.disconnect();
      source.buffer = null;
    }
  }

  async function transcribe(op, blob) {
    check(op);
    const audio = await decode(op, blob);
    check(op);
    let energy = 0;
    let peak = 0;
    for (const sample of audio) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    // Whisper can invent words for silence; reject empty/near-silent PCM first.
    if (audio.length < SAMPLE_RATE / 5 || !Number.isFinite(energy) || peak < 0.003 || Math.sqrt(energy / audio.length) < 0.0005) {
      throw problem('No clear speech was detected. Speak closer to the microphone or choose a louder audio clip.');
    }
    const result = await wait(op, askWorker(op, 'transcribe', audio));
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (!text) throw problem('No speech was recognized. Try again with clearer audio.');
    check(op);
    finish(op);
    if (!destroyed && !page?.hidden && generation === op.id) notify(onTranscript, text, { mode: op.mode });
    return true;
  }

  function completeRecording(op) {
    if (op.completion) return op.completion;
    op.completion = (async () => {
      try {
        check(op);
        op.stage = 'transcribing';
        state('transcribing', { detail: 'Transcribing on this device. No audio is uploaded.' });
        const blob = await wait(op, op.recorded);
        return await transcribe(op, blob);
      } catch (cause) { return fail(op, cause); }
    })();
    return op.completion;
  }

  async function start(mode = 'dictate') {
    if (current?.kind === 'speak') cancel();
    const op = begin('record', mode);
    if (!op) return false;
    try {
      if (mode !== 'dictate' && mode !== 'conversation') throw problem('Choose dictation or conversation mode before recording.');
      if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder || !AudioContextClass) {
        throw problem('Microphone recording is unavailable. Use a current browser on HTTPS or localhost, or upload an audio file.');
      }
      await ensureReady(op);
      check(op);
      op.stage = 'permission';
      state('ready', { detail: 'Allow microphone access to start recording.' });
      check(op);
      // getUserMedia cannot be aborted: dispose any stream granted after cancellation.
      const permission = navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
        if (current !== op || destroyed || page?.hidden) stopTracks(stream);
        else op.stream = stream;
        return stream;
      });
      await wait(op, permission);
      op.meterContext = new AudioContextClass();
      Promise.resolve(op.meterContext.resume()).catch(() => {});
      op.source = op.meterContext.createMediaStreamSource(op.stream);
      op.analyser = op.meterContext.createAnalyser();
      op.analyser.fftSize = 1024;
      op.source.connect(op.analyser);
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
        .find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(op.stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : {});
      op.recorder = recorder;
      op.recorded = new Promise(resolve => { op.recordedResolve = resolve; });
      let byteCount = 0;
      recorder.ondataavailable = ({ data }) => {
        if (current !== op || !data.size) return;
        byteCount += data.size;
        if (byteCount > MAX_BYTES) {
          fail(op, problem('This recording is too large. Try a shorter recording.'));
          return;
        }
        op.chunks.push(data);
      };
      recorder.onerror = () => { fail(op, problem('Recording stopped unexpectedly. Check your microphone and try again.')); };
      recorder.onstop = () => {
        if (current !== op) return;
        const blob = new Blob(op.chunks, { type: recorder.mimeType });
        releaseCapture(op);
        op.recordedResolve(blob);
        void completeRecording(op);
      };
      recorder.start(250);
      op.stage = 'listening';
      const started = performance.now();
      const levels = new Float32Array(op.analyser.fftSize);
      op.meterTimer = setInterval(() => {
        if (current !== op || op.stage !== 'listening') return;
        if (page?.hidden) { cancel(); return; }
        op.analyser.getFloatTimeDomainData(levels);
        let energy = 0;
        for (const sample of levels) energy += sample * sample;
        state('listening', {
          seconds: Math.min(MAX_SECONDS, (performance.now() - started) / 1000),
          level: Math.min(1, Math.sqrt(energy / levels.length) * 5),
        });
      }, 100);
      op.limitTimer = setTimeout(() => { if (current === op) void stop(); }, MAX_SECONDS * 1000);
      state('listening', { seconds: 0, level: 0, detail: 'Listening locally. Stop when finished (maximum 120 seconds).' });
      check(op);
      return true;
    } catch (cause) { return fail(op, cause); }
  }

  async function stop() {
    const op = current;
    if (!op || op.kind !== 'record') return false;
    if (op.completion) return op.completion;
    if (op.stage !== 'listening') { cancel(); return false; }
    try {
      clearInterval(op.meterTimer);
      clearTimeout(op.limitTimer);
      op.recorder.stop();
      // Capture is done; do not keep the permission indicator on during decoding.
      stopTracks(op.stream);
      return await completeRecording(op);
    } catch (cause) { return fail(op, cause); }
  }

  async function transcribeFile(file) {
    const op = begin('file', 'file');
    if (!op) return false;
    try {
      if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
        throw problem('Choose a non-empty audio file to transcribe.');
      }
      if (file.size > MAX_BYTES) throw problem('Audio files must be 25 MB or smaller. Compress or trim this file and try again.');
      await ensureReady(op);
      check(op);
      op.stage = 'transcribing';
      state('transcribing', { detail: 'Decoding and transcribing your file locally. Nothing is uploaded.' });
      return await transcribe(op, file);
    } catch (cause) { return fail(op, cause); }
  }

  function localVoices() {
    try { return synthesis?.getVoices().filter(voice => voice.localService === true) || []; }
    catch { return []; }
  }

  function speechChunks(text) {
    let remaining = String(text ?? '')
      .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' ')
      .replace(/`+[^`]*`+/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\b(?:https?:\/\/|www\.)[^\s]+/gi, ' ')
      .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '')
      .replace(/[|*_~]/g, ' ')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, ' ').trim();
    const chunks = [];
    while (remaining.length) {
      let end = Math.min(219, remaining.length);
      if (end < remaining.length) {
        const prefix = remaining.slice(0, end);
        const sentence = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '), prefix.lastIndexOf('; '));
        const space = prefix.lastIndexOf(' ');
        end = sentence > 100 ? sentence + 1 : space > 0 ? space : end;
        if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
      }
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    return chunks;
  }

  async function speak(text) {
    if (current?.kind === 'speak') cancel();
    const op = begin('speak');
    if (!op) return false;
    try {
      const chunks = speechChunks(text);
      if (!chunks.length) { finish(op); return false; }
      if (synthesis && globalThis.SpeechSynthesisUtterance && !localVoices().length) {
        // Some browsers populate installed voices asynchronously. Never fall back to a remote voice.
        await wait(op, new Promise(resolve => {
          const changed = () => { if (localVoices().length) resolve(); };
          const timer = setTimeout(resolve, 1500);
          synthesis.addEventListener?.('voiceschanged', changed);
          op.voicesCleanup = () => {
            clearTimeout(timer);
            synthesis.removeEventListener?.('voiceschanged', changed);
          };
          changed();
        }));
        op.voicesCleanup();
        op.voicesCleanup = null;
      }
      const voices = localVoices();
      const voice = voices.find(candidate => /^en(?:[-_]|$)/i.test(candidate.lang) && candidate.default)
        || voices.find(candidate => /^en(?:[-_]|$)/i.test(candidate.lang)) || voices[0];
      if (!voice || !globalThis.SpeechSynthesisUtterance) {
        throw problem('No local voice is installed. Install an offline voice in your device speech settings, then try again. Text chat is still available.');
      }
      check(op);
      state('speaking', { detail: 'Speaking with an installed, local device voice.' });
      for (const chunk of chunks) {
        check(op);
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        op.utterance = utterance;
        await wait(op, new Promise((resolve, reject) => {
          utterance.onend = resolve;
          utterance.onerror = () => reject(problem('Local speech playback failed. Try again or continue reading the text reply.'));
          op.speechTimer = setTimeout(() => reject(problem('Local speech playback timed out. Try again or use the text reply.')), 45000);
          synthesis.resume();
          synthesis.speak(utterance);
        }));
        clearTimeout(op.speechTimer);
        utterance.onend = utterance.onerror = null;
        op.utterance = null;
      }
      finish(op);
      return true;
    } catch (cause) { return fail(op, cause); }
  }

  function cancel() {
    const op = current;
    generation++;
    current = null;
    if (op) {
      op.abort(CANCELLED);
      release(op);
      // Termination actually interrupts WASM inference and in-flight model downloads.
      if (pending || op.stage === 'transcribing' || op.stage === 'downloading') resetWorker();
    }
    state('idle');
  }

  function hidden() { if (page?.hidden) cancel(); }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancel();
    resetWorker();
    page?.removeEventListener('visibilitychange', hidden);
    globalThis.removeEventListener?.('pagehide', cancel);
  }

  page?.addEventListener('visibilitychange', hidden);
  globalThis.addEventListener?.('pagehide', cancel);

  return {
    prepare, start, stop, cancel, speak, transcribeFile, destroy,
    get ready() { return ready; },
    get phase() { return phase; },
    get hasLocalVoice() { return !destroyed && !!globalThis.SpeechSynthesisUtterance && localVoices().length > 0; },
  };
}
