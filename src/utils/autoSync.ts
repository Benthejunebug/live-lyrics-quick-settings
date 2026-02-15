/**
 * Auto-Sync utility — captures internal audio + mic, cross-correlates
 * envelopes, and returns the detected delay as a lyrics offset.
 */

// ---------------------------------------------------------------------------
// Inline worklet source (bundled as string so we can create a Blob URL)
// ---------------------------------------------------------------------------
const WORKLET_SOURCE = /* js */ `
const BATCH_SIZE = 2048;
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(BATCH_SIZE); this.idx = 0; }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.idx++] = ch[i];
      if (this.idx >= BATCH_SIZE) {
        const c = new Float32Array(this.buf);
        this.port.postMessage(c, [c.buffer]);
        this.idx = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-recorder', RecorderProcessor);
`;

let workletRegistered = false;
let workletBlobUrl: string | null = null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AutoSyncStatus = 'listening' | 'processing';
export type AutoSyncFailReason = 'mic-denied' | 'audio-not-ready' | 'low-signal' | 'no-correlation' | 'worklet-failed';

export interface AutoSyncResult {
    ok: true;
    offsetSeconds: number;
    correlation: number;
}

export interface AutoSyncError {
    ok: false;
    reason: AutoSyncFailReason;
    message: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function runAutoSync(
    audioContext: AudioContext,
    sourceNode: AudioNode,
    durationMs = 1500,
    onStatus?: (status: AutoSyncStatus) => void,
): Promise<AutoSyncResult | AutoSyncError> {

    // --- Validate inputs -------------------------------------------------------
    if (!audioContext || audioContext.state === 'closed') {
        return { ok: false, reason: 'audio-not-ready', message: 'Audio context is not available.' };
    }

    // Resume context if suspended
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    // --- Register worklet ------------------------------------------------------
    if (!workletRegistered) {
        try {
            if (!workletBlobUrl) {
                const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
                workletBlobUrl = URL.createObjectURL(blob);
            }
            await audioContext.audioWorklet.addModule(workletBlobUrl);
            workletRegistered = true;
        } catch (e) {
            console.error('[AutoSync] Worklet registration failed:', e);
            return { ok: false, reason: 'worklet-failed', message: 'AudioWorklet not supported in this environment.' };
        }
    }

    // --- Request mic -----------------------------------------------------------
    let micStream: MediaStream;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
    } catch {
        return { ok: false, reason: 'mic-denied', message: 'Microphone access was denied.' };
    }

    // --- Build recording graph -------------------------------------------------
    onStatus?.('listening');

    const streamSamples: Float32Array[] = [];
    const micSamples: Float32Array[] = [];

    const streamRecorder = new AudioWorkletNode(audioContext, 'pcm-recorder');
    const micRecorder = new AudioWorkletNode(audioContext, 'pcm-recorder');

    // Silent gain to keep nodes alive without audible output from the mic
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(audioContext.destination);

    const micSource = audioContext.createMediaStreamSource(micStream);

    // Connect stream tap
    sourceNode.connect(streamRecorder);
    streamRecorder.connect(silentGain);

    // Connect mic
    micSource.connect(micRecorder);
    micRecorder.connect(silentGain);

    // Collect samples
    streamRecorder.port.onmessage = (e: MessageEvent<Float32Array>) => {
        streamSamples.push(e.data);
    };
    micRecorder.port.onmessage = (e: MessageEvent<Float32Array>) => {
        micSamples.push(e.data);
    };

    // Wait for the configured duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));

    // --- Cleanup ---------------------------------------------------------------
    try { sourceNode.disconnect(streamRecorder); } catch { /* already disconnected */ }
    try { streamRecorder.disconnect(); } catch { /* ok */ }
    try { micRecorder.disconnect(); } catch { /* ok */ }
    try { micSource.disconnect(); } catch { /* ok */ }
    try { silentGain.disconnect(); } catch { /* ok */ }
    micStream.getTracks().forEach((t) => t.stop());

    // --- Process ---------------------------------------------------------------
    onStatus?.('processing');

    const streamPCM = concatFloat32Arrays(streamSamples);
    const micPCM = concatFloat32Arrays(micSamples);

    if (streamPCM.length === 0 || micPCM.length === 0) {
        return { ok: false, reason: 'low-signal', message: 'No audio was captured.' };
    }

    // Check RMS levels
    const streamRms = rms(streamPCM);
    const micRms = rms(micPCM);

    if (streamRms < 0.001 || micRms < 0.001) {
        return { ok: false, reason: 'low-signal', message: "Couldn't detect enough audio. Make sure music is playing through speakers." };
    }

    // Compute envelopes
    const sampleRate = audioContext.sampleRate;
    const frameSize = 1024;
    const hop = 256;
    const streamEnv = rmsEnvelope(streamPCM, frameSize, hop);
    const micEnv = rmsEnvelope(micPCM, frameSize, hop);

    // Normalize envelopes (zero-mean, unit-variance)
    normalize(streamEnv);
    normalize(micEnv);

    // Cross-correlate
    const maxLagSec = 2.0;
    const maxLagFrames = Math.ceil((maxLagSec * sampleRate) / hop);
    const { bestLag, bestCorr } = crossCorrelate(streamEnv, micEnv, maxLagFrames);

    if (bestCorr < 0.2) {
        return { ok: false, reason: 'no-correlation', message: "Couldn't reliably detect the delay. Try with louder playback." };
    }

    // Convert lag to seconds: positive lag means mic is behind stream
    const offsetSeconds = Math.round(((bestLag * hop) / sampleRate) * 10) / 10;

    // Clamp to slider range
    const clampedOffset = Math.max(-5, Math.min(15, offsetSeconds));

    return { ok: true, offsetSeconds: clampedOffset, correlation: bestCorr };
}

// ---------------------------------------------------------------------------
// DSP helpers
// ---------------------------------------------------------------------------

function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
    let totalLength = 0;
    for (const a of arrays) totalLength += a.length;
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const a of arrays) {
        result.set(a, offset);
        offset += a.length;
    }
    return result;
}

function rms(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
}

function rmsEnvelope(data: Float32Array, frameSize: number, hop: number): Float32Array {
    const numFrames = Math.floor((data.length - frameSize) / hop) + 1;
    if (numFrames <= 0) return new Float32Array(0);
    const env = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
        let sum = 0;
        const start = f * hop;
        for (let i = start; i < start + frameSize; i++) {
            sum += data[i] * data[i];
        }
        env[f] = Math.sqrt(sum / frameSize);
    }
    return env;
}

function normalize(arr: Float32Array): void {
    if (arr.length === 0) return;
    let mean = 0;
    for (let i = 0; i < arr.length; i++) mean += arr[i];
    mean /= arr.length;
    let variance = 0;
    for (let i = 0; i < arr.length; i++) {
        arr[i] -= mean;
        variance += arr[i] * arr[i];
    }
    const std = Math.sqrt(variance / arr.length);
    if (std > 1e-10) {
        for (let i = 0; i < arr.length; i++) arr[i] /= std;
    }
}

function crossCorrelate(
    a: Float32Array,
    b: Float32Array,
    maxLag: number,
): { bestLag: number; bestCorr: number } {
    const n = Math.min(a.length, b.length);
    let bestLag = 0;
    let bestCorr = -Infinity;

    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < n; i++) {
            const j = i + lag;
            if (j < 0 || j >= b.length) continue;
            sum += a[i] * b[j];
            count++;
        }
        if (count === 0) continue;
        const corr = sum / count;
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    return { bestLag, bestCorr };
}
