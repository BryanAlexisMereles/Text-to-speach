if (globalThis.__tone_recorder_registered) {
} else {
  globalThis.__tone_recorder_registered = true;

  class RecorderProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this._channels = options?.processorOptions?.channels || 1;
    }

    process(inputs) {
      const input = inputs[0];
      if (!input || input.length === 0) return true;

      const buffers = [];
      for (let ch = 0; ch < this._channels; ch++) {
        const chan = input[ch] || new Float32Array(128);
        const copy = new Float32Array(chan.length);
        copy.set(chan);
        buffers.push(copy);
      }

      this.port.postMessage(
        { type: "chunk", buffers },
        buffers.map((b) => b.buffer)
      );
      return true;
    }
  }

  registerProcessor("tone-recorder-processor", RecorderProcessor);
}
