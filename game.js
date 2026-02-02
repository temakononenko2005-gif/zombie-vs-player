/* ============================================
   🎮 ZOMBIE VS PLAYER - Игровая Логика
   С поддержкой комнат и браузера серверов
   ============================================ */

// Конфигурация
const CONFIG = {
    // Игрок
    playerSpeed: 5,
    playerSize: 40,
    playerHP: 100,

    // Пули
    bulletSpeed: 12,
    bulletSize: 8,
    bulletDamage: 25,
    fireRate: 150,

    // Зомби
    zombieBaseSpeed: 1.5,
    zombieBaseHP: 50,
    zombieSize: 45,
    zombieDamage: 10,
    zombieSpawnRate: 2000,

    // Волны
    zombiesPerWave: 5,
    waveMultiplier: 1.3,
};

// ============================================
// 🌍 ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================

let canvas, ctx;
let gameRunning = false;
let gameMode = 'menu'; // menu, lobby, game
let isMultiplayer = false;
let isSoloMode = false;

// Игроки
let player = null;
let otherPlayers = new Map();
let myPlayerId = null;
let myColor = '#4CAF50';

// Игровые объекты
let zombies = [];
let bullets = [];
let particles = [];

// Статистика
let kills = 0;
let wave = 1;
let zombiesInWave = 0;
let zombiesKilledInWave = 0;

// Управление
let lastFireTime = 0;
let mouseX = 0, mouseY = 0;
let keys = {};
let mouseDown = false;

// Камера
let camera = { x: 0, y: 0 };

// Мир
const WORLD = { width: 3000, height: 3000 };

// WebSocket
let ws = null;
let currentRoom = null;
let isHost = false;

// Трава
let grassTiles = [];

// ============================================
// 🎨 ЦВЕТА
// ============================================

const COLORS = {
    player: ['#4CAF50', '#45a049', '#388E3C'],
    zombie: [
        { body: '#7CB342', dark: '#558B2F', eyes: '#F44336' },
        { body: '#5C6BC0', dark: '#3949AB', eyes: '#FF5722' },
        { body: '#AB47BC', dark: '#7B1FA2', eyes: '#FFEB3B' },
        { body: '#EF5350', dark: '#C62828', eyes: '#00E676' },
    ],
    bullet: '#FFEB3B',
    grass: ['#4CAF50', '#66BB6A', '#43A047', '#2E7D32', '#388E3C'],
    flowers: ['#E91E63', '#FF9800', '#FFEB3B', '#9C27B0', '#03A9F4'],
    blood: ['#e94560', '#c62828', '#d32f2f'],
};

// ============================================
// 🌿 КЛАСС ТРАВЫ
// ============================================

class GrassTile {
    constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.grassBlades = [];
        this.flowers = [];

        for (let i = 0; i < 8; i++) {
            this.grassBlades.push({
                x: Math.random() * size,
                y: Math.random() * size,
                height: 10 + Math.random() * 15,
                color: COLORS.grass[Math.floor(Math.random() * COLORS.grass.length)],
                sway: Math.random() * Math.PI * 2
            });
        }

        if (Math.random() < 0.15) {
            this.flowers.push({
                x: Math.random() * size,
                y: Math.random() * size,
                color: COLORS.flowers[Math.floor(Math.random() * COLORS.flowers.length)],
                size: 4 + Math.random() * 4
            });
        }
    }

    draw(ctx, time) {
        const screenX = this.x - camera.x;
        const screenY = this.y - camera.y;

        if (screenX + this.size < 0 || screenX > canvas.width ||
            screenY + this.size < 0 || screenY > canvas.height) return;

        this.grassBlades.forEach(blade => {
            const sway = Math.sin(time * 0.002 + blade.sway) * 3;
            ctx.strokeStyle = blade.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(screenX + blade.x, screenY + blade.y);
            ctx.quadraticCurveTo(
                screenX + blade.x + sway,
                screenY + blade.y - blade.height * 0.6,
                screenX + blade.x + sway * 1.5,
                screenY + blade.y - blade.height
            );
            ctx.stroke();
        });

        this.flowers.forEach(flower => {
            ctx.fillStyle = flower.color;
            ctx.beginPath();
            ctx.arc(screenX + flower.x, screenY + flower.y, flower.size, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FFEB3B';
            ctx.beginPath();
            ctx.arc(screenX + flower.x, screenY + flower.y, flower.size * 0.4, 0, Math.PI * 2);
            ctx.fill();
        });
    }
}

