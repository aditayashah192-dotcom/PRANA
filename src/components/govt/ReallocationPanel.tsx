import React, { useEffect, useState } from 'react'
import { Panel } from './Panel'
import { StatusBadge } from './StatusBadge'
import { DataState } from './DataState'
import { WorkzoneRowData, ContractorRowData } from './types'
import { OpsButton } from './OpsButton'

export interface ReallocationPanelProps {
  workzones: WorkzoneRowData[]
  contractors: ContractorRowData[]
  submitting: boolean
  successMessage: string | null
  errorMessage: string | null
  onSubmit: (input: {
    workzoneId: string
    newContractorId: string
    reason: string
  }) => void
  onDismissMessages: () => void
  prefillWorkzoneId?: string | null
}

type Step = 'idle' | 'confirming' | 'submitting'

const SELECT_CLASS =
  'w-full border-2 border-zinc-300 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed'

const INPUT_CLASS =
  'w-full border-2 border-zinc-300 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed'

const LABEL_CLASS =
  'block text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1'

export const ReallocationPanel: React.FC<ReallocationPanelProps> = ({
  workzones,
  contractors,
  submitting,
  successMessage,
  errorMessage,
  onSubmit,
  onDismissMessages,
  prefillWorkzoneId,
}) => {
  const [step, setStep] = useState<Step>('idle')
  const [workzoneId, setWorkzoneId] = useState<string>('')
  const [newContractorId, setNewContractorId] = useState<string>('')
  const [reason, setReason] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (prefillWorkzoneId) {
      setWorkzoneId(prefillWorkzoneId)
      setStep('confirming')
    }
  }, [prefillWorkzoneId])

  useEffect(() => {
    if (!successMessage && !errorMessage) return
    const t = setTimeout(() => {
      onDismissMessages()
    }, 6000)
    return () => clearTimeout(t)
  }, [successMessage, errorMessage, onDismissMessages])

  const selectedWorkzone = workzones.find((w) => w.id === workzoneId) ?? null

  const isAllocation = selectedWorkzone ? !selectedWorkzone.contractor_id : false
  const panelTitle = isAllocation ? 'WORKZONE_ALLOCATION' : 'WORKZONE_REALLOCATION'
  const panelSubtitle =
    'Government auditor assignment — server-side authorization'
  const step2Label = isAllocation
    ? 'STEP_2 — SELECT_CONTRACTOR_AND_REASON'
    : 'STEP_2 — NEW_CONTRACTOR_AND_REASON'
  const confirmLabel = isAllocation
    ? 'ALLOCATE_WORKZONE'
    : 'CONFIRM_REALLOCATION'

  const startOver = () => {
    setStep('idle')
    setWorkzoneId('')
    setNewContractorId('')
    setReason('')
    setValidationError(null)
  }

  const proceedToConfirm = () => {
    setValidationError(null)
    if (!workzoneId) {
      setValidationError('Select a workzone.')
      return
    }
    setStep('confirming')
  }

  const submit = () => {
    setValidationError(null)
    if (!workzoneId || !newContractorId || !reason.trim()) {
      setValidationError('Workzone, new contractor, and reason are all required.')
      return
    }
    if (selectedWorkzone?.contractor_id === newContractorId) {
      setValidationError('New contractor must differ from current contractor.')
      return
    }
    setStep('submitting')
    onSubmit({ workzoneId, newContractorId, reason: reason.trim() })
  }

  return (
    <Panel
      title={panelTitle}
      subtitle={panelSubtitle}
    >
      <div className="space-y-4">
        {successMessage ? (
          <div className="border-2 border-emerald-600 rounded-md bg-emerald-50 p-3 font-mono text-xs text-emerald-700">
            <p className="font-bold uppercase tracking-wider">SUCCESS</p>
            <p className="mt-1 normal-case tracking-normal">{successMessage}</p>
          </div>
        ) : null}
        {errorMessage ? (
          <div className="border-2 border-red-600 rounded-md bg-red-50 p-3 font-mono text-xs text-red-700">
            <p className="font-bold uppercase tracking-wider">ERROR</p>
            <p className="mt-1 normal-case tracking-normal">{errorMessage}</p>
          </div>
        ) : null}

        {step === 'idle' ? (
          <div className="space-y-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-700">
              STEP_1 — SELECT_WORKZONE
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2">
                <label className={LABEL_CLASS}>Workzone</label>
                <select
                  value={workzoneId}
                  onChange={(e) => setWorkzoneId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">-- select workzone --</option>
                  {workzones.map((wz) => (
                    <option key={wz.id} value={wz.id}>
                      {wz.name} ({wz.contractor_name ?? 'UNASSIGNED'})
                    </option>
                  ))}
                </select>
              </div>
              <OpsButton variant="primary" onClick={proceedToConfirm} disabled={!workzoneId}>
                CONTINUE
              </OpsButton>
            </div>
            {validationError ? (
              <DataState state="error" message={validationError} />
            ) : null}
          </div>
        ) : null}

        {step !== 'idle' && selectedWorkzone ? (
          <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  SELECTED_WORKZONE
                </p>
                <p className="font-mono text-sm font-bold text-slate-900 truncate">
                  {selectedWorkzone.name}
                </p>
              </div>
              <StatusBadge
                label={selectedWorkzone.contractor_name ? 'ASSIGNED' : 'UNASSIGNED'}
                tone={selectedWorkzone.contractor_name ? 'emerald' : 'amber'}
              />
            </div>
            <p className="font-mono text-[11px] text-slate-700">
              CURRENT_CONTRACTOR:{' '}
              <span className="text-slate-900">
                {selectedWorkzone.contractor_name ?? 'UNASSIGNED'}
              </span>
            </p>
          </div>
        ) : null}

        {step !== 'idle' ? (
          <div className="space-y-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-700">
              {step2Label}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>New contractor</label>
                <select
                  value={newContractorId}
                  onChange={(e) => setNewContractorId(e.target.value)}
                  disabled={submitting}
                  className={SELECT_CLASS}
                >
                  <option value="">-- select contractor --</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Reason (required, audit-logged)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submitting}
                  rows={3}
                  className={INPUT_CLASS}
                  placeholder="Enter mandatory reason for reassignment..."
                />
              </div>
            </div>
            {validationError ? (
              <DataState state="error" message={validationError} />
            ) : null}
            <div className="flex items-center gap-3 pt-2">
              <OpsButton
                variant="safety"
                onClick={submit}
                disabled={submitting || !newContractorId || !reason.trim()}
                loading={submitting}
              >
                {confirmLabel}
              </OpsButton>
              <OpsButton variant="secondary" onClick={startOver} disabled={submitting}>
                CANCEL
              </OpsButton>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-slate-600">
                {submitting ? 'Submitting via reassign_workzone_contractor RPC...' : 'Ready'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

export default ReallocationPanel
