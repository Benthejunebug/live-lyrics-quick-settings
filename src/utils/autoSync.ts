import { useCider, useCiderAudio } from "@ciderapp/pluginkit";

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
  readyTimeoutMs?: number;
  useCompanionMic?: boolean;
  companionUrl?: string;
  companionConnectTimeoutMs?: number;
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
  useCompanionMic: true,
  companionUrl: "ws://127.0.0.1:17890",
  companionConnectTimeoutMs: 1000,
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Cider 4 ("Genten") plays through MKLite and only builds a WebAudio graph for some
 * output modes. When Cider Audio is disabled, or when the output device resolves to
 * Atmos *passthrough*, `CiderAudio.init()` returns immediately and no AudioContext or
 * tappable node is ever created -- Auto Sync cannot work at all in that state.
 *
 * This mirrors the check Cider itself performs so we can fail fast with an actionable
 * message instead of waiting out the ready timeout.
 */
const describeCiderAudioAvailability = (): { available: boolean; reason?: string; mode?: string } => {
  let getValue: ((path: string) => any) | undefined;
  try {
    getValue = useCider()?.config?.getValue?.bind(useCider().config);
  } catch {
    // Older clients, or config API unavailable -- assume the graph is usable.
  }
  if (typeof getValue !== "function") return { available: true };

  try {
    if (getValue("audio.ciderAudio.enabled") === false) {
      return {
        available: false,
        reason: "Cider Audio is turned off. Enable it in Settings > Audio to use Auto Sync.",
      };
    }

    const device = getValue("audio.deviceOutput") || "default";
    const preferences = getValue("audio.atmos.devicePreferences");
    const atmosEnabled = getValue("audio.atmos.enabled");
    const binaural = getValue("audio.atmos.binaural");

    const mode =
      (preferences && preferences[device]) ||
      (atmosEnabled === false ? "off" : binaural ? "binaural" : "passthrough");

    if (mode === "passthrough") {
      return {
        available: false,
        mode,
        reason:
          "Cider is in Atmos passthrough mode, so playback bypasses the WebAudio graph " +
          "that Auto Sync listens to. Switch Settings > Audio > Atmos to binaural (or off) and retry.",
      };
    }

    return { available: true, mode };
  } catch {
    return { available: true };
  }
};

/** Cider 4 exposes the shared graph context on `window.ciderAudioContext`. */
const getSharedAudioContext = (audio: any): AudioContext | null => {
  const shared = (window as any).ciderAudioContext;
  return (audio?.context as AudioContext) || (shared instanceof AudioContext ? shared : null);
};

/** `CiderAudio.init()` is callback-based, not promise-based. Wrap it so we can await it. */
const initCiderAudio = (audio: any, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    try {
      audio.init(() => {
        clearTimeout(timer);
        done();
      });
    } catch (error) {
      clearTimeout(timer);
      console.warn("[AutoSync] Error calling Cider audio.init():", error);
      done();
    }
  });

