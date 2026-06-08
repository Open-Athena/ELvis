import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  useFloating, useHover, useFocus, useDismiss, useRole, useInteractions,
  offset, flip, shift, autoUpdate, FloatingPortal, useTransitionStyles,
} from '@floating-ui/react'

interface TooltipProps {
  label: ReactNode
  children: ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Delay before the tooltip opens (ms). Default 200. */
  delay?: number
}

/** Floating-UI hover tooltip. Use this instead of the native `title` attribute
 *  for any hover hint — native titles are slow, plain, and unstyleable.
 *
 *  Wraps `children` in a transparent inline span that carries the reference
 *  ref + interaction handlers. (Wrapping is more reliable than cloneElement,
 *  which can miss refs on certain element types.) */
export function Tooltip({ label, children, placement = 'top', delay = 200 }: TooltipProps) {
  const [open, setOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const hover = useHover(context, { delay: { open: delay, close: 0 }, move: false })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  // Transition opacity only — `transform` is reserved for floating-ui's
  // position translate3d, and overriding it here would reset the tooltip
  // to (0, 0).
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: { open: 120, close: 80 },
    initial: { opacity: 0 },
    open: { opacity: 1 },
  })

  return (
    <>
      <span ref={refs.setReference} style={{ display: 'inline-flex' }} {...getReferenceProps()}>
        {children}
      </span>
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 10000,
              background: '#1f2030',
              color: '#e6e6ee',
              border: '1px solid #353650',
              borderRadius: 6,
              padding: '5px 9px',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.35,
              maxWidth: 280,
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
              pointerEvents: 'none',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              ...transitionStyles,
            }}
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
