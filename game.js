import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ============================================
// ⚙️ КОНФИГУРАЦИЯ
// ============================================
const CONFIG = {
    moveSpeed: 10,
    runSpeed: 18,
    jumpHeight: 15,
    mouseSensitivity: 0.002,
    fireRate: 100,
    damage: 25,
    reloadTime: 1500,
    ammoPerClip: 30,
    lerpFactor: 0.3
};

// Глобальные переменные
let camera, scene, renderer, controls;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let canJump = false, isSprinting = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

// Оружие
let weaponModel, muzzleFlash;
let lastFire = 0, ammo = CONFIG.ammoPerClip, isReloading = false;

// Игровые объекты
let players = new Map();
let zombies = new Map();
let particles = [];

// Мультиплеер
let ws, myPlayerId = null, isMultiplayer = false;
let gameRunning = false, lastServerUpdate = 0;

// ============================================
// 🚀 ИНИЦИАЛИЗАЦИЯ
// ============================================
init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 0, 60);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.y = 1.6;

    // Освещение
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Пол
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    scene.add(floor);

    createWalls();
    createWeapon();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);

    setupUI();
    setupControls();

    // Подключение к серверу
    connectToServer();
}

function connectToServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('✅ Connected');
        // Запрос комнат
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'getRooms' }));
            }
        }, 500);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'roomList':
            updateRoomListUI(data.rooms);
            break;
        case 'roomCreated':
        case 'roomJoined':
            isMultiplayer = true;
            myPlayerId = data.room.hostId === data.room.players ? 'host' : 'client';
            showLobby(data.room);
            break;
        case 'playerJoined':
            if (data.player.id !== myPlayerId) {
                createPlayer(data.player.id, data.player.color);
                updateLobbyPlayers(data.player.name);
            }
            break;
        case 'playerLeft':
            removePlayer(data.playerId);
            break;
        case 'gameStart':
            startGame();
            showWaveAnnounce(data.wave);
            break;
        case 'worldUpdate':
            syncWorld(data);
            break;
        case 'playerHit':
            updateHealthUI(data.hp);
            break;
        case 'playerDied':
            showNotification('Ты погиб!', 'error');
            setTimeout(() => {
                camera.position.set(0, 1.6, 0);
                updateHealthUI(100);
            }, 3000);
            break;
    }
}

function syncWorld(data) {
    if (!gameRunning) return;

    // Зомби
    const activeZombies = new Set();
    data.zombies.forEach(zData => {
        activeZombies.add(zData.id);

        let zombie = zombies.get(zData.id);
        if (!zombie) {
            zombie = createZombie(zData.id, zData.x, zData.z);
        }

        // Целевая позиция
        zombie.userData.targetPos.set(zData.x, 0, zData.z);
        zombie.userData.targetRot = zData.ry;
        zombie.userData.hp = zData.hp;

        // Быстрое перемещение если далеко (телепорт)
        if (zombie.position.distanceTo(zombie.userData.targetPos) > 5) {
            zombie.position.copy(zombie.userData.targetPos);
        }
    });

    zombies.forEach((z, id) => {
        if (!activeZombies.has(id)) {
            scene.remove(z);
            zombies.delete(id);
        }
    });

    // Игроки
    data.players.forEach(pData => {
        // Пропускаем себя (нет ID от сервера пока, но по координатам можно понять)
        // Временный фикс: сервер не присылает ID в worldUpdate для меня?
        // Сервер шлет ВСЕХ.
        // Нам нужен свой ID. Он приходит в roomJoined? Нет.
        // Добавим проверку: если дистанция до камеры < 0.1 - это мы.
        if (new THREE.Vector3(pData.x, pData.y, pData.z).distanceTo(camera.position) < 0.5) return;

        let p = players.get(pData.id);
        if (!p) {
            p = createPlayer(pData.id, '#ff0000');
        }

        p.userData.targetPos.set(pData.x, pData.y, pData.z);
        p.rotation.y = pData.ry; // Поворот можно сразу ставить
    });
}

