import { useCiderAudio } from "@ciderapp/pluginkit";
import recorderWorkletSource from "../worklets/pcm-recorder.worklet.ts?raw";

export type AutoSyncPhase = "listening" | "processing";

export type AutoSyncOptions = {
  durationMs?: number;
  maxLagSec?: number;
  correlationThreshold?: number;
  frameSize?: number;
  hopSize?: number;
  minRms?: number;
  onPhase?: (phase: AutoSyncPhase) => void;
};

export type AutoSyncResult = {
  offsetSeconds: number;
  correlation: number;
  debug?: {
    lagFrames: number;
    sampleRate: number;
    rmsStream: number;
    rmsMic: number;
  };
};

const DEFAULTS = {
  durationMs: 1500,
  maxLagSec: 2.0,
  correlationThreshold: 0.2,
  frameSize: 1024,
  hopSize: 256,
  minRms: 0.01,
  timeoutPaddingMs: 1500,
};

let workletReady: Promise<void> | null = null;
let workletObjectUrl: string | null = null;

const clampOffset = (value: number) => {
  return Math.max(-5, Math.min(15, Math.round(value * 10) / 10));
};

const waitForAudioReady = async (
  audio: ReturnType<typeof useCiderAudio>,
  timeoutMs: number
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (audio?.context && (audio.source || audio.audioNodes?.gainNode)) {
      return {
        context: audio.context,
        source: (audio.source || audio.audioNodes?.gainNode) as AudioNode,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
};

const ensureWorklet = async (context: AudioContext) => {
  if (!context.audioWorklet) {
    throw new Error("AudioWorklet is not supported in this environment.");
  }
  if (!workletObjectUrl) {
    const blob = new Blob([recorderWorkletSource], {
      type: "application/javascript",
    });
    workletObjectUrl = URL.createObjectURL(blob);
  }
  if (!workletReady) {
    workletReady = context.audioWorklet.addModule(workletObjectUrl);
  }
  await workletReady;
};

const collectSamples = (
  port: MessagePort,
  targetSamples: number,
  timeoutMs: number
) =>
  new Promise<Float32Array>((resolve, reject) => {
    const chunks: Float32Array[] = [];
    let total = 0;
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      port.onmessage = null;
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while recording audio."));
    }, timeoutMs);

    port.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "chunk" || !(data.samples instanceof Float32Array)) {
        return;
      }
      chunks.push(data.samples);
      total += data.samples.length;
      if (total >= targetSamples) {
        cleanup();
        resolve(concatSamples(chunks, targetSamples));
      }
    };
  });

const concatSamples = (chunks: Float32Array[], targetSamples: number) => {
  const output = new Float32Array(targetSamples);
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = targetSamples - offset;
    if (remaining <= 0) {
      break;
    }
    const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    output.set(slice, offset);
    offset += slice.length;
  }
  return output;
};

const computeRms = (samples: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
};

const computeEnvelope = (samples: Float32Array, frameSize: number, hopSize: number) => {
  const frameCount = Math.max(1, Math.floor((samples.length - frameSize) / hopSize) + 1);
  const env = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let sum = 0;
    for (let i = 0; i < frameSize; i += 1) {
      const sample = samples[start + i] || 0;
      sum += sample * sample;
    }
    env[frame] = Math.sqrt(sum / frameSize);
  }

  return env;
};

const normalizeInPlace = (values: Float32Array) => {
  let mean = 0;
  for (let i = 0; i < values.length; i += 1) {
    mean += values[i];
  }
  mean /= Math.max(1, values.length);

  let variance = 0;
  for (let i = 0; i < values.length; i += 1) {
    const diff = values[i] - mean;
    variance += diff * diff;
  }
  variance /= Math.max(1, values.length);
  const std = Math.sqrt(variance) || 1;

  for (let i = 0; i < values.length; i += 1) {
    values[i] = (values[i] - mean) / std;
  }
};

