// backend/server.js
import express from 'express'
import cors from 'cors'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const isDev = process.env.NODE_ENV !== 'production'

// Enable CORS - allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// Initialize R2 Client
const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET_NAME = 'images'

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'octopus-main-api' })
})

// Generate presigned URL endpoint
app.get('/api/generate-upload-url', async (req, res) => {
  try {
    const { filename, contentType } = req.query
    
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType required' })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const extension = filename.split('.').pop()
    const key = `posts/${timestamp}-${randomStr}.${extension}`

    // Create presigned URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    })

    const presignedUrl = await getSignedUrl(R2, command, {
      expiresIn: 3600, // 1 hour
    })

    // Check if public URL is configured
    let viewUrl
    if (process.env.R2_PUBLIC_URL) {
      viewUrl = `${process.env.R2_PUBLIC_URL}/${key}`
    } else {
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
      viewUrl = await getSignedUrl(R2, getCommand, {
        expiresIn: 604800, // 7 days
      })
    }

    // Return both upload URL and view URL
    res.json({
      url: presignedUrl,
      key: key,
      publicUrl: viewUrl
    })
    
    if (isDev) console.log(`✅ Generated URLs for: ${key}`)
  } catch (error) {
    if (isDev) console.error('Error generating presigned URL:', error)
    res.status(500).json({ error: 'Failed to generate upload URL' })
  }
})

app.listen(PORT, () => {
  console.log(`✅ Main API running on port ${PORT}`)
})