function generateGrass() {
    grassTiles = [];
    const tileSize = 80;
    for (let x = 0; x < WORLD.width; x += tileSize) {
        for (let y = 0; y < WORLD.height; y += tileSize) {
            grassTiles.push(new GrassTile(x, y, tileSize));
        }
    }
}

// ============================================
// 👤 КЛАСС ИГРОКА
// ============================================

class Player {
    constructor(x, y, name, color, isLocal = true) {
        this.x = x;
        this.y = y;
        this.name = name;
        this.color = color;
        this.size = CONFIG.playerSize;
        this.hp = CONFIG.playerHP;
        this.maxHP = CONFIG.playerHP;
        this.angle = 0;
        this.isLocal = isLocal;
        this.invincible = 0;
        this.kills = 0;
    }

    update() {
        if (!this.isLocal) return;

        let dx = 0, dy = 0;
        if (keys['w'] || keys['ц'] || keys['W'] || keys['Ц']) dy -= CONFIG.playerSpeed;
        if (keys['s'] || keys['ы'] || keys['S'] || keys['Ы']) dy += CONFIG.playerSpeed;
        if (keys['a'] || keys['ф'] || keys['A'] || keys['Ф']) dx -= CONFIG.playerSpeed;
        if (keys['d'] || keys['в'] || keys['D'] || keys['В']) dx += CONFIG.playerSpeed;

        if (dx !== 0 && dy !== 0) {
            dx *= 0.707;
            dy *= 0.707;
        }

        this.x += dx;
        this.y += dy;

        this.x = Math.max(this.size, Math.min(WORLD.width - this.size, this.x));
        this.y = Math.max(this.size, Math.min(WORLD.height - this.size, this.y));

        const worldMouseX = mouseX + camera.x;
        const worldMouseY = mouseY + camera.y;
        this.angle = Math.atan2(worldMouseY - this.y, worldMouseX - this.x);

        if (this.invincible > 0) this.invincible--;

        // Отправка позиции на сервер
        if (isMultiplayer && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'position',
                x: this.x,
                y: this.y,
                angle: this.angle
            }));
        }
    }

    draw(ctx) {
        const screenX = this.x - camera.x;
        const screenY = this.y - camera.y;

        ctx.save();
        ctx.translate(screenX, screenY);

        if (this.invincible > 0 && Math.floor(this.invincible / 5) % 2 === 0) {
            ctx.globalAlpha = 0.5;
        }

        // Тень
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, this.size * 0.4, this.size * 0.6, this.size * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.rotate(this.angle);

        // Тело
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Оружие
        ctx.fillStyle = '#555';
        ctx.fillRect(this.size * 0.3, -5, this.size * 0.5, 10);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(this.size * 0.3, -5, this.size * 0.5, 10);

        ctx.restore();

        // Имя
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Russo One';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, screenX, screenY - this.size * 0.8);

        // HP бар
        const hpWidth = 50;
        const hpHeight = 6;
        const hpX = screenX - hpWidth / 2;
        const hpY = screenY - this.size * 0.65;

        ctx.fillStyle = '#333';
        ctx.fillRect(hpX - 1, hpY - 1, hpWidth + 2, hpHeight + 2);

        ctx.fillStyle = this.hp > 30 ? '#4CAF50' : '#e94560';
        ctx.fillRect(hpX, hpY, (this.hp / this.maxHP) * hpWidth, hpHeight);
    }

    takeDamage(damage) {
        if (this.invincible > 0) return;

        this.hp -= damage;
        this.invincible = 30;

        for (let i = 0; i < 5; i++) {
            particles.push(new Particle(this.x, this.y, '#e94560'));
        }

        if (isMultiplayer && ws) {
            ws.send(JSON.stringify({
                type: 'playerHit',
                hp: this.hp
            }));
        }

        if (this.hp <= 0) {
            if (isMultiplayer && ws) {
                ws.send(JSON.stringify({
                    type: 'playerDeath',
                    kills: kills
                }));
            }
            gameOver();
        }

        updateUI();
    }
}

