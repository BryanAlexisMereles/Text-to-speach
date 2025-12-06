const statusMessage = document.getElementById("status");
const engineSelector = document.getElementById("engineSelector");

let audioCtx = null;
let originalBuffer = null;

const tonePitch = document.getElementById("tonePitch");
const tonePitchVal = document.getElementById("tonePitchVal");
const toneWindow = document.getElementById("toneWindow");
const toneWindowVal = document.getElementById("toneWindowVal");
const toneDelay = document.getElementById("toneDelay");
const toneDelayVal = document.getElementById("toneDelayVal");
const toneVolume = document.getElementById("toneVolume");
const toneVolumeVal = document.getElementById("toneVolumeVal");

tonePitch.oninput = () => (tonePitchVal.innerText = tonePitch.value);
toneWindow.oninput = () => (toneWindowVal.innerText = toneWindow.value);
toneDelay.oninput = () => (toneDelayVal.innerText = toneDelay.value);
toneVolume.oninput = () => (toneVolumeVal.innerText = toneVolume.value);

const soundControls = document.getElementById("soundControls");
const soundPitch = document.getElementById("soundPitch");
const soundPitchVal = document.getElementById("soundPitchVal");
const soundPitchSemitones = document.getElementById("soundPitchSemitones");
const soundPitchSemitonesVal = document.getElementById(
  "soundPitchSemitonesVal"
);
const soundRate = document.getElementById("soundRate");
const soundRateVal = document.getElementById("soundRateVal");
const soundTempo = document.getElementById("soundTempo");
const soundTempoVal = document.getElementById("soundTempoVal");

soundPitch.oninput = () => (soundPitchVal.innerText = soundPitch.value);
soundPitchSemitones.oninput = () =>
  (soundPitchSemitonesVal.innerText = soundPitchSemitones.value);
soundRate.oninput = () => (soundRateVal.innerText = soundRate.value);
soundTempo.oninput = () => (soundTempoVal.innerText = soundTempo.value);

const convertBtn = document.getElementById("convert");
const playBtn = document.getElementById("play");
const stopBtn = document.getElementById("stop");
const recordBtn = document.getElementById("recordMp3");
const downloadBtn = document.getElementById("downloadMp3");

async function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch (e) {
      console.error("Resume audioCtx failed", e);
    }
  }
  return audioCtx;
}

let recorderWorkletLoaded = false;
async function ensureRecorderWorklet() {
  await ensureAudioCtx();

  let ctx =
    Tone.getContext?.()?.rawContext ??
    Tone.getContext?.()?.context ??
    Tone.context?.rawContext ??
    null;
  const native = ctx?._nativeContext || ctx;

  if (!native || !native.audioWorklet) {
    throw new Error("AudioWorklet not available");
  }

  if (!recorderWorkletLoaded) {
    await native.audioWorklet.addModule("./scripts/tone-recorder-worklet.js");
    recorderWorkletLoaded = true;
  }
  return native;
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels,
    sampleRate = buffer.sampleRate,
    bitDepth = 16;
  const numSamples = buffer.length,
    blockAlign = numChannels * (bitDepth / 8);
  const ab = new ArrayBuffer(44 + numSamples * blockAlign);
  const view = new DataView(ab);
  let offset = 0;
  function writeString(off, s) {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  }
  writeString(offset, "RIFF");
  offset += 4;
  view.setUint32(offset, 36 + numSamples * blockAlign, true);
  offset += 4;
  writeString(offset, "WAVE");
  offset += 4;
  writeString(offset, "fmt ");
  offset += 4;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitDepth, true);
  offset += 2;
  writeString(offset, "data");
  offset += 4;
  view.setUint32(offset, numSamples * blockAlign, true);
  offset += 4;
  const channels = [];
  for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));
  let pos = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return ab;
}

function floatTo16BitPCM(float32Array) {
  const l = float32Array.length;
  const out = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function interleaveChannels(channels) {
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len * channels.length);
  let idx = 0;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < channels.length; c++) out[idx++] = channels[c][i];
  return out;
}

class ToneEngine {
  constructor() {
    this.player = null;
    this.pitchShift = null;
    this.outputGain = null;
    this.loaded = false;
    this._url = null;
    this._isPlaying = false;
    this._recNode = null;
    this._receivedBuffers = null;
    this._recSampleRate = null;
    this._recChannels = 1;
    this._splitter = null;
    this._silentGain = null;
    this._internalOutput = null;
  }

