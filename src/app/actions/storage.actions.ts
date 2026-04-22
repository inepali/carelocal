'use server'

import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'

export async function getPresignedUploadUrl(fileName: string, contentType: string, bucketType: 'employee' | 'center' = 'employee') {
  try {
    // Log env var presence (values redacted) to help debug production issues
    console.log('[R2 Upload] env check:', {
      R2_ACCOUNT_ID:       !!process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID:    !!process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY:!!process.env.R2_SECRET_ACCESS_KEY,
      R2_EMPLOYEE_BUCKET:  !!process.env.R2_EMPLOYEE_BUCKET,
      R2_CENTER_BUCKET:    !!process.env.R2_CENTER_BUCKET,
      bucketType,
    })

    const bucketName = bucketType === 'employee'
      ? process.env.R2_EMPLOYEE_BUCKET
      : process.env.R2_CENTER_BUCKET

    if (!bucketName) {
      throw new Error(`R2_${bucketType === 'employee' ? 'EMPLOYEE' : 'CENTER'}_BUCKET env var is not set on this server`)
    }

    // Generate a unique file path
    const timestamp = Date.now()
    const sanitizedFileName = fileName.replace(/\s+/g, '-').toLowerCase()
    const fileKey = `${bucketType}/${timestamp}-${sanitizedFileName}`

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: contentType,
    })

    // Generate URL that expires in 1 hour
    const url = await getSignedUrl(r2, command, { expiresIn: 3600 })

    return { 
      success: true, 
      uploadUrl: url, 
      fileKey: fileKey,
      bucketName: bucketName
    }
  } catch (error: any) {
    console.error('Error generating presigned upload URL:', error)
    return { success: false, error: error?.message || 'Failed to generate upload URL' }
  }
}

export async function getPresignedViewUrl(fileKey: string, bucketName: string) {
  try {
    if (!fileKey || !bucketName) {
      throw new Error('Missing fileKey or bucketName')
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    })

    // Short-lived URL (1 hour)
    const url = await getSignedUrl(r2, command, { expiresIn: 3600 })

    return { success: true, url }
  } catch (error: any) {
    console.error('Error generating presigned view URL:', error)
    return { success: false, error: error?.message || 'Failed to generate access link' }
  }
}
export async function deleteFile(fileKey: string, bucketName: string) {
  try {
    if (!fileKey || !bucketName) {
      throw new Error('Missing fileKey or bucketName')
    }

    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    })

    await r2.send(command)
    return { success: true }
  } catch (error) {
    console.error('Error deleting file from R2:', error)
    return { success: false, error: 'Failed to delete file' }
  }
}
