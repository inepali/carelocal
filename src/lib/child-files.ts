'use client'

import { getChildFileUrl, getChildUploadUrl, registerChildFile } from '@/app/actions/child-files.actions'
import { showAlert } from '@/lib/dialog'

/** Opens a child's file in a new tab. The tab opens first so pop-up blockers allow it. */
export async function openChildFile(fileId: string) {
  const tab = window.open('', '_blank')
  const res = await getChildFileUrl(fileId)
  if (res.success) {
    if (tab) tab.location.href = res.url
    else window.open(res.url, '_blank')
  } else {
    tab?.close()
    showAlert(res.error)
  }
}

/** Uploads one file for a child (a PDF or a photo) and records it. Returns the new file id. */
export async function uploadChildFile(childId: string, file: File, requirementId?: string | null) {
  const presigned = await getChildUploadUrl(childId, file.type, file.size)
  if (!presigned.success) throw new Error(presigned.error)

  const put = await fetch(presigned.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
  if (!put.ok) throw new Error('Upload failed. Please try again.')

  const saved = await registerChildFile(childId, {
    fileKey: presigned.fileKey, fileName: file.name, contentType: file.type, requirementId: requirementId ?? null,
  })
  if (!saved.success) throw new Error(saved.error)
  return saved.fileId
}