// ============================================
// 🧟 КЛАСС ЗОМБИ
// ============================================

class Zombie {
    constructor(x, y, wave, id = null) {
        this.id = id || `z_${Date.now()}_${Math.random()}`;
        this.x = x;
        this.y = y;
        this.size = CONFIG.zombieSize + Math.random() * 10;

        const multiplier = Math.pow(CONFIG.waveMultiplier, wave - 1);
        this.speed = CONFIG.zombieBaseSpeed * (0.8 + Math.random() * 0.4) * Math.min(multiplier, 3);
        this.maxHP = Math.floor(CONFIG.zombieBaseHP * multiplier);
        this.hp = this.maxHP;
        this.damage = Math.floor(CONFIG.zombieDamage * Math.min(multiplier, 2));

        this.colorScheme = COLORS.zombie[Math.floor(Math.random() * COLORS.zombie.length)];
        this.angle = 0;
        this.wobble = Math.random() * Math.PI * 2;
        this.attackCooldown = 0;
    }

    update() {
        // Находим ближайшего игрока
        let target = player;
        let minDist = Infinity;

        if (player) {
            minDist = Math.sqrt((player.x - this.x) ** 2 + (player.y - this.y) ** 2);
        }

        otherPlayers.forEach(p => {
            const dist = Math.sqrt((p.x - this.x) ** 2 + (p.y - this.y) ** 2);
            if (dist < minDist) {
                minDist = dist;
                target = p;
            }
        });

        if (!target) return;

        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        this.angle = Math.atan2(dy, dx);
        this.wobble += 0.15;

        if (dist > this.size) {
            this.x += (dx / dist) * this.speed + Math.cos(this.wobble) * 0.5;
            this.y += (dy / dist) * this.speed;
        }

        // Атака только локального игрока
        if (player && dist < this.size + player.size * 0.5 && this.attackCooldown <= 0) {
            const playerDist = Math.sqrt((player.x - this.x) ** 2 + (player.y - this.y) ** 2);
            if (playerDist < this.size + player.size * 0.5) {
                player.takeDamage(this.damage);
                this.attackCooldown = 60;
            }
        }

        if (this.attackCooldown > 0) this.attackCooldown--;
    }

    draw(ctx) {
        const screenX = this.x - camera.x;
        const screenY = this.y - camera.y;

        if (screenX < -100 || screenX > canvas.width + 100 ||
            screenY < -100 || screenY > canvas.height + 100) return;

        ctx.save();
        ctx.translate(screenX, screenY);

        // Тень
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, this.size * 0.4, this.size * 0.5, this.size * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();

        const wobble = Math.sin(this.wobble) * 0.1;
        ctx.rotate(this.angle + wobble);

        // Тело
        ctx.fillStyle = this.colorScheme.body;
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.colorScheme.dark;
        ctx.beginPath();
        ctx.arc(this.size * 0.1, this.size * 0.1, this.size * 0.35, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        // Глаза
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-8, -5, 8, 0, Math.PI * 2);
        ctx.arc(8, -5, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.colorScheme.eyes;
        ctx.beginPath();
        ctx.arc(-6, -5, 4, 0, Math.PI * 2);
        ctx.arc(10, -5, 4, 0, Math.PI * 2);
        ctx.fill();

        // Рот
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(0, 8, 10, 0, Math.PI);
        ctx.fill();

        ctx.fillStyle = '#fff';
        for (let i = -8; i <= 8; i += 4) {
            ctx.fillRect(i, 8, 3, 5);
        }

        ctx.restore();

        // HP бар
        this.drawHPBar(ctx, screenX, screenY);
    }

    drawHPBar(ctx, screenX, screenY) {
        const barWidth = 50;
        const barHeight = 8;
        const barX = screenX - barWidth / 2;
        const barY = screenY - this.size * 0.7 - 15;

        ctx.fillStyle = '#333';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4, 4);
        ctx.fill();
        ctx.stroke();

        const hpPercent = this.hp / this.maxHP;
        let hpColor;

        if (hpPercent > 0.6) hpColor = '#4CAF50';
        else if (hpPercent > 0.3) hpColor = '#FF9800';
        else hpColor = '#e94560';

        const gradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
        gradient.addColorStop(0, hpColor);
        gradient.addColorStop(1, adjustColor(hpColor, -30));

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth * hpPercent, barHeight, 3);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight / 2);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Russo One';
        ctx.textAlign = 'center';
        ctx.fillText(`${this.hp}/${this.maxHP}`, screenX, barY + barHeight - 1);
    }

    takeDamage(damage) {
        this.hp -= damage;

        for (let i = 0; i < 8; i++) {
            particles.push(new Particle(this.x, this.y, COLORS.blood[Math.floor(Math.random() * COLORS.blood.length)]));
        }

        return this.hp <= 0;
    }
}