  async load(audioBuffer) {
    const wavAb = audioBufferToWav(audioBuffer);
    const blob = new Blob([wavAb], { type: "audio/wav" });
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = URL.createObjectURL(blob);

    if (this.player) {
      try {
        this.player.stop();
        this.player.dispose?.();
      } catch (e) {}
    }
    if (this.pitchShift) {
      try {
        this.pitchShift.dispose?.();
      } catch (e) {}
    }
    if (this.outputGain) {
      try {
        this.outputGain.dispose?.();
      } catch (e) {}
    }

    this.pitchShift = new Tone.PitchShift({
      pitch: parseFloat(tonePitch.value) || 0,
      windowSize: parseFloat(toneWindow.value) || 0.02,
      delayTime: parseFloat(toneDelay.value) || 0,
    });

    this.outputGain = new Tone.Gain(1).toDestination();

    this.pitchShift.connect(this.outputGain);

    return new Promise((resolve, reject) => {
      this.player = new Tone.Player({
        url: this._url,
        autostart: false,
        onload: () => {
          this.loaded = true;
          resolve();
        },
        onerror: (err) => reject(err),
      }).connect(this.pitchShift);
    });
  }

  async play() {
    if (!this.loaded) return;
    try {
      this.player.stop();
    } catch (e) {}
    this.player.start();
    this._isPlaying = true;
  }

  stop() {
    try {
      this.player.stop();
    } catch (e) {}
    this._isPlaying = false;
  }

  async setWindowSize(newWindowSize) {
    const wasPlaying = this._isPlaying;
    const prevPitch =
      this.pitchShift?.pitch || parseFloat(tonePitch.value) || 0;
    const prevDelay =
      this.pitchShift?.delayTime?.value || parseFloat(toneDelay.value) || 0;

    this.pitchShift.dispose?.();
    this.pitchShift = new Tone.PitchShift({
      pitch: prevPitch,
      windowSize: parseFloat(newWindowSize),
      delayTime: prevDelay,
    });

    this.pitchShift.connect(this.outputGain);
    if (this.player) this.player.connect(this.pitchShift);
    if (wasPlaying) {
      this.player.stop();
      this.player.start();
    }
  }

  async startRecording() {
    if (!this.loaded) throw new Error("ToneEngine: not loaded");

    const ctx = await ensureRecorderWorklet();

    this._recChannels = originalBuffer?.numberOfChannels || 1;
    this._receivedBuffers = Array.from({ length: this._recChannels }, () => []);
    this._recSampleRate = ctx.sampleRate;

    this._recNode = new AudioWorkletNode(ctx, "tone-recorder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      outputChannelCount: [],
      channelCount: this._recChannels,
      channelCountMode: "explicit",
      processorOptions: { channels: this._recChannels },
    });

    this._recNode.port.onmessage = (ev) => {
      if (ev.data?.type === "chunk") {
        ev.data.buffers.forEach((b, i) =>
          this._receivedBuffers[i].push(new Float32Array(b))
        );
      }
    };

    const findNativeNode = (obj) => {
      if (!obj || typeof obj !== "object") return null;

      try {
        if (obj._gainNode instanceof GainNode) return obj._gainNode;
      } catch (e) {}
      try {
        if (obj._output instanceof AudioNode) return obj._output;
      } catch (e) {}
      try {
        if (obj.input instanceof AudioNode) return obj.input;
      } catch (e) {}
      try {
        if (obj.output instanceof AudioNode) return obj.output;
      } catch (e) {}

      for (const key of Object.keys(obj)) {
        try {
          const val = obj[key];
          if (val instanceof AudioNode) return val;
          const deep = findNativeNode(val);
          if (deep) return deep;
        } catch (e) {}
      }

      return null;
    };

    const nativeOut = findNativeNode(this.pitchShift);

    if (!nativeOut) {
      console.error("Native out not found");
      return;
    }

    this._splitter = ctx.createChannelSplitter(this._recChannels);

