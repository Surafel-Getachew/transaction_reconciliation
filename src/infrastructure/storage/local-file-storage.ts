import fs from "node:fs";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { promisify } from "node:util";
import { IFileStorage } from "../../domain/storage/file-storage.interface.js";

const streamPipeline = promisify(pipeline);

export class LocalFileStorage implements IFileStorage {
  private uploadDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir || process.env.TEMP_UPLOAD_DIR || "./uploads";
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveStream(fileId: string, stream: Readable): Promise<string> {
    const targetPath = path.join(this.uploadDir, `${fileId}.ndjson`);
    const writeStream = fs.createWriteStream(targetPath);
    await streamPipeline(stream, writeStream);
    return targetPath;
  }

  getReadStream(filePath: string): Readable {
    return fs.createReadStream(filePath, { encoding: "utf-8" });
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