// ============================================
// 💥 КЛАСС ПУЛИ
// ============================================

class Bullet {
    constructor(x, y, angle, ownerId = null) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.speed = CONFIG.bulletSpeed;
        this.size = CONFIG.bulletSize;
        this.damage = CONFIG.bulletDamage;
        this.trail = [];
        this.ownerId = ownerId || myPlayerId;
    }

    update() {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 5) this.trail.shift();

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        return this.x < 0 || this.x > WORLD.width || this.y < 0 || this.y > WORLD.height;
    }

    draw(ctx) {
        const screenX = this.x - camera.x;
        const screenY = this.y - camera.y;

        this.trail.forEach((pos, i) => {
            const alpha = i / this.trail.length * 0.5;
            const trailX = pos.x - camera.x;
            const trailY = pos.y - camera.y;

            ctx.fillStyle = `rgba(255, 235, 59, ${alpha})`;
            ctx.beginPath();
            ctx.arc(trailX, trailY, this.size * 0.5, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.fillStyle = COLORS.bullet;
        ctx.shadowColor = COLORS.bullet;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ============================================
// ✨ КЛАСС ЧАСТИЦ
// ============================================

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = 3 + Math.random() * 5;
        this.speedX = (Math.random() - 0.5) * 8;
        this.speedY = (Math.random() - 0.5) * 8;
        this.gravity = 0.2;
        this.life = 1;
        this.decay = 0.02 + Math.random() * 0.02;
    }

    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.speedY += this.gravity;
        this.life -= this.decay;
        return this.life <= 0;
    }

    draw(ctx) {
        const screenX = this.x - camera.x;
        const screenY = this.y - camera.y;

        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.size * this.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// ============================================
// 🌐 СЕТЕВЫЕ ФУНКЦИИ
// ============================================

function connectToServer(address = null) {
    const serverAddress = address || window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = address ? `ws://${address}` : `${protocol}//${serverAddress}`;

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('✅ Подключено к серверу');
            showNotification('Подключено к серверу!', 'success');

            // Отправляем имя
            const name = document.getElementById('playerName').value.trim() || 'Игрок';
            ws.send(JSON.stringify({ type: 'setName', name: name }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };

        ws.onclose = () => {
            console.log('❌ Отключено от сервера');
            if (gameMode !== 'menu') {
                showNotification('Соединение потеряно', 'error');
            }
        };

        ws.onerror = (error) => {
            console.error('Ошибка WebSocket:', error);
            showNotification('Ошибка подключения', 'error');
        };

    } catch (e) {
        console.error('Не удалось подключиться:', e);
        showNotification('Не удалось подключиться к серверу', 'error');
    }
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'init':
            myPlayerId = data.playerId;
            myColor = data.color;
            break;

        case 'roomList':
            displayRoomList(data.rooms);
            break;

        case 'roomCreated':
        case 'roomJoined':
            currentRoom = data.room;
            isHost = data.room.hostId === myPlayerId;
            showLobby(data.room);
            break;

        case 'playerJoined':
            if (currentRoom) {
                currentRoom.players.push(data.player);
                updateLobbyPlayers();
            }
            break;

        case 'playerLeft':
            if (currentRoom) {
                currentRoom.players = currentRoom.players.filter(p => p.id !== data.playerId);
                updateLobbyPlayers();
            }
            if (gameRunning) {
                otherPlayers.delete(data.playerId);
                updatePlayersListUI();
            }
            break;

        case 'newHost':
            if (currentRoom) {
                currentRoom.hostId = data.hostId;
                isHost = data.hostId === myPlayerId;
                updateLobbyPlayers();
            }
            break;

        case 'leftRoom':
            currentRoom = null;
            showMainMenu();
            break;

        case 'error':
            showNotification(data.message, 'error');
            break;

        case 'gameStart':
            startMultiplayerGame(data.players);
            break;

        case 'playerMove':
            const movingPlayer = otherPlayers.get(data.playerId);
            if (movingPlayer) {
                movingPlayer.x = data.x;
                movingPlayer.y = data.y;
                movingPlayer.angle = data.angle;
            }
            break;

        case 'playerShoot':
            const shootX = data.x + Math.cos(data.angle) * CONFIG.playerSize * 0.8;
            const shootY = data.y + Math.sin(data.angle) * CONFIG.playerSize * 0.8;
            bullets.push(new Bullet(shootX, shootY, data.angle, data.playerId));
            break;

        case 'zombieKilled':
            const killedZombie = zombies.find(z => z.id === data.zombieId);
            if (killedZombie) {
                zombies = zombies.filter(z => z.id !== data.zombieId);
                zombiesKilledInWave++;
            }
            updatePlayersListUI();
            break;

        case 'playerHit':
            const hitPlayer = otherPlayers.get(data.playerId);
            if (hitPlayer) hitPlayer.hp = data.hp;
            break;

        case 'playerDied':
            showNotification(`${otherPlayers.get(data.playerId)?.name || 'Игрок'} погиб! (${data.kills} убийств)`, 'error');
            break;

        case 'waveStart':
            wave = data.wave;
            announceWave();
            zombiesInWave = 0;
            zombiesKilledInWave = 0;
            updateUI();
            break;
    }
}

function displayRoomList(rooms) {
    const container = document.getElementById('serverList');

    if (rooms.length === 0) {
        container.innerHTML = `
            <div class="no-servers">
                <p>🔍 Нет доступных комнат</p>
                <p>Создай свою!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = rooms.map(room => `
        <div class="server-item" onclick="joinRoomByCode('${room.code}')">
            <div class="server-info">
                <div class="server-name">${room.name}</div>
                <div class="server-details">Код: ${room.code}</div>
            </div>
            <div class="server-players">👥 ${room.players}/${room.maxPlayers}</div>
        </div>
    `).join('');
}

function joinRoomByCode(code) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'joinRoom', code: code }));
    }
}

function showLobby(room) {
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('serverMenu').classList.add('hidden');
    document.getElementById('roomLobby').classList.remove('hidden');

    document.getElementById('roomName').textContent = room.name;
    document.getElementById('roomCode').textContent = room.code;

    currentRoom = room;
    updateLobbyPlayers();

    gameMode = 'lobby';
}

function updateLobbyPlayers() {
    if (!currentRoom) return;

    const list = document.getElementById('lobbyPlayersList');
    list.innerHTML = currentRoom.players.map(p => `
        <li>
            <div class="player-color" style="background: ${p.color}"></div>
            ${p.name}
            ${p.id === currentRoom.hostId ? '<span class="host-badge">ХОСТ</span>' : ''}
        </li>
    `).join('');

    // Показываем кнопку старта только хосту
    const startBtn = document.getElementById('startGameBtn');
    if (isHost) {
        startBtn.style.display = 'block';
    } else {
        startBtn.style.display = 'none';
    }
}

function showMainMenu() {
    document.getElementById('mainMenu').classList.remove('hidden');
    document.getElementById('serverMenu').classList.add('hidden');
    document.getElementById('roomLobby').classList.add('hidden');
    document.getElementById('gameUI').classList.add('hidden');
    document.getElementById('gameOver').classList.add('hidden');

    gameMode = 'menu';
    gameRunning = false;
}

function showNotification(message, type = '') {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.className = 'notification ' + type;
    notif.classList.remove('hidden');

    setTimeout(() => {
        notif.classList.add('hidden');
    }, 3000);
}

// ============================================
// 🎮 ИГРОВЫЕ ФУНКЦИИ
// ============================================

function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Клавиатура
    document.addEventListener('keydown', (e) => {
        keys[e.key] = true;
    });

    document.addEventListener('keyup', (e) => {
        keys[e.key] = false;
    });

    // Мышь
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            mouseDown = true;
            shoot();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouseDown = false;
    });

    // Кнопки меню
    document.getElementById('showServersBtn').addEventListener('click', () => {
        connectToServer();
        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('serverMenu').classList.remove('hidden');

        // Запрашиваем список комнат
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'getRooms' }));
            }
        }, 500);
    });

    document.getElementById('createRoomBtn').addEventListener('click', () => {
        connectToServer();

        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'createRoom' }));
            }
        }, 500);
    });

    document.getElementById('soloPlayBtn').addEventListener('click', startSoloGame);

    document.getElementById('refreshServersBtn').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'getRooms' }));
        }
    });

    document.getElementById('backToMenuBtn').addEventListener('click', showMainMenu);

    document.getElementById('connectManualBtn').addEventListener('click', () => {
        const address = document.getElementById('serverAddress').value.trim();
        if (address) {
            connectToServer(address);
        }
    });

    document.getElementById('copyCodeBtn').addEventListener('click', () => {
        const code = document.getElementById('roomCode').textContent;
        navigator.clipboard.writeText(code);
        showNotification('Код скопирован!', 'success');
    });

    document.getElementById('startGameBtn').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN && isHost) {
            ws.send(JSON.stringify({ type: 'startGame' }));
        }
    });

    document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'leaveRoom' }));
        }
        showMainMenu();
    });

    document.getElementById('restartBtn').addEventListener('click', () => {
        if (isSoloMode) {
            startSoloGame();
        } else {
            showMainMenu();
        }
    });

    document.getElementById('backToMenuFromGameOver').addEventListener('click', showMainMenu);

    generateGrass();
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function startSoloGame() {
    isSoloMode = true;
    isMultiplayer = false;

    const playerName = document.getElementById('playerName').value.trim() || 'Игрок';

    player = new Player(WORLD.width / 2, WORLD.height / 2, playerName, '#4CAF50', true);

    zombies = [];
    bullets = [];
    particles = [];
    otherPlayers.clear();
    kills = 0;
    wave = 1;
    zombiesInWave = 0;
    zombiesKilledInWave = 0;

    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('gameUI').classList.remove('hidden');
    document.getElementById('currentRoomName').textContent = 'Одиночная';

    updateUI();
    announceWave();

    gameRunning = true;
    gameMode = 'game';
    gameLoop();
}

function startMultiplayerGame(playersData) {
    isSoloMode = false;
    isMultiplayer = true;

    // Находим себя
    const myData = playersData.find(p => p.id === myPlayerId);
    if (!myData) return;

    player = new Player(myData.x, myData.y, myData.name, myData.color, true);

    // Создаём других игроков
    otherPlayers.clear();
    playersData.forEach(p => {
        if (p.id !== myPlayerId) {
            const other = new Player(p.x, p.y, p.name, p.color, false);
            other.id = p.id;
            otherPlayers.set(p.id, other);
        }
    });

    zombies = [];
    bullets = [];
    particles = [];
    kills = 0;
    wave = 1;
    zombiesInWave = 0;
    zombiesKilledInWave = 0;

    document.getElementById('roomLobby').classList.add('hidden');
    document.getElementById('gameUI').classList.remove('hidden');
    document.getElementById('currentRoomName').textContent = currentRoom?.code || 'Мульти';

    updateUI();
    updatePlayersListUI();
    announceWave();

    gameRunning = true;
    gameMode = 'game';
    gameLoop();
}

function gameOver() {
    gameRunning = false;

    document.getElementById('finalScore').textContent = kills;
    document.getElementById('finalWave').textContent = wave;
    document.getElementById('gameOver').classList.remove('hidden');
}

function shoot() {
    if (!gameRunning || !player) return;

    const now = Date.now();
    if (now - lastFireTime < CONFIG.fireRate) return;
    lastFireTime = now;

    const bulletX = player.x + Math.cos(player.angle) * player.size * 0.8;
    const bulletY = player.y + Math.sin(player.angle) * player.size * 0.8;

    bullets.push(new Bullet(bulletX, bulletY, player.angle, myPlayerId));

    if (isMultiplayer && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'shoot',
            x: player.x,
            y: player.y,
            angle: player.angle
        }));
    }
}

function spawnZombie() {
    const maxZombies = CONFIG.zombiesPerWave + (wave - 1) * 3;
    if (zombiesInWave >= maxZombies) return;

    let x, y;
    const side = Math.floor(Math.random() * 4);
    const margin = 100;

    switch (side) {
        case 0:
            x = player.x + (Math.random() - 0.5) * canvas.width * 2;
            y = player.y - canvas.height / 2 - margin;
            break;
        case 1:
            x = player.x + (Math.random() - 0.5) * canvas.width * 2;
            y = player.y + canvas.height / 2 + margin;
            break;
        case 2:
            x = player.x - canvas.width / 2 - margin;
            y = player.y + (Math.random() - 0.5) * canvas.height * 2;
            break;
        case 3:
            x = player.x + canvas.width / 2 + margin;
            y = player.y + (Math.random() - 0.5) * canvas.height * 2;
            break;
    }

    x = Math.max(50, Math.min(WORLD.width - 50, x));
    y = Math.max(50, Math.min(WORLD.height - 50, y));

    zombies.push(new Zombie(x, y, wave));
    zombiesInWave++;
}

function announceWave() {
    const announce = document.getElementById('waveAnnounce');
    document.getElementById('waveAnnounceNum').textContent = wave;

    announce.classList.remove('hidden');
    announce.style.animation = 'none';
    announce.offsetHeight;
    announce.style.animation = 'waveAnnounce 2s ease-out forwards';

    setTimeout(() => {
        announce.classList.add('hidden');
    }, 2000);
}

function checkWaveComplete() {
    const totalZombiesInWave = CONFIG.zombiesPerWave + (wave - 1) * 3;

    if (zombiesKilledInWave >= totalZombiesInWave && zombies.length === 0) {
        wave++;
        zombiesInWave = 0;
        zombiesKilledInWave = 0;

        if (isMultiplayer && ws && isHost) {
            ws.send(JSON.stringify({ type: 'newWave', wave: wave }));
        }

        announceWave();
        updateUI();
    }
}

function updateUI() {
    document.getElementById('killCount').textContent = kills;
    document.getElementById('waveNumber').textContent = wave;
    document.getElementById('playerHP').textContent = player ? Math.max(0, player.hp) : 0;
}

function updatePlayersListUI() {
    const list = document.getElementById('playersUL');
    let html = '';

    if (player) {
        html += `<li><span class="player-dot" style="background: ${player.color}"></span>${player.name}: ${kills}</li>`;
    }

    otherPlayers.forEach(p => {
        html += `<li><span class="player-dot" style="background: ${p.color}"></span>${p.name}: ${p.kills || 0}</li>`;
    });

    list.innerHTML = html;
}

function updateCamera() {
    if (!player) return;

    const targetX = player.x - canvas.width / 2;
    const targetY = player.y - canvas.height / 2;

    camera.x += (targetX - camera.x) * 0.1;
    camera.y += (targetY - camera.y) * 0.1;

    camera.x = Math.max(0, Math.min(WORLD.width - canvas.width, camera.x));
    camera.y = Math.max(0, Math.min(WORLD.height - canvas.height, camera.y));
}

// ============================================
// 🔄 ИГРОВОЙ ЦИКЛ
// ============================================

let lastSpawnTime = 0;
let animationTime = 0;

function gameLoop() {
    if (!gameRunning) return;

    animationTime = Date.now();

    update();
    render();

    requestAnimationFrame(gameLoop);
}

function update() {
    if (player) player.update();
    updateCamera();

    // Спавн зомби (только хост или соло)
    if ((isSoloMode || isHost) && Date.now() - lastSpawnTime > CONFIG.zombieSpawnRate / Math.min(wave, 3)) {
        spawnZombie();
        lastSpawnTime = Date.now();
    }

    zombies.forEach(zombie => zombie.update());
    bullets = bullets.filter(bullet => !bullet.update());
    particles = particles.filter(particle => !particle.update());

    checkCollisions();
    checkWaveComplete();

    if (mouseDown) shoot();
}

function checkCollisions() {
    for (let bIndex = bullets.length - 1; bIndex >= 0; bIndex--) {
        const bullet = bullets[bIndex];

        for (let zIndex = zombies.length - 1; zIndex >= 0; zIndex--) {
            const zombie = zombies[zIndex];
            const dx = bullet.x - zombie.x;
            const dy = bullet.y - zombie.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < bullet.size + zombie.size * 0.5) {
                if (zombie.takeDamage(bullet.damage)) {
                    // Только локальные убийства
                    if (bullet.ownerId === myPlayerId || isSoloMode) {
                        kills++;
                        zombiesKilledInWave++;
                        updateUI();

                        if (isMultiplayer && ws) {
                            ws.send(JSON.stringify({
                                type: 'zombieKill',
                                zombieId: zombie.id
                            }));
                        }
                    }

                    for (let i = 0; i < 15; i++) {
                        particles.push(new Particle(zombie.x, zombie.y, zombie.colorScheme.body));
                    }

                    zombies.splice(zIndex, 1);
                }

                bullets.splice(bIndex, 1);
                break;
            }
        }
    }
}

function render() {
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrassBackground();
    grassTiles.forEach(tile => tile.draw(ctx, animationTime));

    particles.forEach(particle => particle.draw(ctx));
    bullets.forEach(bullet => bullet.draw(ctx));
    zombies.forEach(zombie => zombie.draw(ctx));

    // Другие игроки
    otherPlayers.forEach(p => p.draw(ctx));

    if (player) player.draw(ctx);

    drawMinimap();
}

function drawGrassBackground() {
    const gridSize = 100;
    const offsetX = -camera.x % gridSize;
    const offsetY = -camera.y % gridSize;

    ctx.strokeStyle = 'rgba(0, 100, 0, 0.3)';
    ctx.lineWidth = 1;

    for (let x = offsetX; x < canvas.width + gridSize; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let y = offsetY; y < canvas.height + gridSize; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function drawMinimap() {
    const mapSize = 150;
    const mapX = 20;
    const mapY = canvas.height - mapSize - 20;
    const scale = mapSize / WORLD.width;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(mapX - 5, mapY - 5, mapSize + 10, mapSize + 10, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(mapX, mapY, mapSize, mapSize);

    // Зомби
    ctx.fillStyle = '#e94560';
    zombies.forEach(zombie => {
        ctx.beginPath();
        ctx.arc(mapX + zombie.x * scale, mapY + zombie.y * scale, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    // Другие игроки
    otherPlayers.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(mapX + p.x * scale, mapY + p.y * scale, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Мой игрок
    if (player) {
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(mapX + player.x * scale, mapY + player.y * scale, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(
            mapX + camera.x * scale,
            mapY + camera.y * scale,
            canvas.width * scale,
            canvas.height * scale
        );
    }
}

function adjustColor(color, amount) {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
    return `rgb(${r}, ${g}, ${b})`;
}

window.addEventListener('load', init);
