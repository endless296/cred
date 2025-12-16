// backend/api/r2-presigned-url.js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize R2 Client
const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = 'images'; // Your bucket name

// Express route handler (or adapt to your framework)
export async function generatePresignedUrl(req, res) {
  try {
    const { filename, contentType } = req.query;
    
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType required' });
    }

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const extension = filename.split('.').pop();
    const key = `posts/${timestamp}-${randomStr}.${extension}`;

    // Create presigned URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(R2, command, {
      expiresIn: 3600, // URL expires in 1 hour
    });

    // Return presigned URL and key
    res.json({
      url: presignedUrl,
      key: key,
      publicUrl: `https://pub-yourhash.r2.dev/${key}` // Replace with your public R2 domain
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
}

// Setup CORS for your R2 bucket (run once)
// You need to do this from your backend or using AWS CLI
export async function setupR2Cors() {
  const { PutBucketCorsCommand } = await import('@aws-sdk/client-s3');
  
  const corsConfig = {
    Bucket: BUCKET_NAME,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['content-type', 'x-amz-*'],
          AllowedMethods: ['PUT', 'GET'],
          AllowedOrigins: ['http://localhost:8100', 'https://yourdomain.com'], // Add your domains
          ExposeHeaders: [],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  };

  const command = new PutBucketCorsCommand(corsConfig);
  await R2.send(command);
  console.log('CORS configured successfully');
}

