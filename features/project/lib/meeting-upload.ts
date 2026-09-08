/** Multipart parsers in the current Next/Undici stack reject some non-ASCII filenames. */
export function meetingUploadFileName(file: File): string {
  const extension =
    file.name.toLowerCase().match(/\.(mp3|wav|m4a|webm|mp4)$/)?.[1] ?? "webm";
  return `meeting-audio.${extension}`;
}