// Inline AudioWorkletProcessor code to avoid file loading issues in plugins
const PROCESSOR_CODE = `
class SyncCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.totalSamples = 0;
    this.isRecording = true;
    this.hasSeenSignal = false;
    this.inputFrameSize = 0;
    this.channelStats = null;
    this.signalChannel = null;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        this.isRecording = false;
        this.port.postMessage({
          type: "buffer",
          buffers: this.buffers,
          totalSamples: this.totalSamples,
          stats: this.buildStats()
        });
        this.buffers = []; // clear memory
      }
    };
  }

  buildStats() {
    if (!this.channelStats) return null;
    const channelStats = [];
    for (let i = 0; i < this.channelStats.length; i++) {
      const s = this.channelStats[i];
      channelStats.push({
        sampleCount: s.sampleCount,
        nonZeroCount: s.nonZeroCount,
        maxAbs: s.maxAbs,
        rms: s.sampleCount ? Math.sqrt(s.sumSq / s.sampleCount) : 0
      });
    }
    return {
      inputChannelCount: this.channelStats.length,
      inputFrameSize: this.inputFrameSize,
      signalChannel: this.signalChannel,
      channelStats
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) return true;
    
    // Input 0, all channels (we capture channel 0 but track stats for all channels)
    const input = inputs[0];
    if (input && input.length > 0) {
      if (!this.channelStats || this.channelStats.length !== input.length) {
        this.channelStats = [];
        for (let c = 0; c < input.length; c++) {
          this.channelStats.push({ sumSq: 0, maxAbs: 0, nonZeroCount: 0, sampleCount: 0 });
        }
      }

      const frameSize = input[0]?.length || 0;
      if (!this.inputFrameSize && frameSize) this.inputFrameSize = frameSize;

      for (let c = 0; c < input.length; c++) {
        const channel = input[c];
        if (!channel) continue;
        const stats = this.channelStats[c];
        stats.sampleCount += channel.length;
        for (let i = 0; i < channel.length; i++) {
          const v = channel[i];
          if (v !== 0) {
            stats.nonZeroCount += 1;
            if (!this.hasSeenSignal) {
              this.hasSeenSignal = true;
              this.signalChannel = c;
              this.port.postMessage({ type: "signal-detected", channel: c });
            }
          }
          const abs = v < 0 ? -v : v;
          if (abs > stats.maxAbs) stats.maxAbs = abs;
          stats.sumSq += v * v;
        }
      }

      const channel0 = input[0];
      if (channel0) {
        // Clone the buffer to send it, or store it
        // We store chunks and send them all at once at the end to minimize message passing overhead during recording
        // But for long recordings memory might be an issue. For 1.5s (72k samples) it's ~288KB, totally fine.
        const copy = new Float32Array(channel0);
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

type CompanionHello = {
  type: "hello";
  sampleRate: number;
  channels: number;
  format: string;
  frameSize: number;
};

type CompanionSession = {
  ws: WebSocket;
  hello: CompanionHello;
  buffered: ArrayBuffer[];
  closed: boolean;
};

const requestHostMicAccess = async (debugLog: Record<string, any>) => {
  const result: Record<string, any> = {
    attempted: true,
    method: "unavailable",
  };

  try {
    const win: any = window as any;
    result.hasWindowRequire = typeof win?.require === "function";
    if (!result.hasWindowRequire) {
      debugLog.micAccessRequest = result;
      console.warn("[AutoSync] window.require not available; cannot call electron systemPreferences.");
      return;
    }

    const electron = win.require("electron");
    result.hasElectron = !!electron;
    const systemPreferences = electron?.systemPreferences;
    result.hasSystemPreferences = !!systemPreferences;
    if (systemPreferences?.askForMediaAccess) {
      result.method = "electron.systemPreferences.askForMediaAccess";
      result.media = "microphone";
      try {
        result.granted = await systemPreferences.askForMediaAccess("microphone");
        console.log(`[AutoSync] Mic access request via systemPreferences: ${result.granted}`);
      } catch (e: any) {
        result.error = e?.message || String(e);
        console.warn("[AutoSync] systemPreferences.askForMediaAccess failed:", result.error);
      }
    }
  } catch (e: any) {
    result.error = e?.message || String(e);
    console.warn("[AutoSync] Unable to access electron systemPreferences:", result.error);
  } finally {
    debugLog.micAccessRequest = result;
  }
};

const probeLegacyElectronBridge = (debugLog: Record<string, any>) => {
  const win: any = window as any;
  const candidateKeys = [
    "electron",
    "__electron",
    "ipcRenderer",
    "__ipcRenderer",
    "CiderApp",
    "__PLUGINSYS__",
    "__bridge",
    "bridge",
  ];

  const windowKeys: Record<string, string> = {};
  for (const key of candidateKeys) {
    if (key in win) {
      windowKeys[key] = typeof win[key];
    }
  }

  const probe = {
    windowKeys,
    hasElectronGlobal: !!win.electron,
    hasElectronIpcRenderer: !!win.electron?.ipcRenderer,
    hasIpcRendererGlobal: !!win.ipcRenderer,
    hasCiderAppIpcRenderer: !!win.CiderApp?.ipcRenderer,
    hasCiderAppIpc: !!win.CiderApp?.ipc,
    hasPluginSysExternalMessages: !!win.__PLUGINSYS__?.ExternalMessages?.dispatchEvent,
    hasPluginSysPAPI: !!win.__PLUGINSYS__?.PAPIInstance?.addEventListener,
  };

  debugLog.bridgeProbe = probe;
  console.log("[AutoSync] Bridge probe:", probe);
};

const parseCompanionHello = (value: any): CompanionHello | null => {
  if (!value || value.type !== "hello") return null;
  if (typeof value.sampleRate !== "number") return null;
  if (typeof value.channels !== "number") return null;
  if (typeof value.format !== "string") return null;
  if (typeof value.frameSize !== "number") return null;
  return value as CompanionHello;
};

const connectCompanion = async (
  url: string,
  timeoutMs: number,
  debugLog: Record<string, any>
): Promise<CompanionSession> => {
  debugLog.companionUrl = url;
  return new Promise((resolve, reject) => {
    let resolved = false;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const buffered: ArrayBuffer[] = [];
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch (e) { }
      reject(new Error(`Companion connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    ws.onerror = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error("Companion connection error"));
    };

    ws.onmessage = (event) => {
      if (resolved) return;
      if (typeof event.data === "string") {
        try {
          const parsed = JSON.parse(event.data);
          const hello = parseCompanionHello(parsed);
          if (hello) {
            resolved = true;
            cleanup();
            debugLog.companionConnected = true;
            debugLog.companionHello = hello;
            resolve({ ws, hello, buffered, closed: false });
            return;
          }
        } catch (e) {
          // ignore non-JSON until timeout
        }
      } else if (event.data instanceof ArrayBuffer) {
        buffered.push(event.data);
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => buffered.push(buf));
      }
    };

    ws.onclose = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error("Companion connection closed"));
    };
  });
};

