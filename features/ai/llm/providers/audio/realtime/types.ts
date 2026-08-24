export interface RealtimeConfig {
  mode: "direct";
  url: string;
  token?: string;
  expiresAt?: number;
  headers?: Record<string, string>;
}

export interface RealtimeMessage {
  type:
    | "session.created"
    | "conversation.item.input_audio_transcription.completed"
    | "response.audio.delta"
    | "response.audio_transcript.done"
    | "error";
  text?: string;
  audioDelta?: string;
  error?: string;
}

export interface SessionConfig {
  modalities: string[];
  voice: string;
  turn_detection: {
    type: "server_vad";
    threshold: number;
    silence_duration_ms: number;
  };
}
