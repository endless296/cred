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

// Load Firebase credentials from environment
const FIREBASE_CONFIG = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: "googleapis.com"
}

// Load Supabase credentials from environment
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY

// Validate environment variables
const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_CLIENT_ID',
  'FIREBASE_CLIENT_CERT_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
]

const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '))
  process.exit(1)
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(FIREBASE_CONFIG)
  })
  console.log('✅ Firebase Admin initialized')
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message)
  process.exit(1)
}

// Initialize Supabase
let supabase
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  })
  console.log('✅ Supabase client initialized')
} catch (error) {
  console.error('❌ Supabase initialization failed:', error.message)
  process.exit(1)
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'octopus-push-api',
    timestamp: new Date().toISOString(),
    config: {
      firebase: '✅',
      supabase: '✅'
    }
  })
})

// Register push token
app.post('/api/push/register', async (req, res) => {
  const { user_id, token, platform } = req.body

  if (!user_id || !token || !platform) {
    return res.status(400).json({ error: 'user_id, token, and platform required' })
  }

  try {
    // Delete existing token for this user/platform
    await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', String(userId))
      .eq('platform', platform)

    // Insert new token
    const { data, error } = await supabase
      .from('push_tokens')
      .insert({ user_id, token, platform })

    if (error) throw error

    res.json({ success: true, data })
  } catch (error) {
    console.error('❌ Token registration failed:', error.message)
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
    console.error('❌ Token unregister failed:', error.message)
    res.status(500).json({ error: 'Failed to unregister token' })
  }
})

// Test endpoint
app.post('/api/push/test', async (req, res) => {
  const { user_id } = req.body

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  try {
    const result = await sendPushNotification(user_id, {
      title: 'Test Notification 🎉',
      body: 'This is a test from your Push API!',
      type: 'test',
      badge: 1
    })

    res.json({ success: true, result, message: 'Check your phone!' })
  } catch (error) {
    console.error('❌ Test notification failed:', error.message)
    res.status(500).json({
      error: 'Failed to send test notification',
      details: error.message
    })
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
    console.error('❌ Push send failed:', error.message)
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
    console.error('❌ Unread count fetch failed:', error.message)
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
      return { success: 0, failed: 0, message: 'No tokens registered' }
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
        const errorCode = result.reason?.code
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
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

    const successCount = results.filter(r => r.status === 'fulfilled').length
    const failedCount = results.filter(r => r.status === 'rejected').length

    return { success: successCount, failed: failedCount }
  } catch (error) {
    console.error('❌ sendPushNotification error:', error.message)
    throw error
  }
}

// Get unread message count
async function getUnreadCount(userId) {
  try {
    const response = await fetch(
      `${process.env.CHAT_API_URL || 'http://localhost:3001'}/api/messages/unread-count?user_id=${userId}`
    )
    const data = await response.json()
    return data.count || 0
  } catch (error) {
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
    const { data: sender, error } = await supabase
      .from('users')
      .select('full_name, profile_photo_url')
      .eq('id', senderId)
      .single()

    if (error || !sender) return

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
    console.error('❌ notifyNewMessage error:', error.message)
  }
}

// Notify on app notification
async function notifyAppNotification(notification) {
  const { recipient_id, actor_id, type, post_id } = notification

  try {
    const { data: actor, error } = await supabase
      .from('users')
      .select('full_name, profile_photo_url')
      .eq('id', actor_id)
      .single()

    if (error || !actor) return

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
    console.error('❌ notifyAppNotification error:', error.message)
  }
}

// Setup Supabase realtime listeners
let notificationsChannel = null
let chatMessagesChannel = null

function setupRealtimeNotifications() {
  // Cleanup existing channels
  if (notificationsChannel) supabase.removeChannel(notificationsChannel)
  if (chatMessagesChannel) supabase.removeChannel(chatMessagesChannel)

  // Listen for new app notifications
  notificationsChannel = supabase
    .channel('notifications-channel', {
      config: { broadcast: { self: true } }
    })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      async (payload) => {
        await notifyAppNotification(payload.new)
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Notifications channel subscribed')
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Notifications channel error:', err)
      }
    })

  // Listen for new chat messages
  chatMessagesChannel = supabase
    .channel('chat-messages-channel', {
      config: { broadcast: { self: true } }
    })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      async (payload) => {
        const message = payload.new
        await notifyNewMessage(message.sender_id, message.receiver_id, message)
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Chat messages channel subscribed')
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Chat messages channel error:', err)
      }
    })
}

// Start server
const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  console.log(`✅ Push API running on port ${PORT}`)
  
  // Setup realtime listeners after server starts
  setTimeout(() => {
    try {
      setupRealtimeNotifications()
    } catch (error) {
      console.error('⚠️ Realtime listeners setup failed:', error.message)
    }
  }, 2000)
})

// Graceful shutdown
const shutdown = () => {
  if (notificationsChannel) supabase.removeChannel(notificationsChannel)
  if (chatMessagesChannel) supabase.removeChannel(chatMessagesChannel)
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Export for testing
export { sendPushNotification, notifyNewMessage, notifyAppNotification }
