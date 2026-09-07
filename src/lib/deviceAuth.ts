import { createHmac, timingSafeEqual } from 'crypto'
import { canonicalize, type JsonValue } from './canonicalize'

export type { JsonValue }

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