function createZombie(id, x, z) {
    const group = new THREE.Group();

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x4CAF50 }));
    body.position.y = 0.9;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x81C784 }));
    head.position.y = 1.9;
    group.add(head);

    // Руки
    const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const leftArm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: 0x388E3C }));
    leftArm.position.set(-0.4, 1.5, 0.3); leftArm.rotation.x = -Math.PI / 2;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: 0x388E3C }));
    rightArm.position.set(0.4, 1.5, 0.3); rightArm.rotation.x = -Math.PI / 2;
    group.add(rightArm);

    group.position.set(x, 0, z);
    group.userData = { type: 'zombie', id: id, targetPos: new THREE.Vector3(x, 0, z), targetRot: 0 };

    scene.add(group);
    zombies.set(id, group);
    return group;
}

function createPlayer(id, color) {
    const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 1.8, 4, 8),
        new THREE.MeshStandardMaterial({ color: color })
    );
    mesh.position.y = 1; // Центр капсулы
    mesh.userData = { targetPos: new THREE.Vector3() };
    scene.add(mesh);
    players.set(id, mesh);
    return mesh;
}

function removePlayer(id) {
    const p = players.get(id);
    if (p) {
        scene.remove(p);
        players.delete(id);
    }
}

// ============================================
// 🎮 ЛОГИКА ИГРЫ
// ============================================

function setupControls() {
    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
            case 'Space': if (canJump) { velocity.y += CONFIG.jumpHeight; canJump = false; } break;
            case 'ShiftLeft': isSprinting = true; break;
            case 'KeyR': reload(); break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
            case 'ShiftLeft': isSprinting = false; break;
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (controls.isLocked && e.button === 0) shoot();
    });

    // Обработка клика "играть"
    const blocker = document.getElementById('clickToPlay');
    blocker.addEventListener('click', () => controls.lock());

    controls.addEventListener('lock', () => {
        blocker.style.display = 'none';
        document.getElementById('gameUI').classList.remove('hidden');
    });
    controls.addEventListener('unlock', () => {
        if (gameRunning) blocker.style.display = 'flex';
    });
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const dt = (time - lastServerUpdate) / 1000; // Delta time not quite right but consistent

    // Интерполяция зомби
    zombies.forEach(z => {
        z.position.lerp(z.userData.targetPos, 0.1);
        z.rotation.y = THREE.MathUtils.lerp(z.rotation.y, z.userData.targetRot, 0.1);
    });

    // Интерполяция игроков
    players.forEach(p => {
        p.position.lerp(p.userData.targetPos, 0.1);
    });

    if (controls.isLocked) {
        const delta = 0.016; // Fix dt for physics

        velocity.x -= velocity.x * 10 * delta;
        velocity.z -= velocity.z * 10 * delta;
        velocity.y -= 30 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const speed = isSprinting ? CONFIG.runSpeed : CONFIG.moveSpeed;
        if (moveForward || moveBackward) velocity.z -= direction.z * speed * 10 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * 10 * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        controls.getObject().position.y += velocity.y * delta;

        if (controls.getObject().position.y < 1.6) {
            velocity.y = 0;
            controls.getObject().position.y = 1.6;
            canJump = true;
        }

        // Отправка позиции (10 раз в сек)
        if (ws && isMultiplayer && Date.now() - lastServerUpdate > 100) {
            ws.send(JSON.stringify({
                type: 'position',
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
                ry: camera.rotation.y
            }));
            lastServerUpdate = Date.now();
        }
    }

    renderer.render(scene, camera);
}

// ... UI Functions (setupUI, updateRoomListUI, etc.) ...
// Добавим их в конец файла, так как место еще есть

function setupUI() {
    document.getElementById('showServersBtn').onclick = () => {
        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('serverMenu').classList.remove('hidden');
        ws.send(JSON.stringify({ type: 'getRooms' }));
    };
    document.getElementById('createRoomBtn').onclick = () => {
        ws.send(JSON.stringify({ type: 'createRoom' }));
    };
    document.getElementById('startGameBtn').onclick = () => {
        ws.send(JSON.stringify({ type: 'startGame' }));
    };

    // Ручное обновление списка
    document.getElementById('refreshServersBtn').onclick = () => {
        ws.send(JSON.stringify({ type: 'getRooms' }));
    };
}

