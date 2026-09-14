const statusDiv = document.getElementById('status');
const modelSelect = document.getElementById('model-select');
const startBtn = document.getElementById('start-btn');
const promptAInput = document.getElementById('prompt-a');
const promptBInput = document.getElementById('prompt-b');
const logContent = document.getElementById('log-content');

let logs = [], gameInterval = null, isFetching = false;

// --- 1. ARENA & SCENE SETUP (BOTS.HTML STYLE) ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020205, 0.02);

const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

// Glowing Neon Arena Grid
const grid = new THREE.GridHelper(40, 40, 0x00ffcc, 0x081525);
grid.position.y = -0.01;
scene.add(grid);

// Outer Arena Boundary Box
const boundaryGeo = new THREE.BoxGeometry(40, 2, 40);
const boundaryMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true, transparent: true, opacity: 0.15 });
const boundary = new THREE.Mesh(boundaryGeo, boundaryMat);
boundary.position.y = 1;
scene.add(boundary);

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 40, 20);
dirLight.castShadow = true;
scene.add(dirLight);

// Projectiles Container
let lasers = [];

// Bot Factory
function createArenaBot(colorHex, x, z) {
    const group = new THREE.Group();

    // Main Body
    const bodyGeo = new THREE.BoxGeometry(1.6, 0.8, 1.8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.8, roughness: 0.2 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    // Turret Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.0);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.7, 0.6);
    group.add(barrel);

    // Shield Dome
    const shieldGeo = new THREE.SphereGeometry(1.6, 16, 16);
    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0 });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.position.y = 0.5;
    group.add(shield);

    // Health Bar HUD Element
    const hbBg = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.25), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    hbBg.position.set(0, 2.2, 0);
    group.add(hbBg);

    const hbFill = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.2), new THREE.MeshBasicMaterial({ color: colorHex }));
    hbFill.position.set(0, 2.2, 0.01);
    group.add(hbFill);

    group.position.set(x, 0, z);
    scene.add(group);

    return {
        group,
        shield,
        hbFill,
        health: 100,
        targetPos: new THREE.Vector3(x, 0, z),
        moveSpeed: 0.14,
        lastShot: 0,
        colorHex
    };
}

const botA = createArenaBot(0xff3355, -12, 0);
const botB = createArenaBot(0x3399ff, 12, 0);

camera.position.set(0, 26, 28);
camera.lookAt(0, 0, 0);

// --- 2. 60 FPS MECHANICS & LASER PHYSICS ENGINE ---
function fireLaserBeam(shooter, target) {
    const geo = new THREE.CylinderGeometry(0.08, 0.08, 1.2);
    const mat = new THREE.MeshBasicMaterial({ color: shooter.colorHex });
    const laser = new THREE.Mesh(geo, mat);

    const startPos = shooter.group.position.clone().add(new THREE.Vector3(0, 0.7, 0));
    laser.position.copy(startPos);

    const dir = target.group.position.clone().sub(startPos).normalize();
    laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    scene.add(laser);

    lasers.push({
        mesh: laser,
        dir,
        speed: 0.6,
        target,
        createdAt: Date.now()
    });
}

function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();

    // Smooth movement towards target vectors
    [botA, botB].forEach(bot => {
        if (bot.health <= 0) return;

        const dist = bot.group.position.distanceTo(bot.targetPos);
        if (dist > 0.2) {
            const moveDir = bot.targetPos.clone().sub(bot.group.position).normalize();
            bot.group.position.add(moveDir.multiplyScalar(bot.moveSpeed));
            bot.group.lookAt(bot.targetPos.x, bot.group.position.y, bot.targetPos.z);
        }

        // Keep within 40x40 arena walls
        bot.group.position.x = Math.max(-18, Math.min(18, bot.group.position.x));
        bot.group.position.z = Math.max(-18, Math.min(18, bot.group.position.z));

        // Auto Shooting Mechanics
        const enemy = bot === botA ? botB : botA;
        if (enemy.health > 0 && now - bot.lastShot > 500) {
            fireLaserBeam(bot, enemy);
            bot.lastShot = now;
        }

        bot.hbFill.lookAt(camera.position);
    });

    // Laser Trajectory & Hit Detection
    lasers = lasers.filter(l => {
        l.mesh.position.add(l.dir.clone().multiplyScalar(l.speed));

        if (l.mesh.position.distanceTo(l.target.group.position) < 1.2) {
            const damage = l.target.shield.material.opacity > 0 ? 2 : 7;
            l.target.health = Math.max(0, l.target.health - damage);
            l.target.hbFill.scale.x = l.target.health / 100;

            scene.remove(l.mesh);
            return false;
        }

        if (now - l.createdAt > 2000) {
            scene.remove(l.mesh);
            return false;
        }

        return true;
    });

    renderer.render(scene, camera);
}
animate();

