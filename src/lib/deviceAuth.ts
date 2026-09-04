import { createHmac, timingSafeEqual } from 'crypto'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function canonicalize(value: JsonValue): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return (
      '{' +
      keys
        .map((key) => JSON.stringify(key) + ':' + canonicalize(value[key]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}

export function generateDeviceHmac(
  payload: object,
  secretHash: string
): string {
  const message = canonicalize(payload as JsonValue)
  return createHmac('sha256', secretHash).update(message, 'utf8').digest('hex')
}

export function verifyDeviceHmac(
  payload: object,
  signature: string,
  secretHash: string
): boolean {
  try {
    const expectedHex = generateDeviceHmac(payload, secretHash)
    const expectedBuffer = Buffer.from(expectedHex, 'hex')
    const providedBuffer = Buffer.from(signature, 'hex')
    if (expectedBuffer.length !== providedBuffer.length) {
      return false
    }
    return timingSafeEqual(expectedBuffer, providedBuffer)
  } catch {
    return false
  }
}

export function verifyTimestampFreshness(
  timestampMs: number,
  maxWindowSec = 30
): boolean {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    return false
  }
  const deltaMs = Math.abs(Date.now() - timestampMs)
  return deltaMs <= maxWindowSec * 1000
}