function updateRoomListUI(rooms) {
    const list = document.getElementById('serverList');
    if (rooms.length === 0) {
        list.innerHTML = '<div style="color:#aaa; padding:20px;">Нет комнат</div>';
        return;
    }
    list.innerHTML = rooms.map(r => `
        <div class="server-item" onclick="joinRoom('${r.code}')">
            <b>${r.name}</b> (${r.players}/${r.maxPlayers})
        </div>
    `).join('');
}

window.joinRoom = (code) => {
    ws.send(JSON.stringify({ type: 'joinRoom', code }));
};

function showLobby(room) {
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('serverMenu').classList.add('hidden');
    document.getElementById('roomLobby').classList.remove('hidden');

    document.getElementById('roomName').textContent = room.name;
    document.getElementById('roomCode').textContent = room.code;

    if (myPlayerId === 'host') {
        document.getElementById('startGameBtn').style.display = 'block';
    } else {
        document.getElementById('startGameBtn').style.display = 'none';
    }
}

function updateLobbyPlayers(name) {
    const ul = document.getElementById('lobbyPlayersList');
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
}

function startGame() {
    gameRunning = true;
    document.getElementById('roomLobby').classList.add('hidden');
    document.getElementById('clickToPlay').classList.remove('hidden');
}

function showWaveAnnounce(wave) {
    const el = document.getElementById('waveAnnounce');
    document.getElementById('waveAnnounceNum').textContent = wave;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function updateHealthUI(hp) {
    document.getElementById('healthText').textContent = hp;
    document.getElementById('healthBarFill').style.width = hp + '%';
}

function showNotification(msg, type) {
    const notif = document.getElementById('notification');
    notif.textContent = msg;
    notif.className = `notification ${type}`;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}

// ... Weapon logic (createWeapon, shoot, reload) ...

function createWeapon() {
    weaponModel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    body.position.z = 0.2;
    weaponModel.add(body);

    weaponModel.position.set(0.3, -0.3, -0.5);
    camera.add(weaponModel);
    scene.add(camera);

    const flashGeo = new THREE.PlaneGeometry(0.3, 0.3);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 });
    muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    muzzleFlash.position.set(0, 0.05, -0.6);
    muzzleFlash.visible = false;
    camera.add(muzzleFlash);
}

function shoot() {
    if (Date.now() - lastFire < CONFIG.fireRate || isReloading || ammo <= 0) return;
    lastFire = Date.now();
    ammo--;
    document.getElementById('ammoCount').textContent = ammo;

    // Эффект
    weaponModel.position.z += 0.1;
    muzzleFlash.visible = true;
    muzzleFlash.rotation.z = Math.random() * Math.PI;
    muzzleFlash.material.opacity = 1;
    setTimeout(() => { weaponModel.position.z -= 0.1; muzzleFlash.visible = false; }, 50);

    // Raycast
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(), camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (const hit of intersects) {
        if (hit.object.userData && hit.object.userData.type === 'zombie') {
            createParticle(hit.point, 0xff0000);
            ws.send(JSON.stringify({ type: 'zombieHit', id: hit.object.userData.id, damage: CONFIG.damage }));
            break;
        } else if (hit.distance < 100) {
            createParticle(hit.point, 0xaaaaaa);
            break;
        }
    }
}

function reload() {
    if (isReloading) return;
    isReloading = true;
    document.getElementById('reloadMsg').classList.remove('hidden');
    weaponModel.rotation.x = -0.5;
    setTimeout(() => {
        ammo = CONFIG.ammoPerClip;
        document.getElementById('ammoCount').textContent = ammo;
        isReloading = false;
        document.getElementById('reloadMsg').classList.add('hidden');
        weaponModel.rotation.x = 0;
    }, CONFIG.reloadTime);
}

function createParticle(pos, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    scene.add(m);
    setTimeout(() => scene.remove(m), 500);
}

function createWalls() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const w1 = new THREE.Mesh(new THREE.BoxGeometry(200, 10, 1), mat); w1.position.z = -100;
    const w2 = new THREE.Mesh(new THREE.BoxGeometry(200, 10, 1), mat); w2.position.z = 100;
    const w3 = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 200), mat); w3.position.x = -100;
    const w4 = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 200), mat); w4.position.x = 100;
    scene.add(w1, w2, w3, w4);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
