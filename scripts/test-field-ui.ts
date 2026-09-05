import { readFileSync } from 'fs'
import { join } from 'path'

type Summary = { name: string; passed: boolean; detail: string }

const results: Summary[] = []

const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

function readSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/field/scan/page.tsx'), 'utf8')
}

function main(): void {
  const source = readSource()

  // A. No client-side complianceEngine import or evaluate() call
  const hasComplianceEngineImport = /import\s+\{\s*evaluate\s*\}\s+from\s+['"]@\/lib\/complianceEngine['"]/.test(source)
  const hasEvaluateCall = /evaluate\s*\(/.test(source)
  const noClientSideSafety = !hasComplianceEngineImport && !hasEvaluateCall
  note(
    'no client-side complianceEngine fallback in field UI',
    noClientSideSafety,
    `import=${hasComplianceEngineImport} evaluateCall=${hasEvaluateCall}`
  )

  // B. No direct permits INSERT in field UI
  const hasDirectPermitInsert = /\.from\s*\(\s*['"]permits['"]\s*\)\s*\.\s*insert\s*\(/.test(source)
  const noDirectPermitInsert = !hasDirectPermitInsert
  note(
    'no direct permits INSERT in field UI',
    noDirectPermitInsert,
    `directInsert=${hasDirectPermitInsert}`
  )

  // C. issue_permit RPC is used
  const hasIssuePermitRpc = /issue_permit/.test(source)
  note(
    'field UI uses issue_permit RPC',
    hasIssuePermitRpc,
    `issue_permitFound=${hasIssuePermitRpc}`
  )

  // D. /api/field/workzone-states is consumed
  const hasFieldWorkzoneStatesApi = /\/api\/field\/workzone-states/.test(source)
  note(
    'field UI consumes /api/field/workzone-states',
    hasFieldWorkzoneStatesApi,
    `apiFound=${hasFieldWorkzoneStatesApi}`
  )

  // E. aggregate_state and freshness_state are consumed from backend
  const hasAggregateState = /aggregate_state/.test(source)
  const hasFreshnessState = /freshness_state/.test(source)
  note(
    'field UI uses backend aggregate_state and freshness_state',
    hasAggregateState && hasFreshnessState,
    `aggregate=${hasAggregateState} freshness=${hasFreshnessState}`
  )

  // F. No WARMING/SAFE/WARNING/LOCKOUT/UNKNOWN derivation in React
  const hasSafetyStateDerivation = /SAFE|WARMING|WARNING|LOCKOUT|UNKNOWN/.test(source) && /setCompliance|const\s+\w+\s*:\s*SafetyState/.test(source)
  const noSafetyDerivation = !hasSafetyStateDerivation
  note(
    'no client-side safety state derivation in React',
    noSafetyDerivation,
    `derivesSafety=${hasSafetyStateDerivation}`
  )

  // G. No geofence-based permit gating in canIssuePermit (distance check must not be in the gate)
  // Extract the canIssuePermit block and verify it does not reference gpsDistance or GEOFENCE_METERS
  const canIssuePermitMatch = source.match(/const\s+canIssuePermit\s*=\s*\([\s\S]*?\)\s*;/)
  const canIssuePermitBlock = canIssuePermitMatch ? canIssuePermitMatch[0] : ''
  const hasGeofenceGating = /gpsDistance\s*<=\s*50|gpsDistance\s*<=\s*GEOFENCE_METERS|gpsDistance\s*!==\s*null/.test(canIssuePermitBlock)
  const noGeofenceGating = !hasGeofenceGating
  note(
    'no client-side geofence gating for permit issuance',
    noGeofenceGating,
    `geofenceGating=${hasGeofenceGating} block=${canIssuePermitBlock.replace(/\s+/g, ' ').trim()}`
  )

  // H. Field UI uses record_entrant_selection RPC
  const hasRecordEntrantRpc = /record_entrant_selection/.test(source)
  note(
    'field UI uses record_entrant_selection RPC',
    hasRecordEntrantRpc,
    `recordEntrantFound=${hasRecordEntrantRpc}`
  )

  // I. Field UI uses transition_permit RPC (no direct permit UPDATE)
  const hasTransitionPermitRpc = /transition_permit/.test(source)
  const hasDirectPermitUpdate = /\.from\s*\(\s*['"]permits['"]\s*\)\s*\.\s*update\s*\(/.test(source)
  note(
    'field UI uses transition_permit RPC and no direct permit UPDATE',
    hasTransitionPermitRpc && !hasDirectPermitUpdate,
    `transitionPermitFound=${hasTransitionPermitRpc} directUpdate=${hasDirectPermitUpdate}`
  )

  // J. Field UI uses apply_manual_lockout and release_manual_lockout RPCs
  const hasApplyLockoutRpc = /apply_manual_lockout/.test(source)
  const hasReleaseLockoutRpc = /release_manual_lockout/.test(source)
  note(
    'field UI uses apply/release manual lockout RPCs',
    hasApplyLockoutRpc && hasReleaseLockoutRpc,
    `apply=${hasApplyLockoutRpc} release=${hasReleaseLockoutRpc}`
  )

  // K. Field UI uses request_two_person_override and approve_two_person_override RPCs
  const hasRequestOverrideRpc = /request_two_person_override/.test(source)
  const hasApproveOverrideRpc = /approve_two_person_override/.test(source)
  note(
    'field UI uses two-person override RPCs',
    hasRequestOverrideRpc && hasApproveOverrideRpc,
    `request=${hasRequestOverrideRpc} approve=${hasApproveOverrideRpc}`
  )

  // L. Field UI does not import complianceEngine
  const hasComplianceImport = /from\s+['"]@\/lib\/complianceEngine['"]/.test(source)
  note(
    'field UI does not import complianceEngine',
    !hasComplianceImport,
    `complianceImport=${hasComplianceImport}`
  )

  // M. Field UI does not allow assigning entrants (no assign_entrant_to_work_order call)
  const hasAssignEntrantRpc = /assign_entrant_to_work_order/.test(source)
  note(
    'field UI does not assign entrants (no assign_entrant_to_work_order RPC)',
    !hasAssignEntrantRpc,
    `assignEntrantFound=${hasAssignEntrantRpc}`
  )

  const failed = results.filter((r) => !r.passed)
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`
  )
  if (failed.length > 0) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main()
