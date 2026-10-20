'use server'

import { getSignedInUserId, isCenterAdminOf } from '@/lib/server/staff-access'
import { copyAcceptedDocuments } from '@/lib/server/document-snapshots'

/** Copy-on-accept for a center admin (see copyAcceptedDocuments). */
export async function snapshotAcceptedDocuments(centerId: string, staffId: string) {
  const userId = await getSignedInUserId()
  if (!userId) return { success: false as const, error: 'Not signed in' }
  if (!(await isCenterAdminOf(userId, centerId))) return { success: false as const, error: 'Not allowed' }
  return copyAcceptedDocuments(centerId, staffId)
}
