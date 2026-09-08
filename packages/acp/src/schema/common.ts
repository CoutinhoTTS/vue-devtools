export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** UUID strings issued by our service, not provider-native session IDs. */
export type SessionId = string
export type RuntimeId = string
export type RequestId = string

/** Milliseconds since the Unix epoch. */
export type Timestamp = number

export interface ProtocolError {
  code: 'invalidRequest' | 'unauthorized' | 'notFound' | 'unsupported' | 'busy' | 'staleRuntime' | 'resumeFailed' | 'disconnected' | 'internal'
  message: string
  retryable: boolean
}
