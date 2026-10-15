'use client'

import { getFileViewUrl, getUploadUrl, type FileKind } from '@/app/actions/storage.actions'

/**
 * Opens a stored document in a new tab. The tab is opened before the (async) permission
 * check so pop-up blockers allow it, then pointed at the short-lived signed URL.
 */
export async function openStoredFile(kind: FileKind, id: string) {
  const tab = window.open('', '_blank')
  const res = await getFileViewUrl(kind, id)
  if (res.success) {
    if (tab) tab.location.href = res.url
    else window.open(res.url, '_blank')
  } else {
    tab?.close()
    alert(res.error)
  }
}

/** Uploads a file to secure storage and returns the key/bucket to save on the owning row. */
export async function uploadStoredFile(kind: FileKind, file: File) {
  const presigned = await getUploadUrl(kind, file.type, file.size)
  if (!presigned.success) throw new Error(presigned.error)

  const res = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!res.ok) throw new Error('Upload failed. Please try again.')

  return { fileKey: presigned.fileKey, bucketName: presigned.bucketName }
}

/** File input `accept` matching what storage allows */
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*'
