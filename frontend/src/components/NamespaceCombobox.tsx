import { useState, useRef, useEffect } from 'react'
import { useNamespaces } from '../hooks/useNamespaces'

interface Props {
  value: string
  onChange: (v: string) => void
}

export function NamespaceCombobox({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: namespaces = [] } = useNamespaces()

  const filtered = value
    ? namespaces.filter(ns => ns.toLowerCase().includes(value.toLowerCase()))
    : namespaces

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function select(ns: string) {
    onChange(ns)
    setOpen(false)
    setHighlighted(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      select(filtered[highlighted])
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <input
        placeholder="Filter by namespace…"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="border rounded-md px-3 py-1.5 text-sm w-56"
      />
      {open && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10 overflow-hidden"
        >
          {filtered.map((ns, i) => (
            <li
              key={ns}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={() => select(ns)}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer ${
                i === highlighted ? 'bg-indigo-50 font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {ns}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
