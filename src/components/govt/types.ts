export interface WorkzoneRowData {
  id: string
  name: string
  target_lat: number
  target_lon: number
  target_depth_meters: number
  contractor_id: string | null
  contractor_name: string | null
}

export interface ContractorRowData {
  id: string
  name: string
  created_at: string
}

export interface ContractorAllocation {
  contractorId: string
  workzoneCount: number
}
