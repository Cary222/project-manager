import { describe, expect, it } from "vitest";
import { meetingUploadFileName } from "./meeting-upload";

describe("meetingUploadFileName", () => {
  it("keeps an allowed suffix while removing non-ASCII multipart filename input", () => {
    expect(
      meetingUploadFileName(new File(["audio"], "2026年09月04日 14点09分.mp3")),
    ).toBe("meeting-audio.mp3");
  });
});
