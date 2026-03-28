import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_BASE } from '../constants/api'

interface UseWebSocketOptions {
  onMessage?: (data: unknown) => void
  reconnectInterval?: number
  maxRetries?: number
}

interface UseWebSocketReturn {
  connected: boolean
  send: (data: unknown) => void
  disconnect: () => void
}

export function useWebSocket(
  path: string | null,
  options?: UseWebSocketOptions
): UseWebSocketReturn {
  const reconnectInterval = options?.reconnectInterval ?? 3000
  const maxRetries = options?.maxRetries ?? 5

  const [connected, setConnected] = useState(false)

  const socketRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const preventReconnectRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef<((data: unknown) => void) | undefined>(undefined)
  const reconnectIntervalRef = useRef(reconnectInterval)
  const maxRetriesRef = useRef(maxRetries)

  // Keep onMessage ref up to date to avoid stale closures
  useEffect(() => {
    onMessageRef.current = options?.onMessage
  }, [options?.onMessage])

  useEffect(() => {
    reconnectIntervalRef.current = reconnectInterval
    maxRetriesRef.current = maxRetries
  }, [reconnectInterval, maxRetries])

  const connect = useCallback(() => {
    if (path === null) return
    if (preventReconnectRef.current) return

    const url = path.startsWith('ws') ? path : `${WS_BASE}${path}`

    const ws = new WebSocket(url)
    socketRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      retryCountRef.current = 0
    }

    ws.onmessage = (event: MessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(event.data as string)
      } catch {
        parsed = event.data
      }
      onMessageRef.current?.(parsed)
    }

    ws.onclose = () => {
      setConnected(false)
      socketRef.current = null

      if (
        !preventReconnectRef.current &&
        retryCountRef.current < maxRetriesRef.current
      ) {
        retryCountRef.current += 1
        reconnectTimerRef.current = setTimeout(() => {
          connect()
        }, reconnectIntervalRef.current)
      }
    }

    ws.onerror = () => {
      // Close triggers onclose which handles reconnect logic
      ws.close()
    }
  }, [path])

  useEffect(() => {
    if (path === null) return

    preventReconnectRef.current = false
    retryCountRef.current = 0
    connect()

    return () => {
      preventReconnectRef.current = true
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (socketRef.current !== null) {
        socketRef.current.close()
        socketRef.current = null
      }
    }
  }, [path, connect])

  const send = useCallback((data: unknown) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    socketRef.current.send(payload)
  }, [])

  const disconnect = useCallback(() => {
    preventReconnectRef.current = true
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (socketRef.current !== null) {
      socketRef.current.close()
      socketRef.current = null
    }
  }, [])

  return { connected, send, disconnect }
}
