import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import path from 'node:path'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })
const port = Number(process.env.PORT ?? 3001)

app.use(express.json())
app.get('/health', (_request, response) => response.json({ status: 'online', service: '0ch.net messenger' }))
app.get('/api/ice-servers', (_request, response) => response.json({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }] : []),
  ],
}))

io.on('connection', (socket) => {
  socket.on('join-room', (roomId: string, user: { name: string }) => {
    socket.join(roomId)
    socket.to(roomId).emit('user-joined', { id: socket.id, ...user })
    socket.on('disconnect', () => socket.to(roomId).emit('user-left', { id: socket.id }))
  })
  socket.on('signal', ({ target, signal }) => io.to(target).emit('signal', { sender: socket.id, signal }))
  socket.on('chat-message', (message) => socket.broadcast.emit('chat-message', message))
})

const distPath = path.resolve(process.cwd(), 'dist')
app.use(express.static(distPath))
app.get('*', (_request, response) => response.sendFile(path.join(distPath, 'index.html')))
httpServer.listen(port, () => console.log(`0ch.net server listening on ${port}`))
