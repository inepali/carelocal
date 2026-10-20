'use client'

import { getFileViewUrl, getUploadUrl, type FileKind } from '@/app/actions/storage.actions'
import { showAlert } from '@/lib/dialog'

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
    showAlert(res.error)
  }
}

/** Uploads a file to secure storage and returns the key/bucket to save on the owning row. */
export async function uploadStoredFile(kind: FileKind, file: File, options?: { staffId?: string }) {
  const presigned = await getUploadUrl(kind, file.type, file.size, options?.staffId)
  if (!presigned.success) throw new Error(presigned.error)

  const res = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!res.ok) throw new Error('Upload failed. Please try again.')

  return { fileKey: presigned.fileKey, bucketName: presigned.bucketName }
}

/** A file that already arrived in storage from a phone (see PhoneUploadDialog). */
export interface PhoneUpload {
  source: 'phone'
  fileKey: string
  bucketName: string
  name: string
  type: string
  size: number
}

/** What an upload form holds: a picked file, or one sent from a phone. */
export type UploadSource = File | PhoneUpload

export const isPhoneUpload = (source: UploadSource): source is PhoneUpload =>
  !(source instanceof File) && (source as PhoneUpload).source === 'phone'

/**
 * Stores an upload source and returns what the owning row needs. A picked file is uploaded now; a phone
 * upload is already in storage, so it is passed through. Lets every form save both the same way.
 */
export async function storeUpload(kind: FileKind, source: UploadSource, options?: { staffId?: string }) {
  if (isPhoneUpload(source)) {
    return { fileKey: source.fileKey, bucketName: source.bucketName, name: source.name, type: source.type, size: source.size }
  }
  const { fileKey, bucketName } = await uploadStoredFile(kind, source, options)
  return { fileKey, bucketName, name: source.name, type: source.type, size: source.size }
}

/** File input `accept` matching what storage allows */
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*'
