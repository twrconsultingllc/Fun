const statusDiv = document.getElementById('status');
const modelSelect = document.getElementById('model-select');
const startBtn = document.getElementById('start-btn');
const promptAInput = document.getElementById('prompt-a');
const promptBInput = document.getElementById('prompt-b');
const logContent = document.getElementById('log-content');

let logs = [], gameInterval = null, isFetching = false;

// --- 1. THREE.JS 3D ARENA SETUP ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050505, 0.03);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / (window.innerHeight * 0.75), 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight * 0.75);
document.body.insertBefore(renderer.domElement, document.getElementById('log-window'));

// Arena Floor Grid
const gridHelper = new THREE.GridHelper(30, 30, 0xff0055, 0x222233);
scene.add(gridHelper);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// Bot Constructor helper
function createBot(color, startX, startZ) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color }));
    body.position.y = 0.6;
    group.add(body);

    // Health Bar
    const hbGeo = new THREE.PlaneGeometry(1.5, 0.2);
    const hbMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    const healthBar = new THREE.Mesh(hbGeo, hbMat);
    healthBar.position.set(0, 1.8, 0);
    group.add(healthBar);

    group.position.set(startX, 0, startZ);
    scene.add(group);

    return { group, healthBar, health: 100, targetPos: new THREE.Vector3(startX, 0, startZ), shield: false };
}

const botA = createBot(0xff3344, -10, 0);
const botB = createBot(0x3388ff, 10, 0);

camera.position.set(0, 18, 20);
camera.lookAt(0, 0, 0);

// Lasers Storage
let lasers = [];

function fireLaser(fromBot, toBot) {
    const material = new THREE.LineBasicMaterial({ color: fromBot === botA ? 0xff0044 : 0x0088ff });
    const points = [fromBot.group.position.clone().add(new THREE.Vector3(0,0.6,0)), toBot.group.position.clone().add(new THREE.Vector3(0,0.6,0))];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    lasers.push({ line, createdAt: Date.now() });

    // Damage Calculation
    const damage = toBot.shield ? 3 : 12;
    toBot.health = Math.max(0, toBot.health - damage);
    toBot.healthBar.scale.x = toBot.health / 100;
}

// --- 2. 60 FPS INTERPOLATED ENGINE LOOP ---
function animate() {
    requestAnimationFrame(animate);

    // Smooth movement interpolation
    botA.group.position.lerp(botA.targetPos, 0.05);
    botB.group.position.lerp(botB.targetPos, 0.05);

    // Keep Health Bars facing Camera
    botA.healthBar.lookAt(camera.position);
    botB.healthBar.lookAt(camera.position);

    // Clean up expired lasers
    const now = Date.now();
    lasers = lasers.filter(l => {
        if (now - l.createdAt > 200) {
            scene.remove(l.line);
            return false;
        }
        return true;
    });

    renderer.render(scene, camera);
}
animate();

// --- 3. UI & LOGGING ---
function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    const logString = `<div class="log-entry"><span style="color:#666">[${timestamp}]</span> <strong class="${colorClass}">${type}:</strong> ${typeof data === 'object' ? JSON.stringify(data) : data}</div>`;
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
        statusDiv.innerText = "Arena Ready. Click START BATTLE.";
    } catch (e) {
        addLog('ERROR', e.message);
        statusDiv.innerText = "Error loading models.";
    }
}
loadAvailableModels();

// --- 4. TACTICAL API LOOP ---
async function fetchTacticalTurn() {
    if (isFetching) return;
    isFetching = true;

    const selectedModel = modelSelect.value;
    const gameState = {
        botA: { health: botA.health, pos: { x: botA.group.position.x.toFixed(1), z: botA.group.position.z.toFixed(1) } },
        botB: { health: botB.health, pos: { x: botB.group.position.x.toFixed(1), z: botB.group.position.z.toFixed(1) } },
        distance: botA.group.position.distanceTo(botB.group.position).toFixed(1)
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

        // Execute Skill Directive - Bot A
        if (actions.botA) {
            botA.shield = (actions.botA.skill === "DEFENSIVE_SHIELD");
            if (actions.botA.target) botA.targetPos.set(actions.botA.target.x, 0, actions.botA.target.z);
            if (actions.botA.skill !== "DEFENSIVE_SHIELD") fireLaser(botA, botB);
        }

        // Execute Skill Directive - Bot B
        if (actions.botB) {
            botB.shield = (actions.botB.skill === "DEFENSIVE_SHIELD");
            if (actions.botB.target) botB.targetPos.set(actions.botB.target.x, 0, actions.botB.target.z);
            if (actions.botB.skill !== "DEFENSIVE_SHIELD") fireLaser(botB, botA);
        }

        statusDiv.innerText = `A: ${actions.botA?.skill || 'NONE'} | B: ${actions.botB?.skill || 'NONE'}`;

    } catch (e) {
        addLog('ERROR', e.message);
        statusDiv.innerText = "Battle Turn Error.";
    } finally {
        isFetching = false;
    }
}

// --- 5. START BUTTON ---
startBtn.addEventListener('click', () => {
    if (gameInterval) clearInterval(gameInterval);

    // Reset Arena
    botA.health = 100; botB.health = 100;
    botA.healthBar.scale.x = 1; botB.healthBar.scale.x = 1;
    botA.group.position.set(-10, 0, 0); botB.group.position.set(10, 0, 0);
    botA.targetPos.set(-10, 0, 0); botB.targetPos.set(10, 0, 0);

    statusDiv.innerText = "Battle Engaged!";
    fetchTacticalTurn();
    gameInterval = setInterval(fetchTacticalTurn, 6500); // Safe rate-limit interval
});