    try {
      nativeOut.connect(this._splitter);
    } catch (e) {
      console.error("nativeOut.connect(splitter) failed", e);
      try {
        const tapGain = new Tone.Gain(1);
        this.pitchShift.connect(tapGain);
        const nativeTap = findNativeNode(tapGain);
        if (nativeTap) nativeTap.connect(this._splitter);
        else console.error("Native mode not accesible by Tone.Gain");
      } catch (err) {
        console.error("Fallback connect attempt failed:", err);
      }
    }

    for (let ch = 0; ch < this._recChannels; ch++) {
      try {
        this._splitter.connect(this._recNode, ch, ch);
      } catch (e) {
        console.error("recNode connect failed for channel", ch, e);
      }
    }
  }

  stopRecording() {
    if (!this._recNode) return null;

    try {
      if (this._internalOutput?.disconnect)
        this._internalOutput.disconnect(this._splitter);
    } catch (e) {}
    try {
      if (this._splitter) this._splitter.disconnect();
    } catch (e) {}
    try {
      this._recNode.port.onmessage = null;
    } catch (e) {}

    const finalChannels = this._receivedBuffers.map((arr) => {
      const len = arr.reduce((s, x) => s + x.length, 0);
      const out = new Float32Array(len);
      let off = 0;
      arr.forEach((chunk) => {
        out.set(chunk, off);
        off += chunk.length;
      });
      return out;
    });

    this._receivedBuffers = null;
    this._recNode = null;
    this._splitter = null;
    this._internalOutput = null;

    return {
      sampleRate: this._recSampleRate,
      channelData: finalChannels,
    };
  }

  async exportMp3() {
    await this.startRecording();

    await this.play();

    await new Promise((r) =>
      setTimeout(r, (originalBuffer.duration + 0.3) * 1000)
    );
    this.stop();

    const rec = this.stopRecording();
    if (!rec) throw new Error("Recorder returned empty data");

    const { channelData, sampleRate } = rec;

    const inter = interleaveChannels(channelData);
    const pcm16 = floatTo16BitPCM(inter);

    const mp3enc = new lamejs.Mp3Encoder(channelData.length, sampleRate, 128);
    const chunk = 1152;
    const parts = [];

    for (let i = 0; i < pcm16.length; i += chunk) {
      const buf = mp3enc.encodeBuffer(pcm16.subarray(i, i + chunk));
      if (buf.length) parts.push(buf);
    }
    const tail = mp3enc.flush();
    if (tail.length) parts.push(tail);

    return new Blob(parts, { type: "audio/mp3" });
  }
}

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.node = null;
    this.gain = null;
    this.loaded = false;
    this._workletLoaded = false;
  }

  async load(audioBuffer) {
    this.ctx = await ensureAudioCtx();
    this.buffer = audioBuffer;

    if (!this._workletLoaded) {
      try {
        await this.ctx.audioWorklet.addModule(
          "./scripts/SoundTouch-worklet.js"
        );
        this._workletLoaded = true;
      } catch (e) {
        console.error(
          "audioWorklet.addModule(SoundTouch-worklet.js) error:",
          e
        );
      }
    }

    if (!this.gain) {
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1;
      this.gain.connect(this.ctx.destination);
    }

    this.loaded = true;
  }

  _createSource(ctx) {
    if (!this.buffer) return null;
    const s = ctx.createBufferSource();
    s.buffer = this.buffer;
    return s;
  }

  async play() {
    if (!this.loaded) return;

    try {
      this.source?.stop();
    } catch (e) {}
    this.source = this._createSource(this.ctx);

    if (this.node) {
      try {
        this.node.disconnect();
      } catch (e) {}
      this.node = null;
    }

    this.node = new AudioWorkletNode(this.ctx, "soundtouch-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.source.connect(this.node);
    this.node.connect(this.gain);

    this.setParam("pitch", parseFloat(soundPitch.value));
    this.setParam("pitchSemitones", parseFloat(soundPitchSemitones.value));
    this.setParam("rate", parseFloat(soundRate.value));
    this.setParam("tempo", parseFloat(soundTempo.value));

    this.source.start();
  }

  stop() {
    try {
      this.source?.stop();
    } catch (e) {}
    try {
      this.node?.disconnect();
    } catch (e) {}
  }

  setParam(name, value) {
    if (!this.node) return;
    const param = this.node.parameters.get(name);
    if (param) param.setValueAtTime(value, this.ctx.currentTime);
    else this.node.port.postMessage({ type: "setParam", name, value });
  }

  async exportMp3() {
    if (!this.loaded) throw new Error("SoundEngine: not loaded");
    if (!this.buffer) throw new Error("SoundEngine: no buffer");

    const sr = this.buffer.sampleRate;
    const chCount = this.buffer.numberOfChannels || 1;
    const length = this.buffer.length;
    const duration = this.buffer.duration;

    const offline = new OfflineAudioContext(chCount, length, sr);

    try {
      await offline.audioWorklet.addModule("./scripts/SoundTouch-worklet.js");
    } catch (e) {
      console.error("Failed to add SoundTouch to offline audioWorklet:", e);
      throw e;
    }

    const node = new AudioWorkletNode(offline, "soundtouch-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: Array(chCount)
        .fill(1)
        .map((_, i) => chCount)[0]
        ? [chCount]
        : [1],
    });

    const src = offline.createBufferSource();
    const offlineBuf = offline.createBuffer(chCount, length, sr);
    for (let ch = 0; ch < chCount; ch++) {
      offlineBuf.getChannelData(ch).set(this.buffer.getChannelData(ch));
    }
    src.buffer = offlineBuf;

    src.connect(node);
    node.connect(offline.destination);

    const setParam = (name, val) => {
      const p = node.parameters.get(name);
      if (p) {
        try {
          p.setValueAtTime(val, 0);
        } catch (e) {}
      } else {
        try {
          node.port.postMessage({ type: "setParam", name, value: val });
        } catch (e) {}
      }
    };

    setParam("pitch", parseFloat(soundPitch.value));
    setParam("pitchSemitones", parseFloat(soundPitchSemitones.value));
    setParam("rate", parseFloat(soundRate.value));
    setParam("tempo", parseFloat(soundTempo.value));

    src.start(0);
    const rendered = await offline.startRendering();

    const channelsArr = [];
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      channelsArr.push(rendered.getChannelData(c));
    }
    const inter = interleaveChannels(channelsArr);
    const pcm16 = floatTo16BitPCM(inter);
    const mp3enc = new lamejs.Mp3Encoder(rendered.numberOfChannels, sr, 128);
    const chunk = 1152;
    const parts = [];
    for (let i = 0; i < pcm16.length; i += chunk) {
      const buf = mp3enc.encodeBuffer(pcm16.subarray(i, i + chunk));
      if (buf.length) parts.push(buf);
    }
    const tail = mp3enc.flush();
    if (tail.length) parts.push(tail);
    return new Blob(parts, { type: "audio/mp3" });
  }
}

