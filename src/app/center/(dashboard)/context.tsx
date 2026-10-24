'use client'
import { createContext, useContext } from 'react'
import type { DomainKey } from '@/lib/domain-config'

type CenterContextType = {
  staffTerm: string;
  workAreaTerm: string;
  domainKey: DomainKey;
  /** The signed-in user's center and role there ('owner' | 'admin' | ...), null until loaded */
  centerId: string | null;
  role: string | null;
  /** Child Files is switched on for this center (a super admin turns it on) */
  childFilesEnabled: boolean;
}

export const CenterContext = createContext<CenterContextType>({
  staffTerm: 'Staffs',
  workAreaTerm: 'Classrooms',
  domainKey: 'childcare',
  centerId: null,
  role: null,
  childFilesEnabled: false,
})

export const useCenterContext = () => useContext(CenterContext)

/** Receipts are kept by the owner and administrators only (the database enforces the same rule) */
export const canManageReceipts = (ctx: Pick<CenterContextType, 'role'>) => ctx.role === 'owner' || ctx.role === 'admin'

/** Only the owner and administrators may open child records (the database enforces the same rule) */
export const canOpenChildFiles = (ctx: Pick<CenterContextType, 'domainKey' | 'role' | 'childFilesEnabled'>) =>
  ctx.domainKey === 'childcare' && ctx.childFilesEnabled && (ctx.role === 'owner' || ctx.role === 'admin')