// --- 3. TELEMETRY LOGGING ---
function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    const logString = `<div class="log-entry"><span style="color:#555">[${timestamp}]</span> <strong class="${colorClass}">${type}:</strong> ${typeof data === 'object' ? JSON.stringify(data) : data}</div>`;
    logs.unshift(logString);
    if (logs.length > 20) logs.pop();
    logContent.innerHTML = logs.join('');
}

async function loadAvailableModels() {
    try {
        const response = await fetch('/api/get-actions');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        modelSelect.innerHTML = '';
        data.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = m;
            modelSelect.appendChild(opt);
        });
        statusDiv.innerText = "SYSTEMS ONLINE. READY FOR ENGAGEMENT.";
    } catch (e) {
        addLog('ERROR', e.message);
        statusDiv.innerText = "MODEL INITIALIZATION ERROR.";
    }
}
loadAvailableModels();

// --- 4. AI COMMAND PULSE ---
async function fetchTacticalTurn() {
    if (isFetching || botA.health <= 0 || botB.health <= 0) return;
    isFetching = true;

    const selectedModel = modelSelect.value;
    const gameState = {
        botA: { health: botA.health, x: botA.group.position.x.toFixed(1), z: botA.group.position.z.toFixed(1) },
        botB: { health: botB.health, x: botB.group.position.x.toFixed(1), z: botB.group.position.z.toFixed(1) }
    };

    addLog('SENT', { model: selectedModel, state: gameState });

    try {
        const response = await fetch('/api/get-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                gameState, 
                selectedModel,
                promptA: promptAInput.value,
                promptB: promptBInput.value
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Server Error");
        }

        const actions = await response.json();
        addLog('RECV', actions);

        if (actions.botA) {
            if (actions.botA.target) botA.targetPos.set(actions.botA.target.x, 0, actions.botA.target.z);
            botA.shield.material.opacity = actions.botA.skill === "DEFENSIVE_SHIELD" ? 0.6 : 0;
        }

        if (actions.botB) {
            if (actions.botB.target) botB.targetPos.set(actions.botB.target.x, 0, actions.botB.target.z);
            botB.shield.material.opacity = actions.botB.skill === "DEFENSIVE_SHIELD" ? 0.6 : 0;
        }

        statusDiv.innerText = `A: ${actions.botA?.skill || 'ENGAGED'} | B: ${actions.botB?.skill || 'ENGAGED'}`;

    } catch (e) {
        addLog('ERROR', e.message);
        statusDiv.innerText = "TELEMETRY LINK INTERRUPTED.";
    } finally {
        isFetching = false;
    }
}

// Window resize handler
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});

// --- 5. START BUTTON (DYNAMIC RATE-LIMIT AWARENESS) ---
startBtn.addEventListener('click', () => {
    if (gameInterval) clearInterval(gameInterval);

    // Reset Bot States
    botA.health = 100; botB.health = 100;
    botA.hbFill.scale.x = 1; botB.hbFill.scale.x = 1;
    botA.group.position.set(-12, 0, 0); botB.group.position.set(12, 0, 0);
    botA.targetPos.set(-12, 0, 0); botB.targetPos.set(12, 0, 0);

    // Determine safe pulsing speed based on chosen model tier
    const selectedModel = modelSelect.value.toLowerCase();
    const isPro = selectedModel.includes('pro');
    const intervalTime = isPro ? 32000 : 6500; // 32s for Pro, 6.5s for Flash

    statusDiv.innerText = `COMBAT ENGAGED. TACTICAL PULSE: ${isPro ? '32s' : '6.5s'}.`;
    
    fetchTacticalTurn();
    gameInterval = setInterval(fetchTacticalTurn, intervalTime);
});