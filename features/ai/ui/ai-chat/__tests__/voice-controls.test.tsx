import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiChatInput } from "../AiChatInput";
import { VoiceConversationOverlay } from "../VoiceConversationOverlay";

describe("AI Chat voice controls", () => {
  it("exposes separate accessible controls for voice input and conversation", () => {
    const onVoiceInput = vi.fn();
    const onVoiceChat = vi.fn();

    render(
      <AiChatInput
        onSend={vi.fn()}
        onVoiceInput={onVoiceInput}
        onVoiceChat={onVoiceChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    fireEvent.click(screen.getByRole("button", { name: "语音对话" }));

    expect(onVoiceInput).toHaveBeenCalledOnce();
    expect(onVoiceChat).toHaveBeenCalledOnce();
  });

  it("labels and exposes a cancellation control while a voice conversation is active", () => {
    const onStopVoiceChat = vi.fn();
    const { rerender } = render(
      <AiChatInput
        onSend={vi.fn()}
        voiceChatActive
        onStopVoiceChat={onStopVoiceChat}
      />,
    );

    expect(screen.getByRole("button", { name: "停止语音对话" })).toBeTruthy();

    rerender(
      <VoiceConversationOverlay status="listening" onStop={onStopVoiceChat} />,
    );
    expect(screen.getByRole("dialog", { name: "语音对话" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "结束语音对话" }));
    expect(onStopVoiceChat).toHaveBeenCalledOnce();
  });

  it("renders spoken user text, streamed AI reply, and speech completion button on the overlay", () => {
    const onFinishSpeaking = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <VoiceConversationOverlay
        status="listening"
        userText="用户说的话"
        aiText="AI回复的内容"
        onStop={onStop}
        onFinishSpeaking={onFinishSpeaking}
      />,
    );

    expect(screen.getByText("用户说的话")).toBeTruthy();
    expect(screen.getByText("AI回复的内容")).toBeTruthy();
    expect(screen.getByRole("button", { name: "我说完了" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "我说完了" }));
    expect(onFinishSpeaking).toHaveBeenCalledOnce();

    rerender(
      <VoiceConversationOverlay
        status="speaking"
        userText="用户说的话"
        aiText="AI回复的内容"
        onStop={onStop}
        onFinishSpeaking={onFinishSpeaking}
      />,
    );
    expect(screen.getByText("正在回答…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "我说完了" })).toBeNull();
  });
});
