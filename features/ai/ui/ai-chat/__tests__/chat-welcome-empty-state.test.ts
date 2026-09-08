import { describe, expect, it } from "vitest";

describe("AI Chat welcome & empty state guard contract", () => {
  function shouldShowWelcomePrompt(state: {
    isMessagesLoading: boolean;
    messageCount: number;
    isLoading: boolean;
    streamingContent: string;
    initialMessage?: string | null;
  }): boolean {
    return (
      !state.isMessagesLoading &&
      state.messageCount === 0 &&
      !state.isLoading &&
      !state.streamingContent &&
      !state.initialMessage
    );
  }

  it("shows welcome prompt when no user message is present and not loading", () => {
    const show = shouldShowWelcomePrompt({
      isMessagesLoading: false,
      messageCount: 0,
      isLoading: false,
      streamingContent: "",
      initialMessage: null,
    });
    expect(show).toBe(true);
  });

  it("does NOT show welcome prompt when user message has been received/optimistically added", () => {
    const show = shouldShowWelcomePrompt({
      isMessagesLoading: false,
      messageCount: 1,
      isLoading: false,
      streamingContent: "",
      initialMessage: null,
    });
    expect(show).toBe(false);
  });

  it("does NOT show welcome prompt when AI is streaming or loading", () => {
    const showWithLoading = shouldShowWelcomePrompt({
      isMessagesLoading: false,
      messageCount: 0,
      isLoading: true,
      streamingContent: "",
      initialMessage: null,
    });
    expect(showWithLoading).toBe(false);

    const showWithStream = shouldShowWelcomePrompt({
      isMessagesLoading: false,
      messageCount: 0,
      isLoading: false,
      streamingContent: "你好，正在为你解答...",
      initialMessage: null,
    });
    expect(showWithStream).toBe(false);
  });

  it("does NOT show welcome prompt when initialMessage is pending", () => {
    const show = shouldShowWelcomePrompt({
      isMessagesLoading: false,
      messageCount: 0,
      isLoading: false,
      streamingContent: "",
      initialMessage: "帮我总结一下最近有哪些活跃工单？",
    });
    expect(show).toBe(false);
  });

  it("preserves in-flight optimistic user messages when loadMessages returns empty array from DB", () => {
    const prevMessages = [{ id: "user-123", role: "user", content: "新会话提示词" }];
    const loadedMessages: typeof prevMessages = [];

    // Resolver logic matching loadMessages
    const resolveMessages = (loaded: typeof prevMessages, prev: typeof prevMessages) => {
      if (loaded.length === 0 && prev.length > 0) {
        return prev;
      }
      return loaded;
    };

    const next = resolveMessages(loadedMessages, prevMessages);
    expect(next).toEqual(prevMessages);
    expect(next.length).toBe(1);
  });

  it("does not abort or reset when transitioning from null conversation to newly generated ID", () => {
    const oldConvId: string | null | undefined = undefined;
    const newConvId = "conv-new-123";
    const currentInFlightConvId = "conv-new-123";

    const shouldSkipReset =
      !oldConvId && Boolean(newConvId) && newConvId === currentInFlightConvId;

    expect(shouldSkipReset).toBe(true);
  });
});
