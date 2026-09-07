export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export function canonicalize(value: JsonValue): string {
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
