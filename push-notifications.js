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

// Load credentials from environment variables
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

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY

console.log('🔧 Starting Push API...')

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
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  })
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
    console.log('💾 Attempting to upsert into Supabase...')
    
    // First, try to delete any existing token for this user/platform combo
    await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', user_id)
      .eq('platform', platform)

    // Then insert the new token
    const { data, error } = await supabase
      .from('push_tokens')
      .insert({ user_id, token, platform })

    if (error) {
      console.error('❌ Supabase error:', error)
      throw error
    }

    console.log('✅ Token registered successfully')
    res.json({ success: true, data })
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

// 🆕 TEST ENDPOINT - Send a test notification to a user
app.post('/api/push/test', async (req, res) => {
  const { user_id } = req.body

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  console.log('🧪 TEST: Sending test notification to user:', user_id)

  try {
    const result = await sendPushNotification(user_id, {
      title: 'Test Notification',
      body: 'This is a test from your Push API! 🎉',
      type: 'test',
      badge: 1
    })

    console.log('✅ TEST: Notification sent. Result:', result)
    res.json({ 
      success: true, 
      result,
      message: 'Check your phone!'
    })
  } catch (error) {
    console.error('❌ TEST: Failed to send notification:', error)
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
    console.log(`🔔 Fetching push tokens for user: ${userId}`)
    
    const { data: tokens, error } = await supabase
      .from('push_tokens')
      .select('token, platform')
      .eq('user_id', userId)

    if (error) {
      console.error('❌ Error fetching tokens:', error)
      throw error
    }

    console.log(`📱 Found ${tokens?.length || 0} token(s) for user ${userId}`)

    if (!tokens || tokens.length === 0) {
      console.log(`⚠️  No push tokens for user ${userId}`)
      return { success: 0, failed: 0, message: 'No tokens registered' }
    }

    // Log the tokens (first 20 chars only for security)
    tokens.forEach((t, i) => {
      console.log(`   Token ${i + 1}: ${t.token.substring(0, 20)}... (${t.platform})`)
    })

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

    console.log(`📤 Sending notification: "${notification.title}" - "${notification.body}"`)

    const results = await Promise.allSettled(
      tokens.map(({ token, platform }) =>
        admin.messaging().send({ ...message, token })
          .then(response => {
            console.log(`✅ Notification sent successfully to ${platform}: ${response}`)
            return response
          })
          .catch(error => {
            console.error(`❌ Failed to send to ${platform}:`, error.code, error.message)
            throw error
          })
      )
    )

    const invalidTokens = []
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const errorCode = result.reason?.code
        console.error(`❌ Send failed for token ${index + 1}:`, errorCode)
        
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[index].token)
          console.log(`🗑️  Marking token ${index + 1} for deletion (invalid)`)
        }
      }
    })

    if (invalidTokens.length > 0) {
      console.log(`🗑️  Deleting ${invalidTokens.length} invalid token(s)`)
      await supabase
        .from('push_tokens')
        .delete()
        .in('token', invalidTokens)
    }

    const successCount = results.filter(r => r.status === 'fulfilled').length
    const failedCount = results.filter(r => r.status === 'rejected').length

    console.log(`📊 Notification results: ${successCount} success, ${failedCount} failed`)

    return {
      success: successCount,
      failed: failedCount
    }

  } catch (error) {
    console.error('❌ Error in sendPushNotification:', error)
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
  console.log(`💬 Processing new message notification: ${senderId} → ${receiverId}`)
  
  try {
    const { data: sender, error } = await supabase
      .from('users')
      .select('full_name, profile_photo_url')
      .eq('id', senderId)
      .single()

    if (error) {
      console.error('❌ Error fetching sender:', error)
      return
    }

    if (!sender) {
      console.log('⚠️  Sender not found:', senderId)
      return
    }

    console.log(`👤 Sender: ${sender.full_name}`)
    console.log(`📧 Sending notification to receiver: ${receiverId}`)

    const result = await sendPushNotification(receiverId, {
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

    console.log(`✅ Message notification sent. Result:`, result)
  } catch (error) {
    console.error('❌ Error in notifyNewMessage:', error)
  }
}

// Notify on app notification
async function notifyAppNotification(notification) {
  const { recipient_id, actor_id, type, post_id } = notification

  console.log(`🔔 Processing app notification: ${type} from ${actor_id} to ${recipient_id}`)

  try {
    const { data: actor, error } = await supabase
      .from('users')
      .select('full_name, profile_photo_url')
      .eq('id', actor_id)
      .single()

    if (error) {
      console.error('❌ Error fetching actor:', error)
      return
    }

    if (!actor) {
      console.log('⚠️  Actor not found:', actor_id)
      return
    }

    const notificationTexts = {
      like: `${actor.full_name} liked your post`,
      comment: `${actor.full_name} commented on your post`,
      mention: `${actor.full_name} mentioned you in a comment`,
      tag: `${actor.full_name} tagged you in a post`,
      follow: `${actor.full_name} started following you`,
      friend_request: `${actor.full_name} sent you a friend request`,
      friend_accept: `${actor.full_name} accepted your friend request`
    }

    console.log(`👤 Actor: ${actor.full_name}`)
    console.log(`📧 Sending ${type} notification to: ${recipient_id}`)

    const result = await sendPushNotification(recipient_id, {
      title: 'Octopus',
      body: notificationTexts[type] || 'New notification',
      image: actor.profile_photo_url,
      type: type,
      id: post_id || '',
      userId: actor_id,
      badge: await getAppNotificationCount(recipient_id)
    })

    console.log(`✅ App notification sent. Result:`, result)
  } catch (error) {
    console.error('❌ Error in notifyAppNotification:', error)
  }
}

// Setup Supabase realtime listeners with better error handling
let notificationsChannel = null
let chatMessagesChannel = null

function setupRealtimeNotifications() {
  console.log('🔄 Setting up realtime listeners...')
  
  // Cleanup existing channels if any
  if (notificationsChannel) {
    supabase.removeChannel(notificationsChannel)
  }
  if (chatMessagesChannel) {
    supabase.removeChannel(chatMessagesChannel)
  }
  
  // Listen for new app notifications (likes, comments, follows, etc.)
  notificationsChannel = supabase
    .channel('notifications-channel', {
      config: {
        broadcast: { self: true }
      }
    })
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
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ notifications channel: SUBSCRIBED')
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ notifications channel: ERROR', err)
      } else if (status === 'TIMED_OUT') {
        console.log('⏱️  notifications channel: TIMED_OUT, will retry...')
      }
    })

  // Listen for new chat messages
  chatMessagesChannel = supabase
    .channel('chat-messages-channel', {
      config: {
        broadcast: { self: true }
      }
    })
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages'
      },
      async (payload) => {
        const message = payload.new
        console.log(`💬 New message detected: ${message.sender_id} → ${message.receiver_id}`)
        await notifyNewMessage(
          message.sender_id,
          message.receiver_id,
          message
        )
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ chat_messages channel: SUBSCRIBED')
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ chat_messages channel: ERROR', err)
      } else if (status === 'TIMED_OUT') {
        console.log('⏱️  chat_messages channel: TIMED_OUT, will retry...')
      }
    })

  console.log('✅ Realtime notification listeners configured')
}

// Start server first, then setup listeners
const PORT = process.env.PORT || 3002

app.listen(PORT, () => {
  console.log(`✅ Push API running on port ${PORT}`)
  console.log(`✅ Health check available at http://localhost:${PORT}/health`)
  console.log(`🧪 Test endpoint available at POST /api/push/test`)
  
  // Setup realtime listeners after server starts
  setTimeout(() => {
    try {
      setupRealtimeNotifications()
    } catch (error) {
      console.error('⚠️  Failed to setup realtime listeners:', error.message)
      console.error('   The API will still work for direct push notifications')
    }
  }, 2000) // Wait 2 seconds before setting up realtime
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully')
  if (notificationsChannel) supabase.removeChannel(notificationsChannel)
  if (chatMessagesChannel) supabase.removeChannel(chatMessagesChannel)
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully')
  if (notificationsChannel) supabase.removeChannel(notificationsChannel)
  if (chatMessagesChannel) supabase.removeChannel(chatMessagesChannel)
  process.exit(0)
})

// Export for testing
export {
  sendPushNotification,
  notifyNewMessage,
  notifyAppNotification
}
