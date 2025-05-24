import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import {
    GameState,
    RoomData,
    PlayerData,
    GameStats,
    ChatMessage,
    Vector3D
} from './types/game';
import {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData
} from './types/socket';

const app = express();
const server = createServer(app);
const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Game state
const gameState: GameState = {
    players: new Map<string, PlayerData>(),
    rooms: new Map<string, RoomData>(),
    maxPlayersPerRoom: 8
};

// Utility functions
function generateRoomId(): string {
    return Math.random().toString(36).substr(2, 9);
}

function findAvailableRoom(): string {
    for (const [roomId, room] of gameState.rooms) {
        if (room.players.size < gameState.maxPlayersPerRoom) {
            return roomId;
        }
    }

    // Create new room if none available
    const newRoomId = generateRoomId();
    const newRoom: RoomData = {
        id: newRoomId,
        players: new Map<string, PlayerData>(),
        createdAt: Date.now(),
        maxPlayers: gameState.maxPlayersPerRoom
    };

    gameState.rooms.set(newRoomId, newRoom);
    return newRoomId;
}

function getRandomSpawnPosition(roomId: string): Vector3D {
    const room = gameState.rooms.get(roomId);
    const playerCount = room ? room.players.size : 0;

    // Spawn players in a grid pattern
    const gridSize = Math.ceil(Math.sqrt(gameState.maxPlayersPerRoom));
    const spacing = 10;
    const x = (playerCount % gridSize) * spacing - (gridSize * spacing) / 2;
    const z = Math.floor(playerCount / gridSize) * spacing - 20;

    return { x, y: 0, z };
}

function validatePlayerName(name: string): string {
    if (!name || typeof name !== 'string') {
        throw new Error('Invalid player name');
    }

    return name.trim().substring(0, 20) || `Player_${Date.now()}`;
}

function validateMessage(message: string): string {
    if (!message || typeof message !== 'string') {
        throw new Error('Invalid message');
    }

    return message.trim().substring(0, 200);
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.get('/api/stats', (req, res) => {
    const stats: GameStats = {
        totalPlayers: gameState.players.size,
        totalRooms: gameState.rooms.size,
        rooms: Array.from(gameState.rooms.values()).map(room => ({
            id: room.id,
            playerCount: room.players.size,
            players: Array.from(room.players.values()).map(p => p.name)
        }))
    };
    res.json(stats);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('join', (playerData) => {
        try {
            const playerName = validatePlayerName(playerData.name);
            const roomId = findAvailableRoom();
            const room = gameState.rooms.get(roomId);

            if (!room) {
                throw new Error('Failed to create or find room');
            }

            const spawnPosition = getRandomSpawnPosition(roomId);

            const player: PlayerData = {
                id: socket.id,
                name: playerName,
                roomId: roomId,
                position: spawnPosition,
                rotation: { x: 0, y: 0, z: 0 },
                velocity: { x: 0, y: 0, z: 0 },
                joinedAt: Date.now(),
                lastUpdate: Date.now()
            };

            // Add to game state
            gameState.players.set(socket.id, player);
            room.players.set(socket.id, player);

            // Join socket room
            void socket.join(roomId);

            // Store socket data
            socket.data.playerId = socket.id;
            socket.data.roomId = roomId;

            console.log(`Player ${player.name} joined room ${roomId}`);

            // Send join confirmation
            socket.emit('joined', {
                player: player,
                room: {
                    id: roomId,
                    players: Array.from(room.players.values())
                }
            });

            // Notify other players
            socket.to(roomId).emit('playerJoined', player);

        } catch (error) {
            console.error('Error handling join:', error);
            socket.emit('error', {
                message: error instanceof Error ? error.message : 'Failed to join game'
            });
        }
    });

    socket.on('updatePosition', (data) => {
        try {
            const player = gameState.players.get(socket.id);
            if (!player) return;

            // Validate position data
            if (!data.position || !data.rotation || !data.velocity) {
                return;
            }

            // Update player state
            player.position = data.position;
            player.rotation = data.rotation;
            player.velocity = data.velocity;
            player.lastUpdate = Date.now();

            // Broadcast to other players in the same room
            socket.to(player.roomId).emit('playerUpdate', {
                id: socket.id,
                position: data.position,
                rotation: data.rotation,
                velocity: data.velocity
            });

        } catch (error) {
            console.error('Error handling position update:', error);
        }
    });

    socket.on('chatMessage', (data) => {
        try {
            const player = gameState.players.get(socket.id);
            if (!player) return;

            const messageText = validateMessage(data.message);

            const message: ChatMessage = {
                id: Date.now(),
                playerId: socket.id,
                playerName: player.name,
                message: messageText,
                timestamp: Date.now()
            };

            // Broadcast to room
            io.to(player.roomId).emit('chatMessage', message);

        } catch (error) {
            console.error('Error handling chat message:', error);
        }
    });

    socket.on('disconnect', () => {
        try {
            const player = gameState.players.get(socket.id);
            if (player) {
                const room = gameState.rooms.get(player.roomId);

                // Remove from room
                if (room) {
                    room.players.delete(socket.id);

                    // Remove empty rooms
                    if (room.players.size === 0) {
                        gameState.rooms.delete(player.roomId);
                        console.log(`Removed empty room: ${player.roomId}`);
                    } else {
                        // Notify other players
                        socket.to(player.roomId).emit('playerLeft', socket.id);
                    }
                }

                // Remove from global players
                gameState.players.delete(socket.id);

                console.log(`Player ${player.name} disconnected from room ${player.roomId}`);
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
});

// Cleanup inactive rooms periodically
setInterval(() => {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [roomId, room] of gameState.rooms) {
        if (room.players.size === 0 && (now - room.createdAt) > maxAge) {
            gameState.rooms.delete(roomId);
            console.log(`Cleaned up old empty room: ${roomId}`);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Start server
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

server.listen(PORT, () => {
    console.log(`🚗 Multiplayer Car Game Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} to play`);
    console.log(`📊 Stats API available at http://localhost:${PORT}/api/stats`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
        console.log('✅ Server closed');
        process.exit(0);
});

export default app;
