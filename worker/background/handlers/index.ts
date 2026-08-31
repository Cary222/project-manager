import { registerHandler } from "../dispatcher";
import { handleImageGenerate } from "./image.handler";
import { handleVideoGenerate } from "./video.handler";
import { handleMeetingProcess } from "./meeting.handler";

export function registerAllHandlers(): void {
  registerHandler("IMAGE_GENERATE", handleImageGenerate);
  registerHandler("VIDEO_GENERATE", handleVideoGenerate);
  registerHandler("MEETING_PROCESS", handleMeetingProcess);
}
