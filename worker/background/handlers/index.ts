import { registerHandler } from "../dispatcher";
import { handleImageGenerate } from "./image.handler";

export function registerAllHandlers(): void {
  registerHandler("IMAGE_GENERATE", handleImageGenerate);
}
