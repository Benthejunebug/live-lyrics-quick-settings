// @ts-nocheck
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.writeIndex] = channel[i];
      this.writeIndex += 1;

      if (this.writeIndex >= this.bufferSize) {
        const chunk = this.buffer.slice(0);
        this.port.postMessage({ type: "chunk", samples: chunk }, [chunk.buffer]);
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-recorder", RecorderProcessor);
