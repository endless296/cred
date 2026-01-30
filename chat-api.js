// backend/chat-api.js
import express from 'express'
import cors from 'cors'
import mysql from 'mysql2/promise'

const app = express()

// Environment variables with fallbacks
const config = {
  TIDB_HOST: process.env.TIDB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
  TIDB_USER: process.env.TIDB_USER || '2SHYvufPPw5WRu3.root',
  TIDB_PASSWORD: process.env.TIDB_PASSWORD || 'VnSJyZS7gWFwFP23',
  TIDB_DATABASE: process.env.TIDB_DATABASE || 'test',
  PORT: process.env.PORT || 8080,
  NODE_ENV: process.env.NODE_ENV || 'production',
  PUSH_API_URL: process.env.PUSH_API_URL || 'https://octopus-push-api-production-677b.up.railway.app',
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://hqrsymjlycynalfgkefx.supabase.co',
  SUPABASE_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxcnN5bWpseWN5bmFsZmdrZWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5OTY1MDAsImV4cCI6MjA4MDU3MjUwMH0.2_o7PG-qQkYaFJSmGuvZFPi2nwQ7ERwaP5RE0fWuwWw'
}

const isDev = config.NODE_ENV !== 'production'

// CORS - allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// TiDB Connection Pool
const pool = mysql.createPool({
  host: config.TIDB_HOST.replace('-privatelink', ''),
  port: 4000,
  user: config.TIDB_USER,
  password: config.TIDB_PASSWORD,
  database: config.TIDB_DATABASE,
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: false
  },
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  connectTimeout: 10000
})

// Test database connection on startup
pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully')
    connection.release()
  })
  .catch(err => {
    console.error('⚠️ Database connection failed:', err.message)
  })

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1')
    res.json({ 
      status: 'ok', 
      service: 'octopus-chat-api',
      database: 'connected',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      service: 'octopus-chat-api', 
      database: 'disconnected',
      error: error.message 
    })
  }
})

// Get messages between two users
app.get('/api/messages', async (req, res) => {
  const { user1, user2, limit = 50, offset = 0 } = req.query

  if (!user1 || !user2) {
    return res.status(400).json({ error: 'user1 and user2 required' })
  }

  try {
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 50), 1000)
    const offsetNum = Math.max(0, parseInt(offset) || 0)

    const [rows] = await pool.execute(
      `SELECT * FROM chat_messages 
       WHERE (sender_id = ? AND receiver_id = ?) 
          OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at DESC
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      [user1, user2, user2, user1]
    )

    res.json({ messages: rows.reverse() })
  } catch (error) {
    console.error('Error fetching messages:', error.message)
    res.status(500).json({ error: 'Failed to fetch messages', details: isDev ? error.message : undefined })
  }
})

// Send a message
app.post('/api/messages', async (req, res) => {
  const { sender_id, receiver_id, message, photo, reply_to_id } = req.body

  if (!sender_id || !receiver_id) {
    return res.status(400).json({ error: 'sender_id and receiver_id required' })
  }

  if (!message && !photo) {
    return res.status(400).json({ error: 'message or photo required' })
  }

  try {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const created_at = new Date().toISOString()

    await pool.execute(
      `INSERT INTO chat_messages (id, sender_id, receiver_id, message, photo, reply_to_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, sender_id, receiver_id, message || null, photo || null, reply_to_id || null, created_at]
    )

    await updateConversation(sender_id, receiver_id, id, created_at)

    const [newMessage] = await pool.execute(
      'SELECT * FROM chat_messages WHERE id = ?',
      [id]
    )

    // Send push notification asynchronously
    sendPushNotification(sender_id, receiver_id, message, photo).catch(err => {
      console.error('❌ Push notification failed:', err.message)
    })

    res.json({ message: newMessage[0] })
  } catch (error) {
    console.error('Error sending message:', error.message)
    res.status(500).json({ error: 'Failed to send message', details: isDev ? error.message : undefined })
  }
})

// Mark messages as seen
app.patch('/api/messages/seen', async (req, res) => {
  const { message_ids, user_id } = req.body

  if (!message_ids || !Array.isArray(message_ids) || !user_id) {
    return res.status(400).json({ error: 'message_ids array and user_id required' })
  }

  try {
    const placeholders = message_ids.map(() => '?').join(',')
    await pool.execute(
      `UPDATE chat_messages 
       SET is_seen = 1, updated_at = NOW()
       WHERE id IN (${placeholders}) AND receiver_id = ?`,
      [...message_ids, user_id]
    )

    await resetUnreadCount(user_id, message_ids)

    res.json({ success: true })
  } catch (error) {
    console.error('Error marking messages as seen:', error.message)
    res.status(500).json({ error: 'Failed to mark messages as seen', details: isDev ? error.message : undefined })
  }
})

