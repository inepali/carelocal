'use client'
import { createContext, useContext } from 'react'
import type { DomainKey } from '@/lib/domain-config'

type CenterContextType = {
  staffTerm: string;
  workAreaTerm: string;
  domainKey: DomainKey;
}

export const CenterContext = createContext<CenterContextType>({
  staffTerm: 'Staffs',
  workAreaTerm: 'Classrooms',
  domainKey: 'childcare'
})

export const useCenterContext = () => useContext(CenterContext)
