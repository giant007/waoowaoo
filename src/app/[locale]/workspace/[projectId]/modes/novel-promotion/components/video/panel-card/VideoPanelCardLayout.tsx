'use client'

import React from 'react'
import VideoPanelCardHeader from './VideoPanelCardHeader'
import VideoPanelCardBody from './VideoPanelCardBody'
import VideoPanelCardFooter from './VideoPanelCardFooter'
import { useVideoPanelActions, type VideoPanelCardShellProps } from './hooks/useVideoPanelActions'

export type { VideoPanelCardShellProps }

function VideoPanelCardLayout(props: VideoPanelCardShellProps) {
  const runtime = useVideoPanelActions(props)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [showDetails, setShowDetails] = React.useState(false)

  React.useEffect(() => {
    if (showDetails) return
    const element = cardRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShowDetails(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          setShowDetails(true)
          observer.disconnect()
        }
      },
      { root: null, rootMargin: '420px', threshold: 0.01 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [showDetails])

  return (
    <div ref={cardRef} className="overflow-visible rounded-[var(--glass-radius-lg)] border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface-strong)] shadow-[0_8px_20px_rgba(15,23,42,0.10),0_2px_6px_rgba(15,23,42,0.08)]">
      <VideoPanelCardHeader runtime={runtime} />
      {showDetails ? (
        <>
          <VideoPanelCardBody runtime={runtime} />
          <VideoPanelCardFooter runtime={runtime} />
        </>
      ) : (
        <div className="p-4 border-t border-[var(--glass-stroke-base)]">
          <div className="h-3 rounded bg-[var(--glass-bg-muted)]/80 animate-pulse" />
        </div>
      )}
    </div>
  )
}

export default React.memo(VideoPanelCardLayout)
