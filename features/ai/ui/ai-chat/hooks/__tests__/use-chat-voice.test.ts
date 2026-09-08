import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanMarkdownForTts, useChatVoice } from "../use-chat-voice";

class MockRecorder {
  static instances: MockRecorder[] = [];
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(stream: MediaStream) {
    void stream;
    MockRecorder.instances.push(this);
  }

  start() {}

  stop() {
    this.ondataavailable?.({
      data: new Blob(["voice"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

class MockFileReader {
  result = "data:audio/webm;base64,dGVzdA==";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL() {
    this.onload?.();
  }
}

function installRecordingGlobals(track = { stop: vi.fn() }) {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }),
    },
  });
  vi.stubGlobal("MediaRecorder", MockRecorder);
  vi.stubGlobal("FileReader", MockFileReader);
  return track;
}

afterEach(() => {
  MockRecorder.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChatVoice", () => {
  it("writes a successful voice input transcript without sending it", async () => {
    const track = installRecordingGlobals();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { text: "转录内容" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onVoiceInput = vi.fn();
    const onVoiceChat = vi.fn();
    const { result } = renderHook(() =>
      useChatVoice({ onVoiceInput, onVoiceChat }),
    );

    await act(async () => result.current.toggleInput());
    expect(result.current.inputStatus).toBe("recording");

    await act(async () => result.current.toggleInput());
    await waitFor(() => expect(onVoiceInput).toHaveBeenCalledWith("转录内容"));

    expect(onVoiceChat).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/audio/transcribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(track.stop).toHaveBeenCalled();
  });

  it("does not submit a voice chat when transcription is empty", async () => {
    installRecordingGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { text: "" } }),
      }),
    );
    const onVoiceChat = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useChatVoice({ onVoiceInput: vi.fn(), onVoiceChat, onError }),
    );

    await act(async () => result.current.toggleChat());
    await act(async () => result.current.toggleChat());

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("未识别到语音内容"),
    );
    expect(onVoiceChat).not.toHaveBeenCalled();
    expect(result.current.chatStatus).toBe("error");
  });

  it("sends the voice transcript through the chat callback and plays its reply", async () => {
    installRecordingGlobals();
    const play = vi.fn().mockImplementation(async function (this: MockAudio) {
      this.onended?.();
    });
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = play;
      constructor(url: string) {
        void url;
      }
    }
    const createObjectURL = vi.fn(() => "blob:voice-reply");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { text: "语音提问" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["reply"], { type: "audio/mp3" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const onVoiceChat = vi.fn().mockResolvedValue("模型回复");
    const { result } = renderHook(() =>
      useChatVoice({ onVoiceInput: vi.fn(), onVoiceChat }),
    );

    await act(async () => result.current.toggleChat());
    await act(async () => result.current.toggleChat());

    await waitFor(() =>
      expect(onVoiceChat).toHaveBeenCalledWith("语音提问", expect.any(Function)),
    );
    await waitFor(() => expect(play).toHaveBeenCalled());
    await waitFor(() => expect(result.current.chatStatus).toBe("idle"));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/ai/audio/synthesize",
      expect.objectContaining({ method: "POST" }),
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:voice-reply");
  });

  it("cancels pending microphone setup without creating a recorder", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    const track = { stop: vi.fn() };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("MediaRecorder", MockRecorder);
    const { result } = renderHook(() =>
      useChatVoice({ onVoiceInput: vi.fn(), onVoiceChat: vi.fn() }),
    );

    await act(async () => result.current.toggleChat());
    act(() => result.current.stopVoiceChat());
    await act(async () =>
      resolveStream?.({ getTracks: () => [track] } as unknown as MediaStream),
    );

    expect(track.stop).toHaveBeenCalled();
    expect(MockRecorder.instances).toHaveLength(0);
    expect(result.current.chatStatus).toBe("idle");
  });

  it("cleans markdown syntax into natural spoken text for TTS", () => {
    const raw = "## 👤 用户画像\n\n- **姓名**: cary\n- **角色**: ROOT\n[链接](https://example.com)";
    const cleaned = cleanMarkdownForTts(raw);
    expect(cleaned).not.toContain("##");
    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("https://");
    expect(cleaned).toContain("cary");
    expect(cleaned).toContain("ROOT");
  });

  it("streams and synthesizes sentences incrementally as tokens arrive", async () => {
    installRecordingGlobals();
    const play = vi.fn().mockImplementation(async function (this: MockAudio) {
      this.onended?.();
    });
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = play;
      constructor(url: string) {
        void url;
      }
    }
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:sentence-audio"),
      revokeObjectURL: vi.fn(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { text: "请介绍一下" } }),
      })
      .mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["chunk"], { type: "audio/mp3" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const onVoiceChat = vi.fn().mockImplementation(async (_text, onDelta) => {
      onDelta?.("第一句话是欢迎你。", "第一句话是欢迎你。");
      onDelta?.("第二句话是这是流式播报。", "第一句话是欢迎你。第二句话是这是流式播报。");
      return "第一句话是欢迎你。第二句话是这是流式播报。";
    });
    const { result } = renderHook(() =>
      useChatVoice({ onVoiceInput: vi.fn(), onVoiceChat }),
    );

    await act(async () => result.current.toggleChat());
    await act(async () => result.current.toggleChat());

    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(result.current.aiResponseText).toContain("第二句话是这是流式播报");
  });

  it("automatically starts second round of dialogue when continuous is enabled", async () => {
    installRecordingGlobals();
    const play = vi.fn().mockImplementation(async function (this: MockAudio) {
      this.onended?.();
    });
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = play;
      constructor(url: string) {
        void url;
      }
    }
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:multi-turn-audio"),
      revokeObjectURL: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { text: "第一轮问题" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["chunk1"], { type: "audio/mp3" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { text: "第二轮问题" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["chunk2"], { type: "audio/mp3" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const onVoiceChat = vi.fn().mockImplementation(async (text) => {
      return text === "第一轮问题" ? "第一轮回答完成。" : "第二轮回答完成。";
    });

    const { result } = renderHook(() =>
      useChatVoice({ onVoiceInput: vi.fn(), onVoiceChat, continuous: true }),
    );

    // Turn 1
    await act(async () => result.current.toggleChat());
    await act(async () => result.current.toggleChat());
    await waitFor(() =>
      expect(onVoiceChat).toHaveBeenCalledWith("第一轮问题", expect.any(Function)),
    );

    // Turn 2 自动重启录音监听，继续下一轮人声检测并触发回答
    await waitFor(() => expect(result.current.chatStatus).toBe("recording"));
    await act(async () => result.current.finishSpeaking());
    await waitFor(() =>
      expect(onVoiceChat).toHaveBeenCalledWith("第二轮问题", expect.any(Function)),
    );
  });
});