const decodePcm16Frames = (
  buffer: ArrayBuffer,
  channels: number,
  out: number[]
) => {
  const int16 = new Int16Array(buffer);
  const frameCount = Math.floor(int16.length / channels);
  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0;
    const base = i * channels;
    for (let c = 0; c < channels; c += 1) {
      sum += int16[base + c];
    }
    const mono = sum / channels;
    out.push(mono / 32768);
  }
};

const captureCompanionMic = async (
  session: CompanionSession,
  durationMs: number,
  debugLog: Record<string, any>
): Promise<{ samples: Float32Array; sampleRate: number }> => {
  const { ws, hello, buffered } = session;
  const sampleRate = hello.sampleRate;
  const channels = Math.max(1, hello.channels || 1);
  if (hello.format !== "pcm16") {
    throw new Error(`Unsupported companion format: ${hello.format}`);
  }
  const expectedSamples = Math.round((sampleRate * durationMs) / 1000);
  const floats: number[] = [];
  let bytesReceived = 0;

  const addBuffer = (buf: ArrayBuffer) => {
    bytesReceived += buf.byteLength;
    decodePcm16Frames(buf, channels, floats);
  };

  buffered.forEach(addBuffer);
  buffered.length = 0;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ws.onmessage = null;
      ws.onclose = null;
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch (e) { }
      try { ws.close(); } catch (e) { }
      const clipped = floats.slice(0, expectedSamples);
      debugLog.companionBytesReceived = bytesReceived;
      debugLog.companionSamplesReceived = clipped.length;
      resolve({ samples: new Float32Array(clipped), sampleRate });
    };

    const timer = setTimeout(finish, durationMs + 250);

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        addBuffer(event.data);
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => addBuffer(buf));
      } else if (typeof event.data === "string") {
        // ignore control messages
      }
      if (floats.length >= expectedSamples) {
        clearTimeout(timer);
        finish();
      }
    };

    ws.onclose = () => {
      clearTimeout(timer);
      finish();
    };
  });
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

const computeSampleStats = (samples: Float32Array) => {
  const length = samples.length;
  let min = 0;
  let max = 0;
  let absMax = 0;
  let sum = 0;
  let sumSq = 0;
  let nonZeroCount = 0;

  if (length > 0) {
    min = samples[0];
    max = samples[0];
  }

  for (let i = 0; i < length; i += 1) {
    const v = samples[i];
    if (v !== 0) nonZeroCount += 1;
    if (v < min) min = v;
    if (v > max) max = v;
    const abs = v < 0 ? -v : v;
    if (abs > absMax) absMax = abs;
    sum += v;
    sumSq += v * v;
  }

  const mean = length ? sum / length : 0;
  const rms = length ? Math.sqrt(sumSq / length) : 0;
  const zeroPercent = length ? (length - nonZeroCount) / length : 1;

  return {
    length,
    min,
    max,
    absMax,
    mean,
    rms,
    nonZeroCount,
    zeroPercent
  };
};