// Get conversations list
app.get('/api/conversations', async (req, res) => {
  const { user_id } = req.query

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT 
        c.*,
        m.message as last_message_text,
        m.photo as last_message_photo,
        m.created_at as last_message_time
       FROM chat_conversations c
       LEFT JOIN chat_messages m ON c.last_message_id = m.id
       WHERE c.user1_id = ? OR c.user2_id = ?
       ORDER BY c.last_message_at DESC`,
      [user_id, user_id]
    )

    const conversations = rows.map(row => {
      const isUser1 = row.user1_id === user_id
      return {
        ...row,
        other_user_id: isUser1 ? row.user2_id : row.user1_id,
        unread_count: isUser1 ? row.user1_unread_count : row.user2_unread_count
      }
    })

    res.json({ conversations })
  } catch (error) {
    console.error('Error fetching conversations:', error.message)
    res.status(500).json({ error: 'Failed to fetch conversations', details: isDev ? error.message : undefined })
  }
})

// Get unread message count
app.get('/api/messages/unread-count', async (req, res) => {
  const { user_id } = req.query

  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM chat_messages 
       WHERE receiver_id = ? AND is_seen = 0`,
      [user_id]
    )

    res.json({ count: rows[0].count })
  } catch (error) {
    console.error('Error fetching unread count:', error.message)
    res.status(500).json({ error: 'Failed to fetch unread count', details: isDev ? error.message : undefined })
  }
})

// Helper: Send push notification
async function sendPushNotification(sender_id, receiver_id, message, photo) {
  try {
    // Fetch sender info from Supabase
    const response = await fetch(`${config.SUPABASE_URL}/rest/v1/users?id=eq.${sender_id}&select=full_name,profile_photo_url`, {
      headers: {
        'apikey': config.SUPABASE_KEY,
        'Authorization': `Bearer ${config.SUPABASE_KEY}`
      }
    })
    
    const users = await response.json()
    const sender = users?.[0]

    if (!sender) {
      console.log('⚠️ Sender not found for push notification')
      return
    }

    // Get unread count
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as count FROM chat_messages WHERE receiver_id = ? AND is_seen = 0',
      [receiver_id]
    )
    const unreadCount = rows[0]?.count || 1

    // Send to push API
    await fetch(`${config.PUSH_API_URL}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: receiver_id,
        notification: {
          title: sender.full_name || 'New Message',
          body: message || '📷 Sent a photo',
          image: sender.profile_photo_url,
          type: 'message',
          userId: sender_id,
          badge: unreadCount,
          data: {
            chatWithId: sender_id,
            chatWith: sender.full_name
          }
        }
      })
    })

    console.log('✅ Push notification sent:', sender.full_name, '→', receiver_id)
  } catch (error) {
    console.error('❌ sendPushNotification error:', error.message)
  }
}

// Helper functions
async function updateConversation(sender_id, receiver_id, message_id, created_at) {
  const user1 = sender_id < receiver_id ? sender_id : receiver_id
  const user2 = sender_id < receiver_id ? receiver_id : sender_id
  const is_user1_sender = sender_id === user1

  try {
    const [existing] = await pool.execute(
      'SELECT * FROM chat_conversations WHERE user1_id = ? AND user2_id = ?',
      [user1, user2]
    )

    if (existing.length > 0) {
      await pool.execute(
        `UPDATE chat_conversations 
         SET last_message_id = ?,
             last_message_at = ?,
             user1_unread_count = user1_unread_count + ?,
             user2_unread_count = user2_unread_count + ?,
             updated_at = NOW()
         WHERE user1_id = ? AND user2_id = ?`,
        [
          message_id,
          created_at,
          is_user1_sender ? 0 : 1,
          is_user1_sender ? 1 : 0,
          user1,
          user2
        ]
      )
    } else {
      const conv_id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      await pool.execute(
        `INSERT INTO chat_conversations 
         (id, user1_id, user2_id, last_message_id, last_message_at, user1_unread_count, user2_unread_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          conv_id,
          user1,
          user2,
          message_id,
          created_at,
          is_user1_sender ? 0 : 1,
          is_user1_sender ? 1 : 0
        ]
      )
    }
  } catch (error) {
    console.error('Error updating conversation:', error.message)
  }
}

async function resetUnreadCount(user_id, message_ids) {
  try {
    const placeholders = message_ids.map(() => '?').join(',')
    const [messages] = await pool.execute(
      `SELECT DISTINCT sender_id FROM chat_messages WHERE id IN (${placeholders})`,
      message_ids
    )

    for (const msg of messages) {
      const sender_id = msg.sender_id
      const user1 = user_id < sender_id ? user_id : sender_id
      const user2 = user_id < sender_id ? sender_id : user_id
      const is_user1 = user_id === user1

      await pool.execute(
        `UPDATE chat_conversations
         SET ${is_user1 ? 'user1_unread_count' : 'user2_unread_count'} = 0,
             updated_at = NOW()
         WHERE user1_id = ? AND user2_id = ?`,
        [user1, user2]
      )
    }
  } catch (error) {
    console.error('Error resetting unread count:', error.message)
  }
}

// Start server
app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`✅ Chat API running on port ${config.PORT}`)
  console.log(`📡 Environment: ${config.NODE_ENV}`)
  console.log(`🗄️  Database: ${config.TIDB_HOST}`)
  console.log(`📱 Push API: ${config.PUSH_API_URL}`)
})

export { pool }
