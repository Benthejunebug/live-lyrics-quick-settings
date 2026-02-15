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
    this.hasSeenSignal = false;
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
        if (!this.hasSeenSignal) {
           for (let i = 0; i < float32.length; i++) {
             if (float32[i] !== 0) {
                this.hasSeenSignal = true;
                this.port.postMessage({ type: "signal-detected" });
                break;
             }
           }
        }
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
  debugLog: any,
  name: string
): Promise<Float32Array> => {
  // Setup Worklet
  const workletUrl = getProcessorBlobUrl();
  let workletNode: AudioWorkletNode | null = null;

  try {
    await context.audioWorklet.addModule(workletUrl);
    debugLog[name + "WorkletLoaded"] = true;

    workletNode = new AudioWorkletNode(context, "sync-capture-processor");

    workletNode.port.onmessage = (event) => {
      if (event.data.type === "signal-detected") {
        console.log(`[AutoSync] Signal detected in ${name}!`);
        debugLog[name + "HadSignal"] = true;
      }
      // buffer handling is in promise below
    };

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

      const messageHandler = (event: MessageEvent) => {
        if (event.data.type === "buffer") {
          workletNode?.port.removeEventListener("message", messageHandler);
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

      workletNode.port.addEventListener("message", messageHandler);
      workletNode.port.start(); // Helper port start

      workletNode.port.postMessage("stop");
    });

  } catch (err: any) {
    debugLog[name + "WorkletError"] = err.message || String(err);
    console.error(`[AutoSync] Error in ${name}:`, err);
    throw new Error(`Failed to initialize audio capture (${name}): ${err.message}`);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
};

// --- Main Function ---

export async function runAutoSync(options: RunAutoSyncOptions = {}): Promise<AutoSyncResult> {
  console.log("[AutoSync] Starting auto sync sequence...");
  const settings = { ...DEFAULTS, ...options };
  const debugLog: Record<string, any> = {
    startTime: new Date().toISOString(),
    userAgent: navigator.userAgent,
    settings,
  };

  let micStream: MediaStream | null = null;
  let micContext: AudioContext | null = null;

  try {
    // 1. Check Cider Audio
    const audio = useCiderAudio();
    debugLog.hasCiderAudio = !!audio;
    if (!audio) throw new Error("Cider audio not initialized");
    console.log("[AutoSync] Cider audio initialized.");

    // 2. Check Permissions
    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        debugLog.permissionState = status.state;
        console.log(`[AutoSync] Microphone permission state: ${status.state}`);
        if (status.state === "denied") {
          throw new Error("Microphone permission denied explicitly by OS.");
        }
      } catch (e: any) {
        debugLog.permissionQueryError = e.message;
        console.warn("[AutoSync] Failed to query microphone permission:", e.message);
      }
    }

    // 3. Get Mic Stream
    try {
      // User reported that echoCancellation: true suppresses the music we want to sync to.
      // We start with it FALSE.
      // The previous "silence" issue was likely due to the 96kHz vs 44.1kHz mismatch,
      // which we are now solving with 'micContext'.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      debugLog.micStreamId = micStream.id;
      debugLog.micTracks = micStream.getAudioTracks().map(t => ({
        label: t.label,
        readyState: t.readyState,
        enabled: t.enabled,
        settings: t.getSettings ? t.getSettings() : 'unavailable'
      }));
      console.log("[AutoSync] Microphone stream obtained (EchoCancellation: OFF).");
    } catch (e: any) {
      debugLog.getUserMediaError = {
        name: e.name,
        message: e.message,
        stack: e.stack
      };
      throw new Error(`Microphone access failed: ${e.message}`);
    }

    // 4. Ensure Cider Audio Context is Ready
    if (!audio.context && typeof audio.init === "function") {
      try {
        debugLog.callingInit = true;
        console.log("[AutoSync] Calling Cider audio.init()...");
        await audio.init();
      } catch (e: any) {
        debugLog.initError = e.message;
        console.warn("[AutoSync] Error calling Cider audio.init():", e.message);
      }
    }

    debugLog.audioKeys = Object.keys(audio);

    const readyTimeoutMs = 5000;
    const startWait = now();
    while (!audio.context) {
      if (now() - startWait > readyTimeoutMs) {
        throw new Error(`Cider Audio Context timed out after ${readyTimeoutMs}ms. Is music playing?`);
      }
      await delay(100);
    }
    console.log("[AutoSync] Cider audio context is ready.");

    const ciderContext = audio.context as AudioContext;
    debugLog.ciderContextState = ciderContext.state;
    debugLog.ciderSampleRate = ciderContext.sampleRate;

    if (ciderContext.state === "suspended") {
      try {
        console.log("[AutoSync] Resuming Cider audio context...");
        await ciderContext.resume();
      } catch (e: any) {
        debugLog.resumeError = e.message;
        console.warn("[AutoSync] Error resuming Cider audio context:", e.message);
      }
    }

    // 5. Create a SEPARATE AudioContext for mic at the mic's native sample rate
    // This avoids the sample rate mismatch that causes silence.
    // Cider runs at 96kHz, mic runs at 44.1kHz — connecting them produces zeros.
    const micTrackSettings = micStream.getAudioTracks()[0]?.getSettings();
    const micNativeRate = micTrackSettings?.sampleRate || 44100;
    debugLog.micNativeSampleRate = micNativeRate;

    micContext = new AudioContext({ sampleRate: micNativeRate });
    debugLog.micContextSampleRate = micContext.sampleRate;
    debugLog.micContextState = micContext.state;
    console.log(`[AutoSync] Mic audio context created at ${micNativeRate}Hz.`);

    if (micContext.state === "suspended") {
      await micContext.resume();
      console.log("[AutoSync] Resumed mic audio context.");
    }

    // 6. Identify Stream Source (Tap Node)
    const tapNode = audio.source || audio.audioNodes?.gainNode;
    debugLog.hasTapNode = !!tapNode;
    if (!tapNode) throw new Error("Could not find Cider audio source node to tap");
    console.log("[AutoSync] Cider audio source node identified.");

    // 7. Create mic source in the MIC context (not Cider's context!)
    const micSource = micContext.createMediaStreamSource(micStream);

    // Optional: Boost gain if needed, but start with 1.0 for raw capture
    const micGainNode = micContext.createGain();
    micGainNode.gain.value = settings.micGain || 1.0;
    micSource.connect(micGainNode);

    console.log(`[AutoSync] Mic source created with ${micGainNode.gain.value}x software gain.`);

    settings.onPhase?.("listening");
    console.log(`[AutoSync] Listening for ${settings.durationMs}ms...`);

    // Capture stream audio from Cider's context, mic audio from mic's context
    console.log("[AutoSync] Starting capture...");
    const [streamSamples, micSamples] = await Promise.all([
      captureAudio(ciderContext, tapNode, settings.durationMs, debugLog, "stream"),
      captureAudio(micContext!, micGainNode, settings.durationMs, debugLog, "mic") // Capture from GainNode
    ]);
    console.log(`[AutoSync] Capture complete. Stream: ${streamSamples.length} samples, Mic: ${micSamples.length} samples.`);

    // Stop mic
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
    console.log("[AutoSync] Microphone stream stopped.");

    debugLog.capturedSamples = {
      stream: streamSamples.length,
      mic: micSamples.length
    };

    settings.onPhase?.("processing");
    console.log("[AutoSync] Starting processing phase...");

    // 8. Resample mic audio to match Cider's sample rate for correlation
    // We use simple linear interpolation resampling
    const resampledMic = resampleLinear(micSamples, micContext.sampleRate, ciderContext.sampleRate);
    debugLog.resampledMicLength = resampledMic.length;
    console.log(`[AutoSync] Mic audio resampled from ${micContext.sampleRate}Hz to ${ciderContext.sampleRate}Hz. Length: ${resampledMic.length}`);

    // Close mic context
    try { await micContext.close(); } catch (e) { console.warn("[AutoSync] Error closing mic context:", e); }
    micContext = null;
    console.log("[AutoSync] Mic audio context closed.");

    // 9. Analysis
    const streamRms = computeRms(streamSamples);
    const micRms = computeRms(resampledMic);

    debugLog.rms = { stream: streamRms, mic: micRms };
    console.log(`[AutoSync] RMS - Stream: ${streamRms.toFixed(5)}, Mic: ${micRms.toFixed(5)}`);

    if (streamRms < settings.minRms) throw new Error(`Stream Audio too silent (RMS: ${streamRms.toFixed(5)})`);

    if (micRms === 0) {
      throw new Error("Microphone is capturing absolute silence (0.0). Check macOS System Settings > Privacy > Microphone.");
    }
    if (micRms < settings.minRms) {
      throw new Error(`Microphone Audio too silent (RMS: ${micRms.toFixed(5)})`);
    }

    const streamEnv = normalize(buildEnvelope(streamSamples, settings.frameSize, settings.hop));
    // Use hop scaled to mic's effective rate after resampling
    const micEnv = normalize(buildEnvelope(resampledMic, settings.frameSize, settings.hop));
    console.log(`[AutoSync] Envelopes built. Stream Env Length: ${streamEnv.length}, Mic Env Length: ${micEnv.length}`);

    const maxLagFrames = Math.min(
      Math.round((settings.maxLagSec * ciderContext.sampleRate) / settings.hop),
      Math.max(1, Math.min(streamEnv.length, micEnv.length) - 1)
    );
    console.log(`[AutoSync] Max lag frames for correlation: ${maxLagFrames}`);

    const { lag, corr } = crossCorrelate(streamEnv, micEnv, maxLagFrames);

    debugLog.correlation = { lag, corr };
    console.log(`[AutoSync] Cross-correlation result - Lag: ${lag}, Correlation: ${corr.toFixed(3)}`);

    if (!Number.isFinite(corr) || corr < settings.correlationThreshold) {
      throw new Error(`Correlation too low (${corr.toFixed(3)}). Sync failed.`);
    }

    const offsetSeconds = clampOffset((lag * settings.hop) / ciderContext.sampleRate);
    debugLog.finalOffset = offsetSeconds;
    console.log(`[AutoSync] Calculated offset: ${offsetSeconds} seconds.`);

    console.log("[AutoSync] Auto sync successful!");
    return {
      offsetSeconds,
      correlation: corr,
      debug: debugLog
    };

  } catch (error: any) {
    console.error("[AutoSync] Failed:", error);
    debugLog.error = error.message || String(error);
    console.log("[AutoSync] Debug Log:", JSON.stringify(debugLog, null, 2));
    const err = new Error(error.message);
    (err as any).debug = debugLog;
    throw err;
  } finally {
    // Cleanup
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      console.log("[AutoSync] Final cleanup: Microphone stream stopped.");
    }
    if (micContext) {
      try { micContext.close(); } catch (e) { console.warn("[AutoSync] Final cleanup: Error closing mic context:", e); }
      console.log("[AutoSync] Final cleanup: Microphone context closed.");
    }
  }
}

// --- Resampling ---

const resampleLinear = (input: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    output[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return output;
};
