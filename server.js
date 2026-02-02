/* ============================================
   🖥️ ZOMBIE VS PLAYER - Мультиплеер Сервер
   С системой комнат и браузером серверов
   ============================================ */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(path.join(__dirname)));

// ============================================
// 📦 ХРАНИЛИЩЕ ДАННЫХ
// ============================================

const rooms = new Map();           // Комнаты
const players = new Map();         // Все игроки
let playerIdCounter = 0;

// Цвета для игроков
const PLAYER_COLORS = [
    '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
    '#9C27B0', '#00BCD4', '#FFEB3B', '#795548',
    '#FF5722', '#607D8B', '#8BC34A', '#3F51B5'
];

// ============================================
// 🏠 ФУНКЦИИ КОМНАТ
// ============================================

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function createRoom(hostId, hostName) {
    let code;
    do {
        code = generateRoomCode();
    } while (rooms.has(code));

    const room = {
        code: code,
        name: `${hostName}'s Room`,
        hostId: hostId,
        players: new Map(),
        gameStarted: false,
        wave: 1,
        zombies: [],
        createdAt: Date.now()
    };

    rooms.set(code, room);
    console.log(`🏠 Комната ${code} создана игроком #${hostId}`);
    return room;
}

function joinRoom(playerId, roomCode) {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) return { success: false, error: 'Комната не найдена' };
    if (room.players.size >= 8) return { success: false, error: 'Комната заполнена' };
    if (room.gameStarted) return { success: false, error: 'Игра уже началась' };

    const player = players.get(playerId);
    if (!player) return { success: false, error: 'Игрок не найден' };

    // Удаляем из предыдущей комнаты
    if (player.roomCode) {
        leaveRoom(playerId);
    }

    player.roomCode = room.code;
    room.players.set(playerId, player.data);

    console.log(`👤 Игрок #${playerId} вошёл в комнату ${room.code}`);
    return { success: true, room: room };
}

function leaveRoom(playerId) {
    const player = players.get(playerId);
    if (!player || !player.roomCode) return;

    const room = rooms.get(player.roomCode);
    if (!room) return;

    room.players.delete(playerId);
    player.roomCode = null;

    // Если комната пуста - удаляем
    if (room.players.size === 0) {
        rooms.delete(room.code);
        console.log(`🗑️ Комната ${room.code} удалена (пуста)`);
    }
    // Если ушёл хост - назначаем нового
    else if (room.hostId === playerId) {
        const newHostId = room.players.keys().next().value;
        room.hostId = newHostId;
        room.name = `${room.players.get(newHostId).name}'s Room`;

        // Уведомляем о новом хосте
        broadcastToRoom(room.code, {
            type: 'newHost',
            hostId: newHostId
        });
    }

    // Уведомляем остальных
    broadcastToRoom(room.code, {
        type: 'playerLeft',
        playerId: playerId
    });
}

function getRoomList() {
    const list = [];
    rooms.forEach((room, code) => {
        if (!room.gameStarted) {
            list.push({
                code: code,
                name: room.name,
                players: room.players.size,
                maxPlayers: 8,
                wave: room.wave
            });
        }
    });
    return list;
}

// ============================================
// 📡 ВЕБСОКЕТ ОБРАБОТЧИКИ
// ============================================

console.log('🧟 Zombie VS Player Server');
console.log('==========================');

wss.on('connection', (ws) => {
    const playerId = ++playerIdCounter;
    const playerColor = PLAYER_COLORS[playerId % PLAYER_COLORS.length];

    console.log(`✅ Игрок #${playerId} подключился`);

    // Создаём игрока
    const playerData = {
        id: playerId,
        name: `Игрок ${playerId}`,
        color: playerColor,
        x: 1500,
        y: 1500,
        angle: 0,
        hp: 100,
        kills: 0
    };

    players.set(playerId, {
        ws,
        data: playerData,
        roomCode: null
    });

    // Отправляем инициализацию
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        color: playerColor
    }));

    // Обработка сообщений
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(playerId, data);
        } catch (e) {
            console.error('Ошибка парсинга:', e);
        }
    });

    // Отключение
    ws.on('close', () => {
        console.log(`❌ Игрок #${playerId} отключился`);
        leaveRoom(playerId);
        players.delete(playerId);
    });

    ws.on('error', (error) => {
        console.error(`Ошибка у игрока #${playerId}:`, error.message);
    });
});

