import { Readable } from "node:stream";

export interface IFileStorage {
  saveStream(fileId: string, stream: Readable): Promise<string>;
  getReadStream(filePath: string): Readable;
  deleteFile(filePath: string): Promise<void>;
}
