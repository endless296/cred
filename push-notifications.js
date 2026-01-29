import express from 'express'
import cors from 'cors'
import admin from 'firebase-admin'
import { createClient } from '@supabase/supabase-js'

const app = express()
const isDev = process.env.NODE_ENV !== 'production'

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// HARDCODED CREDENTIALS FOR TESTING
const FIREBASE_CONFIG = {
  "type": "service_account",
  "project_id": "josh-d6c",
  "private_key_id": "59383438d68a0f248e2054d82be93246ef967c38",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC64Y1RGTkt+gWU\nklM1MCjaN9auQpr9QE+Pf5XBVp2PL2cQ7d/o8TxC+ZeGfS1ng+3g2g2JDNefrMZs\niPuOji+JH+YuvWe2v0gc89Mpmf9yIU6LGXc8dw/5I362Bq7jb18w53tL6F3kyOxS\nL0AEs32rXHz/eNu9C0GNgx+G5pfdE/jUNrNOkU08RHcYZfXBqZ+qJfhT9Ad110Li\nHjO1rf3NNqRgNRY1yYvH6lvZPWFIgmTF66aLQ2yFPhG1rh0UbSdZIyK6dLDTG0uU\n98GaGKVDJs/Y/PVWgOXdjeQT/BhmrGgeqbctSJ/EEKHm7QqRs4rg1ORaTq+uPNoq\nNPruZLzBAgMBAAECggEAA1xgvGd4jmRlToSnYIqqPPkX/nO8Tpre+ohnI8jsteo6\nmh2d76RaGs/M2jQpVCfcoO3a+a7Uf3I/nNdMtYWqF/cN89x1JoknHZMRpkd+OBEQ\nRrZ2zuHZDYZ4DvUz7BX0f3dgfFRg3TydzZ2uegAOXeiELk0cZv+OxL53/vUiywlJ\nMkWkXprSGoGufUCgR+aGoPjPzJJtCX1gyx6t5kcSShS4BLQyK+hB/rEYofr+a08a\n5vCLINJGkXR8usP6Pht9iI8NnHWkAS7uhnjJihWgqSqE/6eqljGcCqJozjikJ1fT\nQ8SmstYrHhUQY8Mp8JhNtznhG4wUbT2wZvP+hbjLKQKBgQDpffbIkhBYpJwz8q4g\nnHEB2nqynf5W4i0acV85Brt9fj8JqQH8fjIaHD5CdsCD82iskWtTk+A6CbhD2mqh\ndkFXUp5H8OfbU/WqDZL9Ng78R1LFUfsitbIYo50DS8V1QWwZjAwDqJQfWcW1VYHT\n5BJtEhiOTqdsQh4U04Y0QPyurQKBgQDM5VaYnZIwpp5hYJRll8dA2Rga/rXts7ue\nHhsCcJFJmZ+gfQO6hdfIM5MM1J0LdXiFEVmcVqosvJ+yJOlRJd+gqgTogTC8Hzd0\n8Dk9QcR/3kLmhJgWjA7vQBf51CvXJTUfIR7ijtWAqZScYoDE/NszEzso1alSBqwm\n9A7bvEns5QKBgQCHFdVdHQRQBIxKkbCkNV48EEbEaBvp8Fjf34+T0o1OgWe/EwSP\nLAOYj5aFpWaj8IMys79AT2F+snjk6MygNWaAOtBQFtRNVDng9JGB5XCuDCWa+18s\nKaqsDpycd4351KvR6/BXfYSUzr9PtfSyvlTavYlva5n5TBdTPT17pc2K0QKBgQCF\n/4Y+kO5GevEhZfQm7LgWpOOq4+E+70hIBBBN7ChYJevLHXcOyPFxsKj+vx1lnRGQ\nlOQx5kusrj8SVilwNICnpglHtRWWMiQmieQlN5m2tjiyYQzF0hsCRLxpWmTBc0fm\nb9au/BKM7lqOW60zJtqD8JPEBNeTGWIEp5///IesMQKBgExyq4n0F8IWIq6nSa8B\nofzzIqkIsP7GFGIk85cENITSgPNmbDK1Pad7res5HmWzOpZOpmzHwlG2dIwd7o71\nSSQ/Y2C2GbXAlP/wrXkVC+3W4/+SyuVuyS8Cz5SKBf3joMNkBNWXk83Zl6Z7fY9K\nkjYzJ9sOytH7jPgPjGsk02ej\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@josh-d6c.iam.gserviceaccount.com",
  "client_id": "102083422266274596438",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40josh-d6c.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}