function handleMessage(playerId, data) {
    const player = players.get(playerId);
    if (!player) return;

    switch (data.type) {
        // ============ МЕНЮ ============

        case 'setName':
            player.data.name = data.name.substring(0, 15) || `Игрок ${playerId}`;
            break;

        case 'getRooms':
            player.ws.send(JSON.stringify({
                type: 'roomList',
                rooms: getRoomList()
            }));
            break;

        case 'createRoom':
            const newRoom = createRoom(playerId, player.data.name);
            joinRoom(playerId, newRoom.code);

            player.ws.send(JSON.stringify({
                type: 'roomCreated',
                room: {
                    code: newRoom.code,
                    name: newRoom.name,
                    hostId: newRoom.hostId,
                    players: Array.from(newRoom.players.values())
                }
            }));
            break;

        case 'joinRoom':
            const result = joinRoom(playerId, data.code);

            if (result.success) {
                // Отправляем игроку данные комнаты
                player.ws.send(JSON.stringify({
                    type: 'roomJoined',
                    room: {
                        code: result.room.code,
                        name: result.room.name,
                        hostId: result.room.hostId,
                        players: Array.from(result.room.players.values())
                    }
                }));

                // Уведомляем остальных в комнате
                broadcastToRoom(result.room.code, {
                    type: 'playerJoined',
                    player: player.data
                }, playerId);
            } else {
                player.ws.send(JSON.stringify({
                    type: 'error',
                    message: result.error
                }));
            }
            break;

        case 'leaveRoom':
            leaveRoom(playerId);
            player.ws.send(JSON.stringify({
                type: 'leftRoom'
            }));
            break;

        case 'startGame':
            if (!player.roomCode) break;
            const room = rooms.get(player.roomCode);
            if (!room || room.hostId !== playerId) break;

            room.gameStarted = true;

            // Назначаем позиции игрокам
            let i = 0;
            room.players.forEach((p, id) => {
                const angle = (i / room.players.size) * Math.PI * 2;
                p.x = 1500 + Math.cos(angle) * 100;
                p.y = 1500 + Math.sin(angle) * 100;
                p.hp = 100;
                p.kills = 0;
                i++;
            });

            broadcastToRoom(room.code, {
                type: 'gameStart',
                players: Array.from(room.players.values())
            });

            console.log(`🎮 Игра началась в комнате ${room.code}`);
            break;

        // ============ ИГРА ============

        case 'position':
            if (!player.roomCode) break;
            player.data.x = data.x;
            player.data.y = data.y;
            player.data.angle = data.angle;

            broadcastToRoom(player.roomCode, {
                type: 'playerMove',
                playerId: playerId,
                x: data.x,
                y: data.y,
                angle: data.angle
            }, playerId);
            break;

        case 'shoot':
            if (!player.roomCode) break;
            broadcastToRoom(player.roomCode, {
                type: 'playerShoot',
                playerId: playerId,
                x: data.x,
                y: data.y,
                angle: data.angle
            }, playerId);
            break;

        case 'zombieKill':
            if (!player.roomCode) break;
            player.data.kills = (player.data.kills || 0) + 1;

            broadcastToRoom(player.roomCode, {
                type: 'zombieKilled',
                playerId: playerId,
                zombieId: data.zombieId,
                kills: player.data.kills
            });
            break;

        case 'playerHit':
            if (!player.roomCode) break;
            player.data.hp = data.hp;

            broadcastToRoom(player.roomCode, {
                type: 'playerHit',
                playerId: playerId,
                hp: data.hp
            }, playerId);
            break;

        case 'playerDeath':
            if (!player.roomCode) break;
            broadcastToRoom(player.roomCode, {
                type: 'playerDied',
                playerId: playerId,
                kills: player.data.kills
            });
            break;

        case 'newWave':
            if (!player.roomCode) break;
            const gameRoom = rooms.get(player.roomCode);
            if (!gameRoom || gameRoom.hostId !== playerId) break;

            gameRoom.wave = data.wave;
            broadcastToRoom(player.roomCode, {
                type: 'waveStart',
                wave: data.wave
            });
            break;
    }
}

function broadcastToRoom(roomCode, message, excludeId = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const data = JSON.stringify(message);

    room.players.forEach((playerData, id) => {
        if (id !== excludeId) {
            const player = players.get(id);
            if (player && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(data);
            }
        }
    });
}

// ============================================
// 🌐 REST API
// ============================================

// Список комнат для браузера
app.get('/api/rooms', (req, res) => {
    res.json(getRoomList());
});

// Информация о сервере
app.get('/api/info', (req, res) => {
    res.json({
        name: 'Zombie VS Player Server',
        players: players.size,
        rooms: rooms.size,
        version: '2.0'
    });
});

// ============================================
// 🚀 ЗАПУСК
// ============================================

server.listen(PORT, () => {
    console.log(`\n🎮 Сервер запущен!`);
    console.log(`📍 Локальный: http://localhost:${PORT}`);
    console.log(`🌐 Для друзей: http://<ваш-IP>:${PORT}`);
    console.log(`\n💡 Узнай свой IP командой: ipconfig`);
    console.log(`\n⏳ Ожидание игроков...\n`);
});
