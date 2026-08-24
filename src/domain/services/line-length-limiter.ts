import { Transform, TransformCallback } from "node:stream";

const NEWLINE = 0x0a;
const NEWLINE_CHUNK = Buffer.from([NEWLINE]);

/**
 * Caps how many bytes of any single line reach the consumer. readline itself
 * has no length limit, so without this a file containing one very long line is
 * materialised whole in memory before any length check can run.
 *
 * An over-long line is truncated to `maxBytes + 1` and the remainder discarded
 * up to its newline, so the consumer still sees exactly one line, can detect it
 * exceeded the limit, and can reject that record while the import continues.
 */
export class LineLengthLimiter extends Transform {
  private lineBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: TransformCallback,
  ): void {
    let start = 0;
    while (start < chunk.length) {
      const newlineAt = chunk.indexOf(NEWLINE, start);
      const end = newlineAt === -1 ? chunk.length : newlineAt + 1;
      this.forwardSegment(chunk.subarray(start, end), newlineAt !== -1);
      start = end;
    }
    done();
  }

  private forwardSegment(segment: Buffer, endsLine: boolean): void {
    const body = endsLine ? segment.subarray(0, segment.length - 1) : segment;
    const budget = this.maxBytes + 1 - this.lineBytes;
    const allowed = Math.max(0, Math.min(body.length, budget));

    if (allowed > 0) {
      this.push(body.subarray(0, allowed));
      this.lineBytes += allowed;
    }

    if (endsLine) {
      this.push(NEWLINE_CHUNK);
      this.lineBytes = 0;
    }
  }
}
