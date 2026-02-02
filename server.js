const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Статика
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// ============================================
// 🌍 ИГРОВОЕ СОСТОЯНИЕ (Серверное)
// ============================================

const rooms = new Map();
const PLAYER_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

class GameRoom {
    constructor(code, hostId, name) {
        this.code = code;
        this.hostId = hostId;
        this.name = name || `Room ${code}`;
        this.players = new Map();
        this.zombies = new Map();
        this.wave = 1;
        this.gameStarted = false;
        this.lastFrameTime = Date.now();
        this.zombieSpawnTimer = 0;

        // Запуск игрового цикла комнаты
        this.interval = setInterval(() => this.update(), 50); // 20 обновлений в секунду
    }

    addPlayer(ws, id, name) {
        const color = PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];

        this.players.set(id, {
            ws, id, name,
            x: 0, y: 1.6, z: 0, ry: 0,
            hp: 100, kills: 0,
            color: color
        });

        this.broadcast({
            type: 'playerJoined',
            player: { id, name, color }
        });

        // Отправляем новому игроку текущее состояние комнаты
        const playerList = Array.from(this.players.values()).map(p => ({
            id: p.id, name: p.name, color: p.color, kills: p.kills
        }));

        ws.send(JSON.stringify({
            type: 'roomState',
            players: playerList,
            hostId: this.hostId,
            zombies: Array.from(this.zombies.values())
        }));
    }

    removePlayer(id) {
        this.players.delete(id);

        if (this.players.size === 0) {
            clearInterval(this.interval);
            rooms.delete(this.code);
            return;
        }

        if (id === this.hostId) {
            this.hostId = this.players.keys().next().value;
            this.broadcast({ type: 'newHost', hostId: this.hostId });
        }

        this.broadcast({ type: 'playerLeft', playerId: id });
    }

    startGame() {
        if (this.gameStarted) return;
        this.gameStarted = true;
        this.wave = 1;
        this.zombies.clear();
        this.broadcast({ type: 'gameStart', wave: 1 });
    }

    update() {
        if (!this.gameStarted) return;

        const now = Date.now();
        const dt = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        // 1. Спавн зомби
        const maxZombies = 5 + this.wave * 2;
        if (this.zombies.size < maxZombies) {
            this.zombieSpawnTimer += dt;
            if (this.zombieSpawnTimer > 2.0) { // Каждые 2 сек
                this.spawnZombie();
                this.zombieSpawnTimer = 0;
            }
        }

        // 2. Логика зомби (ИИ)
        this.zombies.forEach(zombie => {
            // Ищем ближайшего живого игрока
            let target = null;
            let minDist = Infinity;

            this.players.forEach(p => {
                if (p.hp > 0) {
                    const d = Math.sqrt((p.x - zombie.x) ** 2 + (p.z - zombie.z) ** 2);
                    if (d < minDist) {
                        minDist = d;
                        target = p;
                    }
                }
            });

            if (target) {
                // Идем к игроку
                const dx = target.x - zombie.x;
                const dz = target.z - zombie.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist > 1.5) {
                    zombie.x += (dx / dist) * zombie.speed * dt;
                    zombie.z += (dz / dist) * zombie.speed * dt;
                    zombie.ry = Math.atan2(dx, dz); // Поворот
                } else {
                    // Атака
                    if (now - zombie.lastAttack > 1000) {
                        // Урон игроку
                        const p = this.players.get(target.id);
                        if (p) {
                            p.hp -= 10;
                            zombie.lastAttack = now;

                            p.ws.send(JSON.stringify({ type: 'playerHit', hp: p.hp }));

                            if (p.hp <= 0) {
                                this.broadcast({
                                    type: 'playerDied',
                                    playerId: p.id,
                                    kills: p.kills
                                });
                                // Респавн (сброс HP)
                                p.hp = 100;
                                p.x = 0; p.z = 0; // Возврат на спавн
                            }
                        }
                    }
                }
            }
        });

        // 3. Отправка состояния мира (Snapshot)
        // Оптимизация: отправляем массивы [id, x, z, ry, hp]
        const zombieData = [];
        this.zombies.forEach((z, id) => {
            zombieData.push({ id, x: z.x, z: z.z, ry: z.ry, hp: z.hp });
        });

        const playerData = [];
        this.players.forEach((p, id) => {
            playerData.push({ id, x: p.x, z: p.z, ry: p.ry, hp: p.hp });
        });

        this.broadcast({
            type: 'worldUpdate',
            zombies: zombieData,
            players: playerData
        });
    }

    spawnZombie() {
        const id = `z_${Date.now()}_${Math.random()}`;
        const angle = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * 20; // Спавн в 20-40 метрах

        this.zombies.set(id, {
            x: Math.sin(angle) * dist,
            z: Math.cos(angle) * dist,
            ry: 0,
            hp: 100 + (this.wave * 20),
            speed: 3 + (this.wave * 0.5),
            lastAttack: 0
        });
    }

    broadcast(msg, excludeId = null) {
        const data = JSON.stringify(msg);
        this.players.forEach(p => {
            if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(data);
            }
        });
    }
}

