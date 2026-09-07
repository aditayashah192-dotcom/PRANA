import React, { useEffect, useState } from 'react'
import { Panel } from './Panel'
import { DataState } from './DataState'
import { ContractorRowData } from './types'
import { OpsButton } from './OpsButton'

export interface CreateWorkzonePanelProps {
  contractors: ContractorRowData[]
  submitting: boolean
  successMessage: string | null
  errorMessage: string | null
  onSubmit: (input: {
    name: string
    target_lat: number
    target_lon: number
    target_depth_meters: number
    contractor_id?: string | null
    reason?: string | null
  }) => void
  onDismissMessages: () => void
}

type Step = 'idle' | 'submitting'

const INPUT_CLASS =
  'w-full border-2 border-zinc-300 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed'

const LABEL_CLASS =
  'block text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1'

export const CreateWorkzonePanel: React.FC<CreateWorkzonePanelProps> = ({
  contractors,
  submitting,
  successMessage,
  errorMessage,
  onSubmit,
  onDismissMessages,
}) => {
  const [step, setStep] = useState<Step>('idle')
  const [name, setName] = useState<string>('')
  const [target_lat, setTargetLat] = useState<string>('')
  const [target_lon, setTargetLon] = useState<string>('')
  const [target_depth_meters, setTargetDepthMeters] = useState<string>('')
  const [contractor_id, setContractorId] = useState<string>('')
  const [reason, setReason] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!successMessage && !errorMessage) return
    const t = setTimeout(() => {
      onDismissMessages()
    }, 6000)
    return () => clearTimeout(t)
  }, [successMessage, errorMessage, onDismissMessages])

  const reset = () => {
    setStep('idle')
    setName('')
    setTargetLat('')
    setTargetLon('')
    setTargetDepthMeters('')
    setContractorId('')
    setReason('')
    setValidationError(null)
  }

  const submit = () => {
    setValidationError(null)
    if (!name.trim()) {
      setValidationError('Workzone name is required.')
      return
    }
    const lat = parseFloat(target_lat)
    const lon = parseFloat(target_lon)
    const depth = parseFloat(target_depth_meters)
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(depth)) {
      setValidationError('Valid latitude, longitude, and depth are required.')
      return
    }
    if (contractor_id && !reason.trim()) {
      setValidationError('Allocation reason is required when a contractor is selected.')
      return
    }
    setStep('submitting')
    onSubmit({
      name: name.trim(),
      target_lat: lat,
      target_lon: lon,
      target_depth_meters: depth,
      contractor_id: contractor_id || null,
      reason: contractor_id ? reason.trim() : null,
    })
  }

  return (
    <Panel
      title="CREATE_WORKZONE"
      subtitle="Government auditor creation — server-side authorization"
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

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className={LABEL_CLASS}>Workzone name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                className={INPUT_CLASS}
                placeholder="Enter workzone name"
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Target depth (m)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={target_depth_meters}
                onChange={(e) => setTargetDepthMeters(e.target.value)}
                disabled={submitting}
                className={INPUT_CLASS}
                placeholder="0.0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS}>Target latitude</label>
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                value={target_lat}
                onChange={(e) => setTargetLat(e.target.value)}
                disabled={submitting}
                className={INPUT_CLASS}
                placeholder="-90 to 90"
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Target longitude</label>
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                value={target_lon}
                onChange={(e) => setTargetLon(e.target.value)}
                disabled={submitting}
                className={INPUT_CLASS}
                placeholder="-180 to 180"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS}>Contractor (optional)</label>
              <select
                value={contractor_id}
                onChange={(e) => setContractorId(e.target.value)}
                disabled={submitting}
                className={INPUT_CLASS}
              >
                <option value="">-- unassigned --</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>
                Allocation reason {contractor_id ? '(required)' : '(optional if contractor selected)'}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                rows={3}
                className={INPUT_CLASS}
                placeholder={contractor_id ? 'Enter mandatory reason for allocation...' : 'Optional reason if contractor is selected'}
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
              disabled={submitting || !name.trim() || !target_lat || !target_lon || !target_depth_meters}
              loading={submitting}
            >
              CREATE_WORKZONE
            </OpsButton>
            <OpsButton variant="secondary" onClick={reset} disabled={submitting}>
              CLEAR
            </OpsButton>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-slate-600">
              {submitting ? 'Submitting via create_workzone RPC...' : 'Ready'}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  )
}

export default CreateWorkzonePanel
