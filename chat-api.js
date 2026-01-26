// backend/chat-api.js
import express from 'express'
import cors from 'cors'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const isDev = process.env.NODE_ENV !== 'production'

// Enable CORS - allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json())

// TiDB Connection Pool
const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: 4000,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'test',
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  },
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
})

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1')
    res.json({ status: 'ok', service: 'octopus-chat-api', database: 'connected' })
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
    if (isDev) console.error('Error fetching messages:', error)
    res.status(500).json({ error: 'Failed to fetch messages' })
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

    // Update conversations table
    await updateConversation(sender_id, receiver_id, id, created_at)

    const [newMessage] = await pool.execute(
      'SELECT * FROM chat_messages WHERE id = ?',
      [id]
    )

    res.json({ message: newMessage[0] })
  } catch (error) {
    if (isDev) console.error('Error sending message:', error)
    res.status(500).json({ error: 'Failed to send message' })
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
    if (isDev) console.error('Error marking messages as seen:', error)
    res.status(500).json({ error: 'Failed to mark messages as seen' })
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
    if (isDev) console.error('Error fetching conversations:', error)
    res.status(500).json({ error: 'Failed to fetch conversations' })
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
    if (isDev) console.error('Error fetching unread count:', error)
    res.status(500).json({ error: 'Failed to fetch unread count' })
  }
})

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
    if (isDev) console.error('Error updating conversation:', error)
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
    if (isDev) console.error('Error resetting unread count:', error)
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`✅ Chat API running on port ${PORT}`)
})

export { pool }
