'use server'

import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2 } from '@/lib/r2'

export async function getPresignedUploadUrl(fileName: string, contentType: string, bucketType: 'employee' | 'center' = 'employee') {
  try {
    const bucketName = bucketType === 'employee' 
      ? process.env.R2_EMPLOYEE_BUCKET 
      : process.env.R2_CENTER_BUCKET

    if (!bucketName) {
      throw new Error(`R2 bucket for ${bucketType} not defined`)
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
  } catch (error) {
    console.error('Error generating presigned upload URL:', error)
    return { success: false, error: 'Failed to generate upload URL' }
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
  } catch (error) {
    console.error('Error generating presigned view URL:', error)
    return { success: false, error: 'Failed to generate access link' }
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