const toneEngine = new ToneEngine();
const soundEngine = new SoundEngine();
let currentEngine = toneEngine;

function showControlsForEngine(engineName) {
  document
    .getElementById("toneControls")
    .classList.toggle("hidden", engineName !== "tone");
  document
    .getElementById("soundControls")
    .classList.toggle("hidden", engineName !== "sound");

  if (engineName === "tone") {
    recordBtn.classList.remove("hidden");
    downloadBtn.classList.add("hidden");
  } else {
    recordBtn.classList.add("hidden");
    downloadBtn.classList.remove("hidden");
  }
}

engineSelector.addEventListener("change", async () => {
  const val = engineSelector.value;
  statusMessage.textContent = `Switching to ${val}...`;

  try {
    currentEngine.stop();
  } catch (e) {}

  currentEngine = val === "tone" ? toneEngine : soundEngine;
  showControlsForEngine(val);

  if (originalBuffer) {
    if (!currentEngine.loaded) {
      statusMessage.textContent = "Loading audio into new engine...";
      await currentEngine.load(originalBuffer);
    }
    statusMessage.textContent = `Engine ${val} ready`;
    playBtn.disabled = false;
    stopBtn.disabled = false;
    if (val === "tone") recordBtn.disabled = false;
    else downloadBtn.disabled = false;
  } else {
    statusMessage.textContent = "Ready. Generate TTS";
  }
});

