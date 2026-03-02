export interface IncomingMessage {
  /** Unique channel + user identifier for session keying */
  sessionKey: string;
  /** User-facing display name */
  userName: string;
  /** Numeric user ID from the channel */
  userId: number;
  /** The raw text content */
  text: string;
  /** Channel this message came from */
  channel: string;
  /** Optional command (e.g. 'start', 'reset') */
  command?: string;
  /** Optional command arguments */
  commandArgs?: string;
  /** Optional image attachments as base64 */
  images?: Array<{ data: string; mimeType: string }>;
  /** Optional document attachments */
  documents?: Array<{ data: string; mimeType: string; fileName: string }>;
}

export interface StreamingHandle {
  /** Send a text chunk (appended to current message) */
  writeText(text: string): void;
  /** Update the full message text (replaces current content) */
  replaceText(text: string): void;
  /** Signal that a tool is being executed */
  writeToolStatus(toolName: string, status: 'running' | 'done' | 'error'): void;
  /** Send an image */
  sendImage(buffer: Buffer, mimeType: string, caption?: string): Promise<void>;
  /** Send a document/file */
  sendDocument(buffer: Buffer, mimeType: string, fileName: string, caption?: string): Promise<void>;
  /** Finalize the response (flush any pending edits) */
  finish(): Promise<void>;
}

export interface ChannelAdapter {
  name: string;
  /** Start listening for messages */
  start(): Promise<void>;
  /** Stop the adapter */
  stop(): Promise<void>;
  /** Register a handler for incoming messages */
  onMessage(handler: (msg: IncomingMessage, stream: StreamingHandle) => Promise<void>): void;
}
