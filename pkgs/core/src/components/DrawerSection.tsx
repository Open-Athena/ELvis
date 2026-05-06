import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import styles from './DrawerSection.module.css'

interface DrawerSectionProps {
  /** Stable id for localStorage key + a11y. */
  id: string
  title: string
  /** 16px icon (typically a `lucide-react` component) shown left of the title. */
  icon: ReactNode
  /** Hex color for the left stripe + icon tint. */
  accent: string
  /** Optional small label rendered between title and chevron (e.g. count). */
  badge?: ReactNode
  /** Initial open/closed state on first render (no LS entry yet). */
  defaultOpen?: boolean
  /** Bumping this number opens the section once (transition open). Used for "auto-open
   *  when this thing becomes active" without permanently overriding the user's collapse. */
  forceOpenGen?: number
  children: ReactNode
}

const STORAGE_KEY_PREFIX = 'elvis.drawer.'
const STORAGE_KEY_LEGACY: Record<string, string> = {
  // One-shot migration: read old key, write new, delete old.
  gallery: 'elvis-gallery-collapsed',
  settings: 'elvis-settings-collapsed',
  url: 'elvis-url-input-collapsed',
  examples: 'elvis-examples-open',
}

/** Read persisted open-state, migrating from legacy session keys on first read. */
function loadOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const newKey = `${STORAGE_KEY_PREFIX}${id}.open`
    const v = localStorage.getItem(newKey)
    if (v !== null) return v === '1'
    const legacyKey = STORAGE_KEY_LEGACY[id]
    if (legacyKey) {
      // Legacy keys mostly stored "collapsed" semantics — invert when migrating.
      // 'examples' is the exception: stored as "open=true".
      const ss = sessionStorage.getItem(legacyKey)
      if (ss !== null) {
        const open = id === 'examples' ? ss === 'true' : ss !== 'true'
        localStorage.setItem(newKey, open ? '1' : '0')
        sessionStorage.removeItem(legacyKey)
        return open
      }
    }
  } catch { /* localStorage unavailable */ }
  return defaultOpen
}

function saveOpen(id: string, open: boolean) {
  try { localStorage.setItem(`${STORAGE_KEY_PREFIX}${id}.open`, open ? '1' : '0') } catch { /* noop */ }
}

const LAST_TOUCHED_KEY = 'elvis.drawer.lastTouched'

/** Record an interaction with this section. The `\` hotkey reads this to decide which
    section to keep open while collapsing the rest. */
function markTouched(id: string) {
  try { localStorage.setItem(LAST_TOUCHED_KEY, id) } catch { /* noop */ }
}

/** Drawer-level hotkey events. Handlers in `App.tsx` dispatch these on `[ ] \`. */
export const DRAWER_EVT = {
  collapseAll: 'elvis:drawer-collapse-all',
  expandAll: 'elvis:drawer-expand-all',
  focusLastTouched: 'elvis:drawer-focus-last',
} as const

/** Read the most-recently-interacted section id (for `\` focus hotkey). */
export function getLastTouchedSection(): string | null {
  try { return localStorage.getItem(LAST_TOUCHED_KEY) } catch { return null }
}

export function DrawerSection({
  id,
  title,
  icon,
  accent,
  badge,
  defaultOpen = false,
  forceOpenGen,
  children,
}: DrawerSectionProps) {
  const [open, setOpen] = useState(() => loadOpen(id, defaultOpen))
  const lastForceGen = useRef<number | undefined>(forceOpenGen)

  // Bumping forceOpenGen flips open to true once (lets a section auto-open when it
  // becomes contextually active without permanently overriding user collapse choice).
  useEffect(() => {
    if (forceOpenGen !== undefined && forceOpenGen !== lastForceGen.current) {
      lastForceGen.current = forceOpenGen
      setOpen(true)
      saveOpen(id, true)
    }
  }, [forceOpenGen, id])

  // Listen for drawer-level hotkey events (collapse-all / expand-all / focus-last).
  useEffect(() => {
    const onCollapse = () => { setOpen(false); saveOpen(id, false) }
    const onExpand = () => { setOpen(true); saveOpen(id, true) }
    const onFocus = () => {
      const target = getLastTouchedSection()
      const keepOpen = target === id
      setOpen(keepOpen)
      saveOpen(id, keepOpen)
    }
    window.addEventListener(DRAWER_EVT.collapseAll, onCollapse)
    window.addEventListener(DRAWER_EVT.expandAll, onExpand)
    window.addEventListener(DRAWER_EVT.focusLastTouched, onFocus)
    return () => {
      window.removeEventListener(DRAWER_EVT.collapseAll, onCollapse)
      window.removeEventListener(DRAWER_EVT.expandAll, onExpand)
      window.removeEventListener(DRAWER_EVT.focusLastTouched, onFocus)
    }
  }, [id])

  const onToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = (e.currentTarget as HTMLDetailsElement).open
    setOpen(next)
    saveOpen(id, next)
    markTouched(id)
  }, [id])

  const onPointerDown = useCallback(() => markTouched(id), [id])

  return (
    <details
      className={styles.section}
      data-section-id={id}
      open={open}
      onToggle={onToggle}
      onPointerDown={onPointerDown}
      style={{ ['--accent' as string]: accent }}
    >
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden>{icon}</span>
        <span className={styles.title}>{title}</span>
        {badge !== undefined && badge !== null && <span className={styles.badge}>{badge}</span>}
        <span className={styles.chevron} aria-hidden><ChevronRight size={14} /></span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