convertBtn.addEventListener("click", async () => {
  try {
    statusMessage.textContent = "Requesting TTS...";
    await ensureAudioCtx();
    const apiKey = document.getElementById("openaiApiKey").value?.trim();
    if (!apiKey) {
      statusMessage.textContent = "Provide API key";
      return;
    }

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: document.getElementById("inputText").value,
        voice: document.getElementById("voiceSelector").value,
        instructions: document.getElementById("instructions").value,
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("TTS error: " + res.status + " " + t);
    }

    const ab = await res.arrayBuffer();
    await ensureAudioCtx();
    originalBuffer = await audioCtx.decodeAudioData(ab);

    const engineName = engineSelector.value;
    currentEngine = engineName === "tone" ? toneEngine : soundEngine;
    await currentEngine.load(originalBuffer);

    playBtn.disabled = false;
    stopBtn.disabled = false;
    if (engineName === "tone") {
      recordBtn.disabled = false;
      downloadBtn.disabled = true;
    } else {
      downloadBtn.disabled = false;
      recordBtn.disabled = true;
    }
    statusMessage.textContent = `Audio of ${document
      .getElementById("voiceSelector")
      .value.toUpperCase()} voice ready.`;
  } catch (e) {
    console.error(e);
    statusMessage.textContent = "TTS failed: " + (e.message || e);
  }
});

playBtn.addEventListener("click", async () => {
  if (!originalBuffer) {
    alert("Generate TTS first");
    return;
  }
  if (!currentEngine.loaded) await currentEngine.load(originalBuffer);
  await currentEngine.play();
  statusMessage.textContent = "Playing...";
  const timer = setTimeout(() => {
    statusMessage.textContent = "Ready to play.";
    clearTimeout(timer);
  }, 2000);
});

stopBtn.addEventListener("click", () => {
  currentEngine.stop();
  statusMessage.textContent = "Stopped";
});

tonePitch.addEventListener("input", () => {
  if (
    currentEngine === toneEngine &&
    toneEngine.loaded &&
    toneEngine.pitchShift
  )
    toneEngine.pitchShift.pitch = parseFloat(tonePitch.value);
});

toneDelay.addEventListener("input", () => {
  if (
    currentEngine === toneEngine &&
    toneEngine.loaded &&
    toneEngine.pitchShift
  )
    toneEngine.pitchShift.delayTime.value = parseFloat(toneDelay.value);
});

toneVolume.addEventListener("input", () => {
  if (currentEngine === toneEngine && toneEngine.loaded && toneEngine.player)
    toneEngine.player.volume.value = parseFloat(toneVolume.value);
});

toneWindow.addEventListener("change", async () => {
  if (!toneEngine.loaded) return;
  await toneEngine.setWindowSize(parseFloat(toneWindow.value));
});

soundPitch.addEventListener("input", () => {
  if (currentEngine === soundEngine)
    soundEngine.setParam("pitch", parseFloat(soundPitch.value));
});

soundPitchSemitones.addEventListener("input", () => {
  if (currentEngine === soundEngine)
    soundEngine.setParam(
      "pitchSemitones",
      parseFloat(soundPitchSemitones.value)
    );
});

soundRate.addEventListener("input", () => {
  if (currentEngine === soundEngine)
    soundEngine.setParam("rate", parseFloat(soundRate.value));
});

soundTempo.addEventListener("input", () => {
  if (currentEngine === soundEngine)
    soundEngine.setParam("tempo", parseFloat(soundTempo.value));
});

recordBtn.addEventListener("click", async () => {
  if (!originalBuffer) {
    alert("Generate TTS first");
    return;
  }
  try {
    if (!toneEngine.loaded) await toneEngine.load(originalBuffer);
    statusMessage.textContent = "Recording ToneEngine in real-time...";
    const blob = await toneEngine.exportMp3();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tone_recorded.mp3";
    a.click();
    URL.revokeObjectURL(url);
    statusMessage.textContent = "MP3 ready (Tone)";
  } catch (e) {
    console.error(e);
    statusMessage.textContent = "Recording failed: " + (e.message || e);
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!originalBuffer) {
    alert("Generate TTS first");
    return;
  }
  try {
    if (!soundEngine.loaded) await soundEngine.load(originalBuffer);
    statusMessage.textContent =
      "Exporting MP3 (SoundTouch) — rendering offline...";
    const blob = await soundEngine.exportMp3();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "soundtouch_recorded.mp3";
    a.click();
    URL.revokeObjectURL(url);
    statusMessage.textContent = "MP3 ready (SoundTouch)";
  } catch (e) {
    console.error(e);
    statusMessage.textContent = "Download failed: " + (e.message || e);
  }
});

showControlsForEngine(engineSelector.value);
