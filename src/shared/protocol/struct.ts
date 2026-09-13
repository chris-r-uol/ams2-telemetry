/**
 * A tiny table-driven binary struct reader/writer.
 *
 * Every packet layout is declared once (see layouts.ts) and used for both
 * decoding (game -> app) and encoding (demo simulator + tests -> app), so the
 * byte offsets live in exactly one place.
 */

export type NumKind = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'f32';

export interface NumField {
  name: string;
  kind: NumKind;
  offset: number;
  /** Array length; omit for scalars. */
  count?: number;
  /** Field is only present in newer/longer packets (e.g. trailing tick counts). */
  optional?: boolean;
}

export interface StrField {
  name: string;
  kind: 'str';
  offset: number;
  /** Bytes per string (NUL padded). */
  length: number;
  count?: number;
  optional?: boolean;
}

export type Field = NumField | StrField;
export type Layout = readonly Field[];

const NUM_SIZE: Record<NumKind, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, f32: 4 };

export const num = (name: string, kind: NumKind, offset: number, count?: number): NumField => ({
  name,
  kind,
  offset,
  count,
});

export const str = (name: string, offset: number, length: number, count?: number): StrField => ({
  name,
  kind: 'str',
  offset,
  length,
  count,
});

export const optional = <F extends Field>(field: F): F => ({ ...field, optional: true });

export function fieldByteLength(field: Field): number {
  const unit = field.kind === 'str' ? field.length : NUM_SIZE[field.kind];
  return unit * (field.count ?? 1);
}

/** One past the last byte used by the layout. */
export function layoutEnd(layout: Layout, includeOptional = true): number {
  let end = 0;
  for (const field of layout) {
    if (!includeOptional && field.optional) continue;
    end = Math.max(end, field.offset + fieldByteLength(field));
  }
  return end;
}

function readNum(view: DataView, kind: NumKind, offset: number): number {
  switch (kind) {
    case 'u8':
      return view.getUint8(offset);
    case 'i8':
      return view.getInt8(offset);
    case 'u16':
      return view.getUint16(offset, true);
    case 'i16':
      return view.getInt16(offset, true);
    case 'u32':
      return view.getUint32(offset, true);
    case 'f32':
      return view.getFloat32(offset, true);
  }
}

const INT_RANGE: Record<Exclude<NumKind, 'f32'>, [number, number]> = {
  u8: [0, 0xff],
  i8: [-0x80, 0x7f],
  u16: [0, 0xffff],
  i16: [-0x8000, 0x7fff],
  u32: [0, 0xffffffff],
};

function writeNum(view: DataView, kind: NumKind, offset: number, value: number): void {
  if (kind === 'f32') {
    view.setFloat32(offset, value, true);
    return;
  }
  const [min, max] = INT_RANGE[kind];
  const v = Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : 0)));
  switch (kind) {
    case 'u8':
      view.setUint8(offset, v);
      break;
    case 'i8':
      view.setInt8(offset, v);
      break;
    case 'u16':
      view.setUint16(offset, v, true);
      break;
    case 'i16':
      view.setInt16(offset, v, true);
      break;
    case 'u32':
      view.setUint32(offset, v, true);
      break;
  }
}

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

function readStr(view: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const nul = bytes.indexOf(0);
  return utf8Decoder.decode(bytes.subarray(0, nul === -1 ? length : nul)).trim();
}

function writeStr(view: DataView, offset: number, length: number, value: string): void {
  const target = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  target.fill(0);
  // Leave room for the terminating NUL.
  target.set(utf8Encoder.encode(value).subarray(0, length - 1));
}

export class PacketTooShortError extends RangeError {}

/** Read every field in `layout`, relative to `base`. Optional fields missing from short packets are skipped. */
export function readStruct<T>(view: DataView, layout: Layout, base = 0): T {
  const out: Record<string, unknown> = {};
  for (const field of layout) {
    const start = base + field.offset;
    if (start + fieldByteLength(field) > view.byteLength) {
      if (field.optional) continue;
      throw new PacketTooShortError(`packet too short for field "${field.name}"`);
    }
    if (field.kind === 'str') {
      if (field.count === undefined) {
        out[field.name] = readStr(view, start, field.length);
      } else {
        out[field.name] = Array.from({ length: field.count }, (_, i) =>
          readStr(view, start + i * field.length, field.length),
        );
      }
    } else if (field.count === undefined) {
      out[field.name] = readNum(view, field.kind, start);
    } else {
      const size = NUM_SIZE[field.kind];
      const kind = field.kind;
      out[field.name] = Array.from({ length: field.count }, (_, i) => readNum(view, kind, start + i * size));
    }
  }
  return out as T;
}

/** Write fields from `value` into `view`. Missing values are written as zero / empty. */
export function writeStruct(view: DataView, layout: Layout, value: object, base = 0): void {
  const source = value as Record<string, unknown>;
  for (const field of layout) {
    const start = base + field.offset;
    if (start + fieldByteLength(field) > view.byteLength) {
      if (field.optional) continue;
      throw new PacketTooShortError(`buffer too short for field "${field.name}"`);
    }
    const raw = source[field.name];
    if (field.kind === 'str') {
      if (field.count === undefined) {
        writeStr(view, start, field.length, typeof raw === 'string' ? raw : '');
      } else {
        const list = Array.isArray(raw) ? raw : [];
        for (let i = 0; i < field.count; i++) {
          writeStr(view, start + i * field.length, field.length, typeof list[i] === 'string' ? list[i] : '');
        }
      }
    } else if (field.count === undefined) {
      writeNum(view, field.kind, start, typeof raw === 'number' ? raw : 0);
    } else {
      const list = Array.isArray(raw) ? raw : [];
      const size = NUM_SIZE[field.kind];
      for (let i = 0; i < field.count; i++) {
        writeNum(view, field.kind, start + i * size, typeof list[i] === 'number' ? list[i] : 0);
      }
    }
  }
}
