import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? ''

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: unknown }
  | { kind: 'error'; message: string }

function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/api/health`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setHealth({ kind: 'ok', data: await res.json() })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setHealth({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-slate-50 p-8 text-slate-900">
      <h1 className="text-4xl font-bold tracking-tight text-center">
        Vouch — Every claim, backed by proof.
      </h1>
      <p className="text-sm text-slate-600" aria-live="polite">
        <span className="font-semibold">API status: </span>
        {health.kind === 'loading' && <span>checking…</span>}
        {health.kind === 'ok' && (
          <code className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">
            {JSON.stringify(health.data)}
          </code>
        )}
        {health.kind === 'error' && (
          <code className="rounded bg-red-100 px-2 py-1 text-red-800">
            error: {health.message}
          </code>
        )}
      </p>
    </main>
  )
}

export default App