// ============================================
// 📡 WebSocket SERVER
// ============================================

let playerIdCounter = 0;

wss.on('connection', (ws) => {
    const playerId = ++playerIdCounter;
    let currentRoom = null;
    let playerName = `Player ${playerId}`;

    console.log(`✅ Игрок #${playerId} подключился`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'setName':
                    playerName = data.name || playerName;
                    break;

                case 'createRoom':
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
                    const room = new GameRoom(code, playerId, `${playerName}'s Room`);
                    rooms.set(code, room);

                    currentRoom = room;
                    room.addPlayer(ws, playerId, playerName);

                    ws.send(JSON.stringify({
                        type: 'roomCreated',
                        room: { code: room.code, name: room.name, hostId: playerId, players: 1 }
                    }));
                    break;

                case 'getRooms':
                    const list = [];
                    rooms.forEach(r => {
                        list.push({
                            code: r.code,
                            players: r.players.size,
                            maxPlayers: 10,
                            name: r.name
                        });
                    });
                    ws.send(JSON.stringify({ type: 'roomList', rooms: list }));
                    break;

                case 'joinRoom':
                    const r = rooms.get(data.code);
                    if (r) {
                        currentRoom = r;
                        r.addPlayer(ws, playerId, playerName);

                        ws.send(JSON.stringify({
                            type: 'roomJoined',
                            room: { code: r.code, name: r.name, hostId: r.hostId, players: r.players.size }
                        }));
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена!' }));
                    }
                    break;

                case 'leaveRoom':
                    if (currentRoom) {
                        currentRoom.removePlayer(playerId);
                        currentRoom = null;
                        ws.send(JSON.stringify({ type: 'leftRoom' }));
                    }
                    break;

                case 'startGame':
                    if (currentRoom && currentRoom.hostId === playerId) {
                        currentRoom.startGame();
                    }
                    break;

                case 'position':
                    if (currentRoom) {
                        const p = currentRoom.players.get(playerId);
                        if (p) {
                            p.x = data.x;
                            p.y = data.y;
                            p.z = data.z;
                            p.ry = data.ry;
                        }
                    }
                    break;

                case 'shoot':
                    if (currentRoom) {
                        currentRoom.broadcast({
                            type: 'playerShoot',
                            playerId: playerId,
                            pos: data.pos,
                            dir: data.dir
                        }, playerId);
                    }
                    break;

                case 'zombieHit':
                    if (currentRoom) {
                        const z = currentRoom.zombies.get(data.id);
                        if (z) {
                            z.hp -= data.damage;
                            // Броадкастим всем, что зомби получил урон (для частиц и HP баров)
                            /* Оптимизация: HP обновится в next worldUpdate */

                            if (z.hp <= 0) {
                                currentRoom.zombies.delete(data.id);
                                const p = currentRoom.players.get(playerId);
                                if (p) {
                                    p.kills++;
                                    currentRoom.broadcast({ type: 'zombieKilled', zombieId: data.id, killerId: playerId });
                                }
                            }
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });

    ws.on('close', () => {
        if (currentRoom) {
            currentRoom.removePlayer(playerId);
        }
    });

    ws.on('error', (e) => {
        console.error('Ошибка WS:', e);
    });
});

// REST API
app.get('/api/rooms', (req, res) => {
    const list = [];
    rooms.forEach(r => {
        list.push({
            code: r.code,
            players: r.players.size,
            maxPlayers: 10,
            name: r.name
        });
    });
    res.json(list);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