const SUPABASE_URL = "https://hqrsymjlycynalfgkefx.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxcnN5bWpseWN5bmFsZmdrZWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5OTY1MDAsImV4cCI6MjA4MDU3MjUwMH0.2_o7PG-qQkYaFJSmGuvZFPi2nwQ7ERwaP5RE0fWuwWw"

console.log('🔧 Starting Push API with hardcoded credentials...')

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(FIREBASE_CONFIG)
  })
  console.log('✅ Firebase Admin initialized')
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message)
  process.exit(1)
}

// Initialize Supabase
let supabase
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  console.log('✅ Supabase client initialized')
  console.log('   URL:', SUPABASE_URL)
} catch (error) {
  console.error('❌ Failed to initialize Supabase:', error.message)
  process.exit(1)
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'octopus-push-api',
    timestamp: new Date().toISOString(),
    config: {
      firebase: '✅ initialized',
      supabase: '✅ initialized'
    }
  })
})

// Register push token
app.post('/api/push/register', async (req, res) => {
  const { user_id, token, platform } = req.body

  console.log('📝 Register request:', { user_id, token: token?.substring(0, 20) + '...', platform })

  if (!user_id || !token || !platform) {
    console.log('❌ Missing required fields')
    return res.status(400).json({ error: 'user_id, token, and platform required' })
  }

  try {
    console.log('💾 Attempting to insert into Supabase...')
    
    const { data, error } = await supabase
      .from('push_tokens')
      .upsert({ user_id, token, platform }, { onConflict: 'token' })

    if (error) {
      console.error('❌ Supabase error:', error)
      throw error
    }

    console.log('✅ Token registered successfully')
    res.json({ success: true })
  } catch (error) {
    console.error('❌ Error registering token:', error)
    res.status(500).json({ 
      error: 'Failed to register token',
      details: isDev ? error.message : undefined
    })
  }
})

// Remove push token
app.post('/api/push/unregister', async (req, res) => {
  const { token } = req.body

  if (!token) {
    return res.status(400).json({ error: 'token required' })
  }

  try {
    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .eq('token', token)

    if (error) throw error

    res.json({ success: true })
  } catch (error) {
    console.error('Error unregistering token:', error)
    res.status(500).json({ error: 'Failed to unregister token' })
  }
})

// Send push notification
app.post('/api/push/send', async (req, res) => {
  const { user_id, notification } = req.body

  if (!user_id || !notification) {
    return res.status(400).json({ error: 'user_id and notification required' })
  }

  try {
    const result = await sendPushNotification(user_id, notification)
    res.json(result)
  } catch (error) {
    console.error('Error sending notification:', error)
    res.status(500).json({ error: 'Failed to send notification' })
  }
})

// Get unread message count
app.get('/api/messages/unread-count', async (req, res) => {
  const { user_id } = req.query

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  try {
    const count = await getUnreadCount(user_id)
    res.json({ count })
  } catch (error) {
    console.error('Error fetching unread count:', error)
    res.status(500).json({ error: 'Failed to fetch unread count' })
  }
})

