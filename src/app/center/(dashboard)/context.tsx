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
  /** Live Roster is switched on for this center (a super admin turns it on) */
  rosterEnabled: boolean;
  /** Menu Planning is switched on for this center (a super admin turns it on) */
  menuPlanningEnabled: boolean;
  /** Lesson Plans is switched on for this center (on unless a super admin turns it off) */
  lessonPlansEnabled: boolean;
  /** Announcements is switched on for this center (a super admin turns it on) */
  announcementsEnabled: boolean;
  /** Staff schedule is switched on for this center (a super admin turns it on) */
  scheduleEnabled: boolean;
  /** Tuition (rate card, children's fees, who pays) is switched on for this center (a super admin turns it on) */
  tuitionEnabled: boolean;
}

export const CenterContext = createContext<CenterContextType>({
  staffTerm: 'Staffs',
  workAreaTerm: 'Classrooms',
  domainKey: 'childcare',
  centerId: null,
  role: null,
  childFilesEnabled: false,
  rosterEnabled: false,
  menuPlanningEnabled: false,
  lessonPlansEnabled: true,
  announcementsEnabled: false,
  scheduleEnabled: false,
  tuitionEnabled: false,
})

export const useCenterContext = () => useContext(CenterContext)

/** Receipts are kept by the owner and administrators only (the database enforces the same rule) */
export const canManageReceipts = (ctx: Pick<CenterContextType, 'role'>) => ctx.role === 'owner' || ctx.role === 'admin'

/** Only the owner and administrators may open child records (the database enforces the same rule) */
export const canOpenChildFiles = (ctx: Pick<CenterContextType, 'domainKey' | 'role' | 'childFilesEnabled'>) =>
  ctx.domainKey === 'childcare' && ctx.childFilesEnabled && (ctx.role === 'owner' || ctx.role === 'admin')

/** The Live Roster needs Child Files and its own switch; owners and administrators open it here (teachers get their own view) */
export const canOpenRoster = (ctx: Pick<CenterContextType, 'domainKey' | 'role' | 'childFilesEnabled' | 'rosterEnabled'>) =>
  canOpenChildFiles(ctx) && ctx.rosterEnabled

/** The staff schedule is for the owner and administrators to plan (teachers see it read-only in the staff portal) */
export const canManageSchedule = (ctx: Pick<CenterContextType, 'role' | 'scheduleEnabled'>) =>
  ctx.scheduleEnabled && (ctx.role === 'owner' || ctx.role === 'admin')

/** Tuition rides on Child Files; the owner and administrators keep it (the database enforces the same rule) */
export const canManageTuition = (ctx: Pick<CenterContextType, 'domainKey' | 'role' | 'childFilesEnabled' | 'tuitionEnabled'>) =>
  canOpenChildFiles(ctx) && ctx.tuitionEnabled
