import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSpeechInput } from "../use-speech-input";

class MockRecorder {
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(stream: MediaStream) {
    void stream;
  }
  start() {}
  stop() {
    this.ondataavailable?.({
      data: new Blob(["voice"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

describe("useSpeechInput", () => {
  it("uses the existing file-transcription endpoint instead of Realtime", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      },
    });
    vi.stubGlobal("MediaRecorder", MockRecorder);
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:audio/webm;base64,dGVzdA==";
        onload: (() => void) | null = null;
        readAsDataURL() {
          this.onload?.();
        }
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: { text: "会议转录" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const onTranscribe = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onTranscribe }));

    await act(async () => {
      await result.current.startRecording();
    });
    await act(async () => {
      result.current.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/audio/transcribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onTranscribe).toHaveBeenCalledWith("会议转录");
  });
});
