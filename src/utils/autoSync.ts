import { useCiderAudio } from "@ciderapp/pluginkit";

export type AutoSyncPhase = "listening" | "processing";

export type AutoSyncResult = {
  offsetSeconds: number;
  correlation: number;
  debug: Record<string, any>;
};

export type RunAutoSyncOptions = {
  durationMs?: number;
  maxLagSec?: number;
  correlationThreshold?: number;
  frameSize?: number;
  hop?: number;
  micGain?: number;
  onPhase?: (phase: AutoSyncPhase) => void;
};

const DEFAULTS = {
  durationMs: 1500,
  maxLagSec: 2.0,
  correlationThreshold: 0.2,
  frameSize: 1024,
  hop: 256,
  minRms: 0.0005,
  readyTimeoutMs: 5000,
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// Inline AudioWorkletProcessor code to avoid file loading issues in plugins
const PROCESSOR_CODE = `
class SyncCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.totalSamples = 0;
    this.isRecording = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        this.isRecording = false;
        this.port.postMessage({ type: "buffer", buffers: this.buffers, totalSamples: this.totalSamples });
        this.buffers = []; // clear memory
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) return true;
    
    // Input 0, Channel 0
    const input = inputs[0];
    if (input && input.length > 0) {
      const float32 = input[0];
      if (float32) {
        // Clone the buffer to send it, or store it
        // We store chunks and send them all at once at the end to minimize message passing overhead during recording
        // But for long recordings memory might be an issue. For 1.5s (72k samples) it's ~288KB, totally fine.
        const copy = new Float32Array(float32);
        this.buffers.push(copy);
        this.totalSamples += copy.length;
      }
    }
    return true;
  }
}

registerProcessor("sync-capture-processor", SyncCaptureProcessor);
`;

const getProcessorBlobUrl = () => {
  const blob = new Blob([PROCESSOR_CODE], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};

const clampOffset = (value: number) => {
  return Math.max(-5, Math.min(15, Math.round(value * 10) / 10));
};

const concatFloat32Chunks = (chunks: Float32Array[], totalLength: number) => {
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

// --- Math Helpers ---

const computeRms = (samples: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
};

const buildEnvelope = (samples: Float32Array, frameSize: number, hop: number) => {
  if (samples.length < frameSize) return new Float32Array(0);
  const frameCount = Math.floor((samples.length - frameSize) / hop) + 1;
  const envelope = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    const start = i * hop;
    let sumSq = 0;
    for (let j = 0; j < frameSize; j += 1) {
      const v = samples[start + j];
      sumSq += v * v;
    }
    envelope[i] = Math.sqrt(sumSq / frameSize);
  }
  return envelope;
};

const normalize = (values: Float32Array) => {
  if (values.length === 0) return values;
  let mean = 0;
  for (let i = 0; i < values.length; i += 1) {
    mean += values[i];
  }
  mean /= values.length;
  let variance = 0;
  for (let i = 0; i < values.length; i += 1) {
    const diff = values[i] - mean;
    variance += diff * diff;
  }
  const std = Math.sqrt(variance / values.length);
  if (std === 0) return new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    output[i] = (values[i] - mean) / std;
  }
  return output;
};

const crossCorrelate = (a: Float32Array, b: Float32Array, maxLag: number) => {
  let bestLag = 0;
  let bestCorr = -Infinity;
  // Optimize: skip correlation if arrays are empty
  if (a.length === 0 || b.length === 0) return { lag: 0, corr: 0 };

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let count = 0;
    // Simple non-FFT cross correlation
    // A bit slow but fine for envelopes which are low sample rate (Original/Hop)
    // E.g. 48000 / 256 = 187Hz sample rate. 2 seconds = 375 samples.
    // 375 * 375 iterations = ~140k ops, very fast.
    for (let i = 0; i < a.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      sum += a[i] * b[j];
      count += 1;
    }
    if (count === 0) continue;
    const corr = sum / count;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return { lag: bestLag, corr: bestCorr };
};

// --- Capture Helper ---

const captureAudio = async (
  context: AudioContext,
  source: AudioNode,
  durationMs: number,
  debugLog: any
): Promise<Float32Array> => {
  // Setup Worklet
  const workletUrl = getProcessorBlobUrl();
  let workletNode: AudioWorkletNode | null = null;

  try {
    await context.audioWorklet.addModule(workletUrl);
    debugLog.workletLoaded = true;

    workletNode = new AudioWorkletNode(context, "sync-capture-processor");

    // Connect source -> Worklet -> Destination (or silent gain to keep it alive)
    // We connect to destination with 0 gain to ensure the graph is active
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    source.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(context.destination);

    // Wait for duration
    await delay(durationMs);

    // Stop recording and get data
    return new Promise((resolve) => {
      if (!workletNode) return resolve(new Float32Array(0));

      workletNode.port.onmessage = (event) => {
        if (event.data.type === "buffer") {
          const { buffers, totalSamples } = event.data;
          const result = concatFloat32Chunks(buffers, totalSamples);

          // Cleanup
          try {
            source.disconnect(workletNode as AudioWorkletNode);
            workletNode?.disconnect();
            silentGain.disconnect();
          } catch (e) { }

          resolve(result);
        }
      };

      workletNode.port.postMessage("stop");
    });

  } catch (err: any) {
    debugLog.workletError = err.message || String(err);
    throw new Error(`Failed to initialize audio capture: ${err.message}`);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
};

// --- Main Function ---

export async function runAutoSync(options: RunAutoSyncOptions = {}): Promise<AutoSyncResult> {
  const settings = { ...DEFAULTS, ...options };
  const debugLog: Record<string, any> = {
    startTime: new Date().toISOString(),
    userAgent: navigator.userAgent,
    settings,
  };

  try {
    // 1. Check Cider Audio
    const audio = useCiderAudio();
    debugLog.hasCiderAudio = !!audio;
    if (!audio) throw new Error("Cider audio not initialized");

    // 2. Check Permissions
    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        debugLog.permissionState = status.state;
        if (status.state === "denied") {
          throw new Error("Microphone permission denied explicitly by OS.");
        }
      } catch (e: any) {
        debugLog.permissionQueryError = e.message;
      }
    }

    // 3. Get Mic Stream
    let micStream: MediaStream;
    try {
      // We MUST use echoCancellation: true on some macOS/Electron setups to get ANY audio.
      // With it false, we get absolute silence (0.0). With it true, we get quiet audio (~0.001 rms).
      // We will boost this quiet audio later.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      debugLog.micStreamId = micStream.id;
      const track = micStream.getAudioTracks()[0];
      debugLog.micTracks = micStream.getAudioTracks().map(t => ({
        label: t.label,
        readyState: t.readyState,
        enabled: t.enabled,
        settings: t.getSettings ? t.getSettings() : 'unavailable'
      }));
    } catch (e: any) {
      debugLog.getUserMediaError = {
        name: e.name,
        message: e.message,
        stack: e.stack
      };
      throw new Error(`Microphone access failed: ${e.message}`);
    }

    // 4. Ensure Audio Context is Ready
    if (!audio.context && typeof audio.init === "function") {
      try {
        debugLog.callingInit = true;
        await audio.init();
      } catch (e: any) {
        debugLog.initError = e.message;
      }
    }

    // Log keys to see what we actually have
    debugLog.audioKeys = Object.keys(audio);

    // Increase timeout to 5s
    const readyTimeoutMs = 5000;
    const startWait = now();
    while (!audio.context) {
      if (now() - startWait > readyTimeoutMs) {
        throw new Error(`Cider Audio Context timed out after ${readyTimeoutMs}ms. Is music playing?`);
      }
      await delay(100);
    }

    const context = audio.context as AudioContext;
    debugLog.contextState = context.state;
    debugLog.sampleRate = context.sampleRate;
    debugLog.baseLatency = context.baseLatency;

    if (context.state === "suspended") {
      try { await context.resume(); } catch (e: any) {
        debugLog.resumeError = e.message;
      }
    }

    // 5. Identify Stream Source (Tap Node)
    let tapNode = audio.source || audio.audioNodes?.gainNode;
    debugLog.hasTapNode = !!tapNode;
    if (!tapNode) throw new Error("Could not find Cider audio source node to tap");

    // 6. Capture!
    const micSource = context.createMediaStreamSource(micStream);

    settings.onPhase?.("listening");

    const [streamSamples, micSamples] = await Promise.all([
      captureAudio(context, tapNode, settings.durationMs, debugLog),
      captureAudio(context, micSource, settings.durationMs, debugLog) // Re-using capture function logic implies parallel Worklets? Yes.
      // Note: We might need to give them unique names if registered globally?
      // AudioWorklet addModule is per context. If we add the same module twice it's fine or ignored.
      // Just need to make sure we don't conflict. The class name Registry is global to the WorkletScope.
      // We can just addModule once.
    ]);

    // Stop mic
    micStream.getTracks().forEach(t => t.stop());

    debugLog.capturedSamples = {
      stream: streamSamples.length,
      mic: micSamples.length
    };

    settings.onPhase?.("processing");

    // 7. Analysis
    const streamRms = computeRms(streamSamples);
    const micRms = computeRms(micSamples);

    debugLog.rms = { stream: streamRms, mic: micRms };

    if (streamRms < settings.minRms) throw new Error(`Stream Audio too silent (RMS: ${streamRms.toFixed(5)})`);

    if (micRms === 0) {
      throw new Error("Microphone is capturing absolute silence (0.0). Check macOS System Settings > Privacy > Microphone.");
    }
    if (micRms < settings.minRms) {
      throw new Error(`Microphone Audio too silent (RMS: ${micRms.toFixed(5)})`);
    }

    const streamEnv = normalize(buildEnvelope(streamSamples, settings.frameSize, settings.hop));
    const micEnv = normalize(buildEnvelope(micSamples, settings.frameSize, settings.hop));

    const maxLagFrames = Math.min(
      Math.round((settings.maxLagSec * context.sampleRate) / settings.hop),
      Math.max(1, Math.min(streamEnv.length, micEnv.length) - 1)
    );

    const { lag, corr } = crossCorrelate(streamEnv, micEnv, maxLagFrames);

    debugLog.correlation = { lag, corr };

    if (!Number.isFinite(corr) || corr < settings.correlationThreshold) {
      throw new Error(`Correlation too low (${corr.toFixed(3)}). Sync failed.`);
    }

    const offsetSeconds = clampOffset((lag * settings.hop) / context.sampleRate);
    debugLog.finalOffset = offsetSeconds;

    return {
      offsetSeconds,
      correlation: corr,
      debug: debugLog
    };

  } catch (error: any) {
    debugLog.error = error.message || String(error);
    // Return debug info even on failure if possible, or throw with debug info attached?
    // We'll throw and attach debug log to the error object to be caught by UI
    const err = new Error(error.message);
    (err as any).debug = debugLog;
    throw err;
  }
}