const crossCorrelate = (
  a: Float32Array,
  b: Float32Array,
  maxLag: number
) => {
  const len = Math.min(a.length, b.length);
  const cappedLag = Math.min(maxLag, len - 1);
  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let lag = -cappedLag; lag <= cappedLag; lag += 1) {
    const startA = Math.max(0, -lag);
    const startB = Math.max(0, lag);
    const available = Math.min(len - startA, len - startB);
    if (available <= 0) {
      continue;
    }

    let sum = 0;
    for (let i = 0; i < available; i += 1) {
      sum += a[startA + i] * b[startB + i];
    }
    const corr = sum / available;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  return { lag: bestLag, correlation: bestCorr };
};

export async function runAutoSync(options: AutoSyncOptions = {}): Promise<AutoSyncResult> {
  const audio = useCiderAudio();
  if (!audio) {
    throw new Error("Audio engine not available.");
  }

  const ready = await waitForAudioReady(audio, 2000);
  if (!ready) {
    throw new Error("Audio engine not ready. Start playback and try again.");
  }

  const { context, source } = ready;

  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      // Ignore resume errors and continue; recording may still work.
    }
  }

  await ensureWorklet(context);

  const durationMs = options.durationMs ?? DEFAULTS.durationMs;
  const maxLagSec = options.maxLagSec ?? DEFAULTS.maxLagSec;
  const correlationThreshold =
    options.correlationThreshold ?? DEFAULTS.correlationThreshold;
  const frameSize = options.frameSize ?? DEFAULTS.frameSize;
  const hopSize = options.hopSize ?? DEFAULTS.hopSize;
  const minRms = options.minRms ?? DEFAULTS.minRms;
  const timeoutMs = durationMs + DEFAULTS.timeoutPaddingMs;

  let micStream: MediaStream | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let streamRecorder: AudioWorkletNode | null = null;
  let micRecorder: AudioWorkletNode | null = null;
  let silentGain: GainNode | null = null;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported.");
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch {
    throw new Error("Microphone permission was denied.");
  }

  try {
    micSource = context.createMediaStreamSource(micStream);
    silentGain = context.createGain();
    silentGain.gain.value = 0;

    streamRecorder = new AudioWorkletNode(context, "pcm-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    micRecorder = new AudioWorkletNode(context, "pcm-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    source.connect(streamRecorder);
    micSource.connect(micRecorder);

    streamRecorder.connect(silentGain);
    micRecorder.connect(silentGain);
    silentGain.connect(context.destination);

    const targetSamples = Math.ceil((context.sampleRate * durationMs) / 1000);

    options.onPhase?.("listening");
    const [streamSamples, micSamples] = await Promise.all([
      collectSamples(streamRecorder.port, targetSamples, timeoutMs),
      collectSamples(micRecorder.port, targetSamples, timeoutMs),
    ]);

    options.onPhase?.("processing");

    const rmsStream = computeRms(streamSamples);
    const rmsMic = computeRms(micSamples);
    if (rmsStream < minRms || rmsMic < minRms) {
      throw new Error("Audio signal too quiet. Try again with louder playback.");
    }

    const envStream = computeEnvelope(streamSamples, frameSize, hopSize);
    const envMic = computeEnvelope(micSamples, frameSize, hopSize);
    normalizeInPlace(envStream);
    normalizeInPlace(envMic);

    const maxLagFrames = Math.round((maxLagSec * context.sampleRate) / hopSize);
    const { lag, correlation } = crossCorrelate(envStream, envMic, maxLagFrames);

    if (correlation < correlationThreshold) {
      throw new Error("Could not detect a clear match. Try again.");
    }

    const offsetSeconds = clampOffset((lag * hopSize) / context.sampleRate);

    return {
      offsetSeconds,
      correlation,
      debug: {
        lagFrames: lag,
        sampleRate: context.sampleRate,
        rmsStream,
        rmsMic,
      },
    };
  } finally {
    if (source && streamRecorder) {
      try {
        source.disconnect(streamRecorder);
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (micSource && micRecorder) {
      try {
        micSource.disconnect(micRecorder);
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (streamRecorder) {
      try {
        streamRecorder.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (micRecorder) {
      try {
        micRecorder.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (silentGain) {
      try {
        silentGain.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
    }
  }
}
