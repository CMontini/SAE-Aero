// One bounded, ordered file transfer from the installed SolidWorks add-in.
export const NATIVE_MAX_BYTES = 50 * 1024 * 1024;
export class NativeTransfer {
  private parts: ArrayBuffer[] = [];
  private expectedBytes = 0;
  private receivedBytes = 0;
  private nextIndex = 0;
  private filename = '';
  private begun = false;
  private complete = false;
  constructor(readonly requestId: string) {}
  consume(message: unknown): {ack?: number; file?: File} | null {
    if (!message || typeof message !== 'object') return null;
    const m = message as Record<string, unknown>;
    if (m.requestId !== this.requestId) return null;
    if (this.complete) throw new Error('The package transfer already finished.');
    if (m.type === 'aerovault:file-begin') {
      if (this.begun || typeof m.name !== 'string' || m.name.length > 180 || !/^[^\\/\r\n]+\.zip$/i.test(m.name) || !Number.isInteger(m.size) || Number(m.size) < 1 || Number(m.size) > NATIVE_MAX_BYTES) throw new Error('The prepared package is invalid or exceeds 50 MB.');
      this.filename = m.name; this.expectedBytes = Number(m.size); this.begun = true;
      return {};
    }
    if (m.type === 'aerovault:file-chunk') {
      if (!this.begun || m.index !== this.nextIndex || typeof m.data !== 'string' || m.data.length > 524288) throw new Error('The package transfer was interrupted. Prepare the design again.');
      const binary = atob(m.data);
      if (!binary.length || this.receivedBytes + binary.length > this.expectedBytes) throw new Error('The package exceeded its declared size.');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      this.parts.push(bytes.buffer); this.receivedBytes += bytes.length;
      return {ack: this.nextIndex++};
    }
    if (m.type === 'aerovault:file-complete') {
      if (!this.begun || this.receivedBytes !== this.expectedBytes) throw new Error('The package transfer was incomplete. Prepare the design again.');
      const file = new File(this.parts, this.filename, {type:'application/zip'});
      this.parts = []; this.complete = true;
      return {file};
    }
    return null;
  }
}
