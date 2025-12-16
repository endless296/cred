// backend/setup-cors.js
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'

dotenv.config()

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const corsConfig = {
  Bucket: 'images',
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedHeaders: ['*'],
        AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
        AllowedOrigins: ['*'], // ✅ Changed to allow ALL origins
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ],
  },
}

async function setupCORS() {
  try {
    const command = new PutBucketCorsCommand(corsConfig)
    await R2.send(command)
    console.log('✅ CORS configured successfully for all origins!')
  } catch (error) {
    console.error('❌ Error setting up CORS:', error)
    console.error('Make sure your R2 credentials are correct')
  }
}

setupCORS()