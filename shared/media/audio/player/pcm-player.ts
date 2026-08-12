import { base64ToArrayBuffer } from "../pcm/base64";

export class PCMPlayer {
  private audioContext: AudioContext | null = null;
  private nextPlayTime = 0;
  private isInitialized = false;

  async init() {
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.nextPlayTime = this.audioContext.currentTime;
    this.isInitialized = true;
  }

  playChunk(base64Audio: string) {
    if (!this.audioContext || !this.isInitialized) return;

    const buffer = base64ToArrayBuffer(base64Audio);
    const int16Array = new Int16Array(buffer);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }

    const audioBuffer = this.audioContext.createBuffer(
      1, // mono
      float32Array.length,
      16000
    );
    audioBuffer.copyToChannel(float32Array, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    if (this.nextPlayTime < this.audioContext.currentTime) {
      this.nextPlayTime = this.audioContext.currentTime;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;
  }

  close() {
    this.audioContext?.close();
    this.audioContext = null;
    this.isInitialized = false;
  }
}
