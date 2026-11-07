'use client'

import { createContext, useContext } from 'react'

/**
 * Unread parent messages on the Live roster: which children have a message from a parent that nobody on the
 * roster has opened yet. RosterBoard keeps the counts; the child circles show a dot; the child card refreshes
 * the counts after a conversation is opened.
 */
export const UnreadMessagesContext = createContext<{ byChild: Record<string, number>; refresh: () => void }>({
  byChild: {},
  refresh: () => {},
})

export const useUnreadMessages = () => useContext(UnreadMessagesContext)

/** The dot on a child's circle; nothing for staff or children without unread messages */
export function MessageDot({ childId, size = 14 }: { childId: string | null; size?: number }) {
  const { byChild } = useUnreadMessages()
  const n = childId ? byChild[childId] ?? 0 : 0
  if (!n) return null
  return (
    <span aria-label={`${n} unread message${n === 1 ? '' : 's'} from a parent`} title="New message from a parent"
      className="absolute -left-0.5 -top-0.5 z-10 flex items-center justify-center rounded-full border-2 border-white bg-[#2357d9] text-[9px] font-bold text-white"
      style={{ minWidth: size, height: size }}>
      {n > 1 ? n : ''}
    </span>
  )
}
