class Pcm16Processor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0 && input[0].length > 0) {
      this.port.postMessage(input[0], [input[0].buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-processor", Pcm16Processor);