const formatSampleStats = (stats: ReturnType<typeof computeSampleStats>) => {
  const nonZeroPct = (100 * (1 - stats.zeroPercent)).toFixed(2);
  return `len=${stats.length}, rms=${stats.rms.toFixed(5)}, min=${stats.min.toFixed(5)}, max=${stats.max.toFixed(5)}, absMax=${stats.absMax.toFixed(5)}, nonZero=${nonZeroPct}%`;
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
        if (typeof event.data.channel === "number") {
          debugLog[name + "SignalChannel"] = event.data.channel;
        }
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
          const { buffers, totalSamples, stats } = event.data;
          if (stats) {
            debugLog[name + "WorkletStats"] = stats;
            if (Array.isArray(stats.channelStats)) {
              const channelSummary = stats.channelStats
                .map((s: any, idx: number) => {
                  const rms = typeof s.rms === "number" ? s.rms.toFixed(5) : "n/a";
                  const nonZeroPct = s.sampleCount
                    ? (100 * (s.nonZeroCount / s.sampleCount)).toFixed(2)
                    : "0.00";
                  return `ch${idx}: rms=${rms}, nonZero=${nonZeroPct}%, maxAbs=${typeof s.maxAbs === "number" ? s.maxAbs.toFixed(5) : "n/a"}`;
                })
                .join(" | ");
              console.log(`[AutoSync] ${name} worklet channels: ${channelSummary}`);
            }
          }
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
  let micCaptureSource: "companion" | "browser" = "browser";
  let companionSession: CompanionSession | null = null;

  try {
    // 1. Check Cider Audio
    const audio = useCiderAudio();
    debugLog.hasCiderAudio = !!audio;
    if (!audio) throw new Error("Cider audio not initialized");
    console.log("[AutoSync] Cider audio initialized.");

    // 1.5. Ask host app (if possible) to trigger OS mic permission prompt
    await requestHostMicAccess(debugLog);
    probeLegacyElectronBridge(debugLog);

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

    // 3. Ensure Cider Audio Context is Ready
    //    On Cider 4 the WebAudio graph is skipped entirely in some output modes, so
    //    check for that first rather than waiting out the ready timeout.
    const availability = describeCiderAudioAvailability();
    debugLog.ciderAudioAvailability = availability;
    if (!availability.available && !getSharedAudioContext(audio)) {
      throw new Error(availability.reason || "Cider Audio graph is unavailable.");
    }

    if (!getSharedAudioContext(audio) && typeof audio.init === "function") {
      debugLog.callingInit = true;
      console.log("[AutoSync] Calling Cider audio.init()...");
      await initCiderAudio(audio, settings.readyTimeoutMs);
    }

    debugLog.audioKeys = Object.keys(audio);

    const waitStart = now();
    while (!getSharedAudioContext(audio)) {
      if (now() - waitStart > settings.readyTimeoutMs) {
        throw new Error(
          availability.reason ||
            `Cider Audio Context timed out after ${settings.readyTimeoutMs}ms. Is music playing?`
        );
      }
      await delay(100);
    }

    const ciderContext = getSharedAudioContext(audio) as AudioContext;
    debugLog.ciderContextState = ciderContext.state;
    debugLog.ciderSampleRate = ciderContext.sampleRate;
    console.log("[AutoSync] Cider audio context is ready.");

    if (ciderContext.state === "suspended") {
      try {
        console.log("[AutoSync] Resuming Cider audio context...");
        await ciderContext.resume();
      } catch (e: any) {
        debugLog.resumeError = e.message;
        console.warn("[AutoSync] Error resuming Cider audio context:", e.message);
      }
    }

    // 4. Identify Stream Source (Tap Node)
    // Cider 4 sets `source` to the MKLite middleware node; older builds only expose gainNode.
    const tapNode = audio.source || audio.audioNodes?.gainNode || audio.audioNodes?.airplaygainNode;
    debugLog.hasTapNode = !!tapNode;
    if (!tapNode) {
      throw new Error(
        availability.reason ||
          "Could not find a Cider audio node to tap. Start playback and make sure Cider Audio is enabled."
      );
    }
    console.log("[AutoSync] Cider audio source node identified.");

    // 5. Prepare mic capture (companion or browser)
    let micCapturePromise: Promise<{ samples: Float32Array; sampleRate: number }> | null = null;
    let micSampleRate = 44100;

    if (settings.useCompanionMic) {
      debugLog.companionAttempted = true;
      try {
        companionSession = await connectCompanion(
          settings.companionUrl,
          settings.companionConnectTimeoutMs,
          debugLog
        );
        micCaptureSource = "companion";
        debugLog.micCaptureSource = micCaptureSource;
        micSampleRate = companionSession.hello.sampleRate;
        micCapturePromise = captureCompanionMic(companionSession, settings.durationMs, debugLog);
      } catch (e: any) {
        debugLog.companionError = e?.message || String(e);
        console.warn("[AutoSync] Companion connection failed, falling back to browser mic:", e);
      }
    }

    if (micCaptureSource !== "companion") {
      // 5a. Get Mic Stream (browser path)
      try {
        // Step 5a-1: Enumerate devices to find the correct ID if possible
        // This helps avoid "Virtual" default devices that might not support raw audio
        let deviceId = "default";
        try {
          debugLog.supportedConstraints = navigator.mediaDevices.getSupportedConstraints?.() || {};
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter(d => d.kind === "audioinput");
          debugLog.availableDevices = audioInputs.map(d => ({ label: d.label, id: d.deviceId }));
        } catch (e) {
          console.warn("[AutoSync] Failed to enumerate devices:", e);
        }

        // Step 5a-2: Request Stream with Explicit Constraints
        // User DEMANDS echoCancellation: false.
        // We ADD channelCount: 1 to ensure Mono mics don't get lost in Stereo mapping
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1, // FORCE MONO. Critical for raw capture on some macOS devices.
            // sampleRate: ... we don't set this, we let OS decide and match it with micContext
          },
        });

        debugLog.micStreamId = micStream.id;
        const track = micStream.getAudioTracks()[0];
        const trackSettings = track.getSettings ? track.getSettings() : {};

        debugLog.micTrackSettings = trackSettings;
        debugLog.micTrackState = {
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        };
        if (track.getConstraints) {
          debugLog.micTrackConstraints = track.getConstraints();
        }
        const trackAny = track as any;
        if (typeof trackAny.getCapabilities === "function") {
          try {
            debugLog.micTrackCapabilities = trackAny.getCapabilities();
          } catch (e) {
            debugLog.micTrackCapabilitiesError = String(e);
          }
        }
        debugLog.micStreamActive = micStream.active;
        console.log(`[AutoSync] Mic Stream Obtained. Label: ${track.label}, ID: ${trackSettings.deviceId}`);
        console.log(`[AutoSync] Constraints - EchoCancel: ${trackSettings.echoCancellation}, Channels: ${trackSettings.channelCount}, Rate: ${trackSettings.sampleRate}`);

      } catch (e: any) {
        debugLog.getUserMediaError = {
          name: e.name,
          message: e.message,
          stack: e.stack
        };
        throw new Error(`Microphone access failed: ${e.message}`);
      }

      // 5b. Create a SEPARATE AudioContext for mic at the mic's native sample rate
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

      // 5c. Create mic source in the MIC context (not Cider's context!)
      const micSource = micContext.createMediaStreamSource(micStream);
      debugLog.micSourceNode = {
        channelCount: micSource.channelCount,
        channelCountMode: micSource.channelCountMode,
        channelInterpretation: micSource.channelInterpretation,
        numberOfOutputs: micSource.numberOfOutputs
      };

      // Optional: Boost gain if needed, but start with 1.0 for raw capture
      const micGainNode = micContext.createGain();
      micGainNode.gain.value = settings.micGain || 1.0;
      micSource.connect(micGainNode);

      console.log(`[AutoSync] Mic source created with ${micGainNode.gain.value}x software gain.`);

      micCaptureSource = "browser";
      debugLog.micCaptureSource = micCaptureSource;
      micSampleRate = micContext.sampleRate;
      micCapturePromise = captureAudio(micContext!, micGainNode, settings.durationMs, debugLog, "mic")
        .then((samples) => ({ samples, sampleRate: micContext!.sampleRate }));
    }

    if (!micCapturePromise) {
      throw new Error("Microphone capture could not be initialized.");
    }

    settings.onPhase?.("listening");
    console.log(`[AutoSync] Listening for ${settings.durationMs}ms...`);

    // Capture stream audio from Cider's context, mic audio from companion or browser
    console.log("[AutoSync] Starting capture...");
    const [streamSamples, micCapture] = await Promise.all([
      captureAudio(ciderContext, tapNode, settings.durationMs, debugLog, "stream"),
      micCapturePromise
    ]);
    let micSamples = micCapture.samples;
    micSampleRate = micCapture.sampleRate;

    if (micCaptureSource === "companion" && settings.micGain && settings.micGain !== 1.0) {
      const gain = settings.micGain;
      for (let i = 0; i < micSamples.length; i += 1) {
        let v = micSamples[i] * gain;
        if (v > 1) v = 1;
        if (v < -1) v = -1;
        micSamples[i] = v;
      }
    }

    console.log(`[AutoSync] Capture complete. Stream: ${streamSamples.length} samples, Mic: ${micSamples.length} samples.`);

    // Stop mic (browser path only)
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
      console.log("[AutoSync] Microphone stream stopped.");
    }

    debugLog.capturedSamples = {
      stream: streamSamples.length,
      mic: micSamples.length
    };
    debugLog.expectedSamples = {
      stream: Math.round((ciderContext.sampleRate * settings.durationMs) / 1000),
      mic: Math.round((micSampleRate * settings.durationMs) / 1000)
    };

    settings.onPhase?.("processing");
    console.log("[AutoSync] Starting processing phase...");

    // 8. Resample mic audio to match Cider's sample rate for correlation
    // We use simple linear interpolation resampling
    const resampledMic = resampleLinear(micSamples, micSampleRate, ciderContext.sampleRate);
    debugLog.resampledMicLength = resampledMic.length;
    console.log(`[AutoSync] Mic audio resampled from ${micSampleRate}Hz to ${ciderContext.sampleRate}Hz. Length: ${resampledMic.length}`);

    // Close mic context
    if (micContext) {
      try { await micContext.close(); } catch (e) { console.warn("[AutoSync] Error closing mic context:", e); }
      micContext = null;
      console.log("[AutoSync] Mic audio context closed.");
    }

    // 9. Analysis
    const streamRms = computeRms(streamSamples);
    const micRms = computeRms(resampledMic);

    debugLog.rms = { stream: streamRms, mic: micRms };
    console.log(`[AutoSync] RMS - Stream: ${streamRms.toFixed(5)}, Mic: ${micRms.toFixed(5)}`);

    const streamStats = computeSampleStats(streamSamples);
    const micStats = computeSampleStats(micSamples);
    const resampledMicStats = computeSampleStats(resampledMic);
    debugLog.sampleStats = {
      stream: streamStats,
      mic: micStats,
      resampledMic: resampledMicStats
    };
    console.log(`[AutoSync] Sample stats (stream) ${formatSampleStats(streamStats)}`);
    console.log(`[AutoSync] Sample stats (mic) ${formatSampleStats(micStats)}`);
    console.log(`[AutoSync] Sample stats (mic resampled) ${formatSampleStats(resampledMicStats)}`);

    const micWorkletStats = debugLog.micWorkletStats;
    if (micWorkletStats?.channelStats) {
      const channelRms = micWorkletStats.channelStats.map((s: any) =>
        typeof s.rms === "number" ? s.rms : 0
      );
      const channelNonZeroPct = micWorkletStats.channelStats.map((s: any) =>
        s.sampleCount ? (s.nonZeroCount / s.sampleCount) : 0
      );
      debugLog.micChannelAnalysis = {
        channelRms,
        channelNonZeroPct,
        channel0Silent: channelRms[0] === 0 && channelNonZeroPct[0] === 0,
        anyOtherChannelHasSignal: channelRms.slice(1).some((r: number) => r > 0) ||
          channelNonZeroPct.slice(1).some((p: number) => p > 0)
      };
      if (debugLog.micChannelAnalysis.channel0Silent && debugLog.micChannelAnalysis.anyOtherChannelHasSignal) {
        console.warn("[AutoSync] Mic appears to have signal on a non-zero channel. Possible mono/stereo channel mismatch.");
      }
    }

    if (streamRms < settings.minRms) throw new Error(`Stream Audio too silent (RMS: ${streamRms.toFixed(5)})`);

    if (micRms === 0) {
      if (settings.useCompanionMic && micCaptureSource !== "companion") {
        throw new Error("Companion not running or mic permission blocked. Start the companion app or enable microphone access.");
      }
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
    if (companionSession?.ws) {
      try {
        companionSession.ws.close();
      } catch (e) { }
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
