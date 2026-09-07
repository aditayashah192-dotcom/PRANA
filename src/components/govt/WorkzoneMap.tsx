'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker as LeafletMarker, LayerGroup } from 'leaflet'

export type SafetyState =
  | 'SAFE'
  | 'WARMING'
  | 'WARNING'
  | 'UNKNOWN'
  | 'LOCKOUT'

export type FreshnessState = 'FRESH' | 'STALE' | 'MISSING' | 'AMBIGUOUS'

export interface WorkzoneState {
  workzone_id: string
  contractor_id: string | null
  name: string
  target_lat: number
  target_lon: number
  target_depth_meters: number
  state: {
    aggregate_state: SafetyState
    aggregate_reason: string
    freshness_state: FreshnessState
    freshness_window_seconds: number
    telemetry_age_seconds: number | null
    latest_scan_timestamp: string | null
    latest_decision: string | null
    latest_h2s_ppm: string | null
    latest_o2_percent: string | null
    latest_depth_meters: string | null
    latest_battery_percent: string | null
    authoritative_work_order_id: string | null
    authoritative_work_order_status: string | null
    authoritative_device_id: string | null
    latest_scan_log_id: string | null
    computed_at: string
  }
}

export interface WorkzoneMapProps {
  workzones: WorkzoneState[]
  selectedId: string | null
  onSelect: (workzoneId: string) => void
}

const SAFETY_COLORS: Record<SafetyState, string> = {
  SAFE: '#059669',
  WARMING: '#D97706',
  WARNING: '#D97706',
  LOCKOUT: '#DC2626',
  UNKNOWN: '#6B7280',
}

const SAFETY_TEXT_COLORS: Record<SafetyState, string> = {
  SAFE: '#ECFDF5',
  WARMING: '#FFFBEB',
  WARNING: '#FFFBEB',
  LOCKOUT: '#FEF2F2',
  UNKNOWN: '#F3F4F6',
}

function buildDivIcon(args: {
  state: SafetyState
  unassigned: boolean
  label: string
}): import('leaflet').DivIcon {
  // lazy import leaflet so this only runs client-side
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const L = require('leaflet')
  const fill = SAFETY_COLORS[args.state]
  const text = SAFETY_TEXT_COLORS[args.state]
  const ring = args.unassigned ? '#0F172A' : '#0F172A'
  const ringStyle = args.unassigned
    ? `box-shadow: 0 0 0 3px ${ring}, 0 0 0 5px #D97706;`
    : `box-shadow: 0 0 0 3px ${ring}, 0 0 0 5px #ffffff;`
  const html = `
    <div style="
      display:flex;flex-direction:column;align-items:center;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      font-size:10px;font-weight:700;letter-spacing:0.05em;
      text-transform:uppercase;line-height:1;gap:2px;">
      <div style="
        width:18px;height:18px;border-radius:4px;
        background:${fill};color:${text};
        border:2px solid #0F172A;display:flex;align-items:center;justify-content:center;
        ${ringStyle}
      ">
        <span style="font-size:9px;">${args.state.slice(0, 1)}</span>
      </div>
      ${
        args.unassigned
          ? `<div style="
              padding:1px 4px;border-radius:4px;background:#0F172A;color:#D97706;
              border:1px solid #D97706;font-size:8px;">UNASSIGNED</div>`
          : ''
      }
    </div>
  `
  return L.divIcon({
    className: 'prana-map-marker',
    html,
    iconSize: [44, args.unassigned ? 36 : 22],
    iconAnchor: [22, args.unassigned ? 18 : 11],
  })
}

export const WorkzoneMap: React.FC<WorkzoneMapProps> = ({
  workzones,
  selectedId,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    async function init() {
      const L = (await import('leaflet')).default
      // CSS is loaded lazily via a <link> in this effect.
      if (!document.querySelector('link[data-prana-leaflet]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        link.crossOrigin = ''
        link.dataset.pranaLeaflet = '1'
        document.head.appendChild(link)
      }
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        worldCopyJump: true,
        preferCanvas: false,
      })
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)

      const layer = L.layerGroup().addTo(map)
      layerRef.current = layer

      setReady(true)

      cleanup = () => {
        map.remove()
        mapRef.current = null
        layerRef.current = null
      }
    }

    init()

    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
  }, [])

  // Compute fit bounds whenever workzones change.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const L = require('leaflet')
    const valid = workzones.filter(
      (w) =>
        Number.isFinite(w.target_lat) &&
        Number.isFinite(w.target_lon) &&
        !(w.target_lat === 0 && w.target_lon === 0),
    )
    if (valid.length === 0) {
      // Fall back to a wide global view; never a hardcoded city.
      mapRef.current.setView([20, 0], 2)
      return
    }
    if (valid.length === 1) {
      mapRef.current.setView([valid[0].target_lat, valid[0].target_lon], 14)
      return
    }
    const bounds = L.latLngBounds(
      valid.map((w) => [w.target_lat, w.target_lon] as [number, number]),
    )
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
  }, [ready, workzones])

  // Render markers
  useEffect(() => {
    if (!ready || !mapRef.current || !layerRef.current) return
    const L = require('leaflet')
    layerRef.current.clearLayers()
    workzones.forEach((w) => {
      if (
        !Number.isFinite(w.target_lat) ||
        !Number.isFinite(w.target_lon) ||
        (w.target_lat === 0 && w.target_lon === 0)
      ) {
        return
      }
      const unassigned = !w.contractor_id
      const icon = buildDivIcon({
        state: w.state.aggregate_state,
        unassigned,
        label: w.state.aggregate_state,
      })
      const marker = L.marker([w.target_lat, w.target_lon], {
        icon,
        keyboard: true,
        title: w.name,
      })
      marker.on('click', () => onSelect(w.workzone_id))
      marker.bindTooltip(
        `<div style="font-family:ui-monospace,monospace;font-size:11px;">
          <div style="font-weight:700;text-transform:uppercase;">${escapeHtml(w.name)}</div>
          <div>STATE: <b>${w.state.aggregate_state}</b></div>
          <div>${w.state.aggregate_reason}</div>
          ${unassigned ? '<div style="color:#D97706;">UNASSIGNED</div>' : ''}
        </div>`,
        { direction: 'top', offset: [0, -10] },
      )
      if (selectedId === w.workzone_id) {
        marker.openTooltip()
      }
      marker.addTo(layerRef.current!)
    })
  }, [ready, workzones, selectedId, onSelect])

  const validCount = useMemo(
    () =>
      workzones.filter(
        (w) =>
          Number.isFinite(w.target_lat) &&
          Number.isFinite(w.target_lon) &&
          !(w.target_lat === 0 && w.target_lon === 0),
      ).length,
    [workzones],
  )

  return (
    <div className="border-2 border-zinc-200 rounded-md bg-white overflow-hidden shadow-panel">
      <div className="px-3 py-2 border-b-2 border-zinc-200 bg-slate-900 flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-100">
          CITY_OPERATIONS_MAP
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
          {workzones.length} ZONES / {validCount} PLOTTED
        </span>
      </div>
      <div
        ref={containerRef}
        className="w-full"
        style={{ height: 520 }}
        aria-label="Government auditor operations map"
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default WorkzoneMap
