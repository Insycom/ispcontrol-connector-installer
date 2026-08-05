import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

type RouterConnection = Socket | TLSSocket;
type Sentence = string[];

export type RouterCredentials = {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
};

export class RouterOsClient {
  private socket: RouterConnection | undefined;
  private buffer = Buffer.alloc(0);
  private sentences: Sentence[] = [];
  private currentSentence: Sentence = [];
  private notify: (() => void) | undefined;

  constructor(private readonly credentials: RouterCredentials) {}

  async connect(): Promise<void> {
    this.socket = await openSocket(this.credentials);
    this.socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parse();
    });
    await this.command("/login", {
      name: this.credentials.username,
      password: this.credentials.password,
    });
  }

  async close(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
  }

  async print(
    path: string,
    query: Record<string, string>,
    properties = ".id",
  ): Promise<Record<string, string>[]> {
    const requestedProperties = properties
      .split(",")
      .map((property) => property.trim())
      .filter(Boolean);
    const propertyList = [...new Set([...requestedProperties, ...Object.keys(query)])];
    const rows = await this.command(`${path}/print`, {
      ".proplist": propertyList.join(","),
    });
    return rows.filter((row) =>
      Object.entries(query).every(([key, value]) => row[key] === value),
    );
  }

  async add(path: string, attributes: Record<string, string>): Promise<void> {
    await this.command(`${path}/add`, attributes);
  }

  async set(
    path: string,
    id: string,
    attributes: Record<string, string>,
  ): Promise<void> {
    await this.command(`${path}/set`, { ".id": id, ...attributes });
  }

  async remove(path: string, id: string): Promise<void> {
    await this.command(`${path}/remove`, { ".id": id });
  }

  private async command(
    command: string,
    attributes: Record<string, string>,
    query: Record<string, string> = {},
  ): Promise<Record<string, string>[]> {
    if (!this.socket) throw new Error("RouterOS socket is not connected");
    const words = [
      command,
      ...Object.entries(attributes).map(([key, value]) => `=${key}=${value}`),
      ...Object.entries(query).map(([key, value]) => `?${key}=${value}`),
    ];
    this.socket.write(encodeSentence(words));
    const records: Record<string, string>[] = [];
    for (;;) {
      const sentence = await this.nextSentence();
      const values = attributesFrom(sentence);
      if (sentence[0] === "!trap" || sentence[0] === "!fatal") {
        throw new Error(values.message ?? "RouterOS command failed");
      }
      if (sentence[0] === "!re") records.push(values);
      if (sentence[0] === "!done" || sentence[0] === "!empty") return records;
    }
  }

  private nextSentence(): Promise<Sentence> {
    const current = this.sentences.shift();
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      this.notify = () => resolve(this.sentences.shift() ?? []);
    });
  }

  private parse(): void {
    let offset = 0;
    while (offset < this.buffer.length) {
      const decoded = decodeLength(this.buffer, offset);
      if (!decoded) break;
      if (offset + decoded.prefix + decoded.length > this.buffer.length) break;
      offset += decoded.prefix;
      if (decoded.length === 0) {
        if (this.currentSentence.length) {
          this.sentences.push(this.currentSentence);
        }
        this.currentSentence = [];
      } else {
        this.currentSentence.push(
          this.buffer
            .subarray(offset, offset + decoded.length)
            .toString("utf8"),
        );
        offset += decoded.length;
      }
    }
    this.buffer = this.buffer.subarray(offset);
    if (this.sentences.length && this.notify) {
      const notify = this.notify;
      this.notify = undefined;
      notify();
    }
  }
}

function openSocket(credentials: RouterCredentials): Promise<RouterConnection> {
  return new Promise((resolve, reject) => {
    const socket = credentials.tls
      ? connectTls({
          host: credentials.host,
          port: credentials.port,
          rejectUnauthorized: false,
        })
      : connectTcp({ host: credentials.host, port: credentials.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("RouterOS connection timed out"));
    }, 10_000);
    socket.once(credentials.tls ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function encodeSentence(words: string[]): Buffer {
  return Buffer.concat([
    ...words.map((word) => {
      const content = Buffer.from(word, "utf8");
      return Buffer.concat([encodeLength(content.length), content]);
    }),
    Buffer.from([0]),
  ]);
}

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(length | 0x8000);
    return buffer;
  }
  if (length < 0x20_0000) {
    return Buffer.from([
      ((length >> 16) & 0x1f) | 0xc0,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 0xf0;
  buffer.writeUInt32BE(length, 1);
  return buffer;
}

function decodeLength(
  buffer: Buffer,
  offset: number,
): { length: number; prefix: number } | undefined {
  const first = buffer[offset];
  if (first === undefined) return undefined;
  if ((first & 0x80) === 0) return { length: first, prefix: 1 };
  if ((first & 0xc0) === 0x80) {
    if (offset + 2 > buffer.length) return undefined;
    return {
      length: ((first & 0x3f) << 8) | buffer[offset + 1]!,
      prefix: 2,
    };
  }
  if ((first & 0xe0) === 0xc0) {
    if (offset + 3 > buffer.length) return undefined;
    return {
      length:
        ((first & 0x1f) << 16) |
        (buffer[offset + 1]! << 8) |
        buffer[offset + 2]!,
      prefix: 3,
    };
  }
  if (first === 0xf0) {
    if (offset + 5 > buffer.length) return undefined;
    return { length: buffer.readUInt32BE(offset + 1), prefix: 5 };
  }
  throw new Error("Unsupported RouterOS word length");
}

function attributesFrom(sentence: Sentence): Record<string, string> {
  return Object.fromEntries(
    sentence.slice(1).flatMap((word) => {
      if (!word.startsWith("=")) return [];
      const separator = word.indexOf("=", 1);
      return separator < 0 ? [] : [[word.slice(1, separator), word.slice(separator + 1)]];
    }),
  );
}
