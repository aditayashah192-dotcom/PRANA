import { createHash } from 'crypto'
import { canonicalize, type JsonValue } from './canonicalize'

export interface ScanLogRow {
  id: string
  device_id: string
  work_order_id: string | null
  readings: JsonValue
  timestamp: string | null
  prev_hash: string | null
  row_hash: string | null
  message_id: string | null
  created_at: string
}

export interface ChainFailure {
  index: number
  recordId: string
  reason: string
  field?: string
  expected?: string
  actual?: string
}

export interface VerificationResult {
  valid: boolean
  status: 'VALID' | 'INVALID'
  recordCount: number
  verifiedCount: number
  verifiedAt: string
  rootValid: boolean
  linkageValid: boolean
  hashesValid: boolean
  messageIdsValid: boolean
  malformedHashes: boolean
  failures: ChainFailure[]
}

const HASH_PATTERN = /^[0-9a-f]{64}$/

function isMalformedHash(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') {
    return false
  }
  return !HASH_PATTERN.test(value)
}

function recoverTimestamp(utcIso: string | null): number {
  if (!utcIso) {
    return 0
  }
  const ms = new Date(utcIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) {
    return 0
  }
  return ms
}

export function computeRowHash(
  prevHash: string,
  signedPayload: {
    device_id: string
    readings: JsonValue
    timestamp: number
    work_order_id: string | null
  },
): string {
  const payloadString = canonicalize(signedPayload as JsonValue)
  return createHash('sha256')
    .update(prevHash + payloadString, 'utf8')
    .digest('hex')
}

export function computeMessageId(
  signedPayload: {
    device_id: string
    readings: JsonValue
    timestamp: number
    work_order_id: string | null
  },
): string {
  const payloadString = canonicalize(signedPayload as JsonValue)
  return createHash('sha256')
    .update(payloadString, 'utf8')
    .digest('hex')
}

export function reconstructSignedPayload(row: ScanLogRow): {
  device_id: string
  readings: JsonValue
  timestamp: number
  work_order_id: string | null
} {
  return {
    device_id: row.device_id,
    readings: row.readings,
    timestamp: recoverTimestamp(row.timestamp),
    work_order_id: row.work_order_id,
  }
}

export function verifyAuditChain(rows: ScanLogRow[]): VerificationResult {
  const failures: ChainFailure[] = []
  const verifiedAt = new Date().toISOString()

  if (rows.length === 0) {
    return {
      valid: true,
      status: 'VALID',
      recordCount: 0,
      verifiedCount: 0,
      verifiedAt,
      rootValid: true,
      linkageValid: true,
      hashesValid: true,
      messageIdsValid: true,
      malformedHashes: false,
      failures: [],
    }
  }

  let rootValid = true
  let linkageValid = true
  let hashesValid = true
  let messageIdsValid = true
  let malformedHashes = false
  let verifiedCount = 0
  let prevRowHash: string | null = null

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const prevHashForComputation = prevRowHash ?? ''

    if (isMalformedHash(row.row_hash)) {
      malformedHashes = true
      failures.push({
        index: i,
        recordId: row.id,
        reason: 'malformed row_hash',
        field: 'row_hash',
        actual: row.row_hash ?? 'null',
      })
    }

    if (isMalformedHash(row.prev_hash)) {
      malformedHashes = true
      failures.push({
        index: i,
        recordId: row.id,
        reason: 'malformed prev_hash',
        field: 'prev_hash',
        actual: row.prev_hash ?? 'null',
      })
    }

    if (isMalformedHash(row.message_id)) {
      malformedHashes = true
      failures.push({
        index: i,
        recordId: row.id,
        reason: 'malformed message_id',
        field: 'message_id',
        actual: row.message_id ?? 'null',
      })
    }

    if (i === 0) {
      if (row.prev_hash !== null) {
        rootValid = false
        failures.push({
          index: i,
          recordId: row.id,
          reason: 'genesis record prev_hash is not NULL (invalid root)',
          field: 'prev_hash',
          expected: 'null',
          actual: row.prev_hash ?? 'null',
        })
      }
    } else {
      const expectedPrev = prevRowHash ?? null
      if (row.prev_hash !== expectedPrev) {
        linkageValid = false
        failures.push({
          index: i,
          recordId: row.id,
          reason: 'broken previous_hash linkage',
          field: 'prev_hash',
          expected: expectedPrev ?? 'null',
          actual: row.prev_hash ?? 'null',
        })
      }
    }

    const signedPayload = reconstructSignedPayload(row)
    const expectedRowHash = computeRowHash(prevHashForComputation, signedPayload)
    const expectedMessageId = computeMessageId(signedPayload)

    if (row.row_hash !== null && row.row_hash !== expectedRowHash) {
      hashesValid = false
      failures.push({
        index: i,
        recordId: row.id,
        reason: 'stored row_hash does not match computed value',
        field: 'row_hash',
        expected: expectedRowHash,
        actual: row.row_hash ?? 'null',
      })
    }

    if (
      row.message_id !== null &&
      row.message_id !== expectedMessageId
    ) {
      messageIdsValid = false
      failures.push({
        index: i,
        recordId: row.id,
        reason: 'stored message_id does not match computed value',
        field: 'message_id',
        expected: expectedMessageId,
        actual: row.message_id,
      })
    }

    if (
      (row.row_hash === null || row.row_hash === expectedRowHash) &&
      (row.message_id === null || row.message_id === expectedMessageId) &&
      !isMalformedHash(row.row_hash) &&
      !isMalformedHash(row.prev_hash) &&
      !isMalformedHash(row.message_id) &&
      (i === 0 ? row.prev_hash === null : row.prev_hash === prevRowHash)
    ) {
      verifiedCount++
    }

    if (row.row_hash !== null && !isMalformedHash(row.row_hash)) {
      prevRowHash = row.row_hash
    }
  }

  const valid =
    rootValid &&
    linkageValid &&
    hashesValid &&
    messageIdsValid &&
    !malformedHashes &&
    failures.length === 0

  return {
    valid,
    status: valid ? 'VALID' : 'INVALID',
    recordCount: rows.length,
    verifiedCount,
    verifiedAt,
    rootValid,
    linkageValid,
    hashesValid,
    messageIdsValid,
    malformedHashes,
    failures,
  }
}
