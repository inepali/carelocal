'use client'
import { createContext, useContext } from 'react'

type CenterContextType = {
  staffTerm: string;
  workAreaTerm: string;
}

export const CenterContext = createContext<CenterContextType>({
  staffTerm: 'Staffs',
  workAreaTerm: 'Classrooms'
})

export const useCenterContext = () => useContext(CenterContext)
