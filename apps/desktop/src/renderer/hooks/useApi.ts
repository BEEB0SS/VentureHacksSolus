import { useState, useCallback } from 'react'
import { API_BASE } from '../constants/api'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

interface UseApiReturn<T> extends UseApiState<T> {
  call: (url: string, options?: RequestInit) => Promise<T>
  reset: () => void
}

const INITIAL_STATE = {
  data: null,
  loading: false,
  error: null,
}

export function useApi<T = unknown>(): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>(INITIAL_STATE)

  const call = useCallback(async (url: string, options?: RequestInit): Promise<T> => {
    const resolvedUrl = url.startsWith('http') ? url : `${API_BASE}${url}`

    setState({ data: null, loading: true, error: null })

    try {
      const response = await fetch(resolvedUrl, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      })

      if (!response.ok) {
        let errorMessage = `HTTP error ${response.status}`
        try {
          const errBody = await response.json()
          errorMessage = errBody?.message ?? errorMessage
        } catch { /* non-JSON body, keep default */ }
        setState({ data: null, loading: false, error: errorMessage })
        throw new Error(errorMessage)
      }
      const data: T = await response.json()
      setState({ data, loading: false, error: null })
      return data
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setState((prev) => ({
        data: null,
        loading: false,
        error: prev.error ?? errorMessage,
      }))
      throw err
    }
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE as UseApiState<T>)
  }, [])

  return {
    ...state,
    call,
    reset,
  }
}
