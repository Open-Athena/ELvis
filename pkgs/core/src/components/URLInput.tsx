import { useState, useCallback } from 'react'

interface URLInputProps {
  onSubmit: (url: string) => void
  loading?: boolean
}

/** URL-input form. Wrap in `<DrawerSection id="url" title="Load from URL" …>`. */
export function URLInput({ onSubmit, loading }: URLInputProps) {
  const [value, setValue] = useState('')

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const url = value.trim()
    if (!url) return
    onSubmit(url)
  }, [value, onSubmit])

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="https://... or s3://..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '6px 8px',
            background: '#2a2a3e',
            border: '1px solid #444',
            borderRadius: 4,
            color: '#eee',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          style={{
            padding: '6px 12px',
            background: loading ? '#333' : '#4a9eff',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            fontSize: 12,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading || !value.trim() ? 0.5 : 1,
          }}
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>
    </form>
  )
}
