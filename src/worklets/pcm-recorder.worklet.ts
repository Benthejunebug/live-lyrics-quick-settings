/**
 * PCM Recorder AudioWorklet Processor
 *
 * Batches ~2048 frames of mono audio before posting to the main thread.
 * Each posted chunk is a copied Float32Array transferred (not cloned).
 */

const BATCH_SIZE = 2048;

class RecorderProcessor extends AudioWorkletProcessor {
    private buffer: Float32Array;
    private writeIndex: number;

    constructor() {
        super();
        this.buffer = new Float32Array(BATCH_SIZE);
        this.writeIndex = 0;
    }

    process(inputs: Float32Array[][], _outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channelData = input[0]; // mono — take first channel

        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.writeIndex++] = channelData[i];

            if (this.writeIndex >= BATCH_SIZE) {
                // Copy and transfer
                const chunk = new Float32Array(this.buffer);
                this.port.postMessage(chunk, [chunk.buffer]);
                this.writeIndex = 0;
            }
        }

        return true;
    }
}

registerProcessor('pcm-recorder', RecorderProcessor);