// Send push notification function
async function sendPushNotification(userId, notification) {
  try {
    const { data: tokens, error } = await supabase
      .from('push_tokens')
      .select('token, platform')
      .eq('user_id', userId)

    if (error) throw error

    if (!tokens || tokens.length === 0) {
      console.log(`No push tokens for user ${userId}`)
      return { success: 0, failed: 0 }
    }

    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.image || undefined
      },
      data: {
        type: notification.type || '',
        id: notification.id || '',
        userId: notification.userId || '',
        ...notification.data
      },
      android: {
        notification: {
          sound: 'default',
          channelId: 'default',
          priority: 'high'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: notification.badge || 0
          }
        }
      }
    }

    const results = await Promise.allSettled(
      tokens.map(({ token }) =>
        admin.messaging().send({ ...message, token })
      )
    )

    const invalidTokens = []
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to send to token ${tokens[index].token}:`, result.reason)
        
        if (
          result.reason?.code === 'messaging/invalid-registration-token' ||
          result.reason?.code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[index].token)
        }
      }
    })

    if (invalidTokens.length > 0) {
      await supabase
        .from('push_tokens')
        .delete()
        .in('token', invalidTokens)
    }

    return {
      success: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    }

  } catch (error) {
    console.error('Error sending push notification:', error)
    throw error
  }
}

// Get unread message count
async function getUnreadCount(userId) {
  try {
    const response = await fetch(`${process.env.CHAT_API_URL || 'http://localhost:3001'}/api/messages/unread-count?user_id=${userId}`)
    const data = await response.json()
    return data.count || 0
  } catch (error) {
    console.error('Error fetching unread count:', error)
    return 0
  }
}

// Get app notification count
async function getAppNotificationCount(userId) {
  try {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false)

    return count || 0
  } catch (error) {
    return 0
  }
}

// Notify on new message
async function notifyNewMessage(senderId, receiverId, message) {
  try {
    const { data: sender } = await supabase
      .from('users')
      .select('full_name, profile_photo_url')
      .eq('id', senderId)
      .single()

    if (!sender) return

    await sendPushNotification(receiverId, {
      title: sender.full_name,
      body: message.message || '📷 Sent a photo',
      image: sender.profile_photo_url,
      type: 'message',
      userId: senderId,
      badge: await getUnreadCount(receiverId),
      data: {
        chatWithId: senderId,
        chatWith: sender.full_name
      }
    })
  } catch (error) {
    console.error('Error in notifyNewMessage:', error)
  }
}

// Notify on app notification
async function notifyAppNotification(notification) {
  const { recipient_id, actor_id, type, post_id } = notification

  try {
    const { data: actor } = await supabase
      .from('users')
      .select('full_name, profile_photo_url')
      .eq('id', actor_id)
      .single()

    if (!actor) return

    const notificationTexts = {
      like: `${actor.full_name} liked your post`,
      comment: `${actor.full_name} commented on your post`,
      mention: `${actor.full_name} mentioned you in a comment`,
      tag: `${actor.full_name} tagged you in a post`,
      follow: `${actor.full_name} started following you`,
      friend_request: `${actor.full_name} sent you a friend request`,
      friend_accept: `${actor.full_name} accepted your friend request`
    }

    await sendPushNotification(recipient_id, {
      title: 'Octopus',
      body: notificationTexts[type] || 'New notification',
      image: actor.profile_photo_url,
      type: type,
      id: post_id || '',
      userId: actor_id,
      badge: await getAppNotificationCount(recipient_id)
    })
  } catch (error) {
    console.error('Error in notifyAppNotification:', error)
  }
}

// Setup Supabase realtime listeners
function setupRealtimeNotifications() {
  console.log('🔄 Setting up realtime listeners...')
  
  // Listen for new app notifications (likes, comments, follows, etc.)
  supabase
    .channel('notifications')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications'
      },
      async (payload) => {
        console.log('🔔 New notification detected:', payload.new.type)
        await notifyAppNotification(payload.new)
      }
    )
    .subscribe((status) => {
      console.log('   notifications channel status:', status)
    })

  // Listen for new chat messages
  supabase
    .channel('chat_messages')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages'
      },
      async (payload) => {
        const message = payload.new
        console.log(`💬 New message from ${message.sender_id} to ${message.receiver_id}`)
        await notifyNewMessage(
          message.sender_id,
          message.receiver_id,
          message
        )
      }
    )
    .subscribe((status) => {
      console.log('   chat_messages channel status:', status)
    })

  console.log('✅ Realtime notification listeners configured')
  console.log('   → Listening to: notifications table')
  console.log('   → Listening to: chat_messages table')
}

// Start server first, then setup listeners
const PORT = process.env.PORT || 3002

app.listen(PORT, () => {
  console.log(`✅ Push API running on port ${PORT}`)
  console.log(`✅ Health check available at http://localhost:${PORT}/health`)
  
  // Setup realtime listeners after server starts
  try {
    setupRealtimeNotifications()
  } catch (error) {
    console.error('⚠️  Failed to setup realtime listeners:', error.message)
    console.error('   The API will still work for direct push notifications')
  }
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully')
  process.exit(0)
})

// Export for testing
export {
  sendPushNotification,
  notifyNewMessage,
  notifyAppNotification
}
