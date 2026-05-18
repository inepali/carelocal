'use client'
import { createContext, useContext } from 'react'

type CenterContextType = {
  staffTerm: string;
  classroomTerm: string;
}

export const CenterContext = createContext<CenterContextType>({
  staffTerm: 'Staffs',
  classroomTerm: 'Classrooms'
})

export const useCenterContext = () => useContext(CenterContext)
