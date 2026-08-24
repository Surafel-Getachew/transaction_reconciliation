import { describe, it, expect } from 'vitest';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { LineLengthLimiter } from '../../src/domain/services/line-length-limiter.js';

async function readLines(chunks: string[], maxBytes: number): Promise<string[]> {
  const source = Readable.from(chunks.map((c) => Buffer.from(c)));
  const limiter = new LineLengthLimiter(maxBytes);
  source.on('error', (err) => limiter.destroy(err));
  source.pipe(limiter);

  const lines: string[] = [];
  for await (const line of readline.createInterface({
    input: limiter,
    crlfDelay: Infinity,
  })) {
    lines.push(line);
  }
  return lines;
}

describe('LineLengthLimiter', () => {
  it('should pass short lines through unchanged', async () => {
    expect(await readLines(['a\nbb\nccc\n'], 10)).toEqual(['a', 'bb', 'ccc']);
  });

  it('should preserve empty lines so line numbering stays correct', async () => {
    expect(await readLines(['a\n\n\nb\n'], 10)).toEqual(['a', '', '', 'b']);
  });

  it('should emit a final line that has no trailing newline', async () => {
    expect(await readLines(['a\nbb'], 10)).toEqual(['a', 'bb']);
  });

  it('should leave multi-byte characters intact when under the cap', async () => {
    expect(await readLines(['héllo→世界\nok\n'], 100)).toEqual(['héllo→世界', 'ok']);
  });

  it('should keep a line of exactly the cap', async () => {
    expect(await readLines(['abcde\n'], 5)).toEqual(['abcde']);
  });

  it('should truncate an over-long line to one byte past the cap', async () => {
    // One byte over is what lets the processor detect the truncation.
    const [long, next] = await readLines(['aaaaaaaaaaaaaaaaaaaa\nshort\n'], 5);
    expect(Buffer.byteLength(long)).toBe(6);
    expect(next).toBe('short');
  });

  it('should cap a line that spans several chunks', async () => {
    const [long, next] = await readLines(['aaa', 'bbb\ncc', 'c\n'], 4);
    expect(Buffer.byteLength(long)).toBe(5);
    expect(next).toBe('ccc');
  });

  it('should bound memory for a line far larger than the cap', async () => {
    const oneMb = 'a'.repeat(1024 * 1024);
    const [long] = await readLines([oneMb, oneMb, oneMb, '\n'], 1000);
    expect(Buffer.byteLength(long)).toBe(1001);
  });

  it('should propagate a source stream error', async () => {
    const source = new Readable({
      read() {
        this.destroy(new Error('disk failure'));
      },
    });
    const limiter = new LineLengthLimiter(100);
    source.on('error', (err) => limiter.destroy(err));
    source.pipe(limiter);

    const consume = async () => {
      for await (const _line of readline.createInterface({
        input: limiter,
        crlfDelay: Infinity,
      })) {
        // draining
      }
    };
    await expect(consume()).rejects.toThrow('disk failure');
  });
});
