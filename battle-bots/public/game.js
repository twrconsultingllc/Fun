const statusDiv = document.getElementById('status');
const modelSelect = document.getElementById('model-select');
const startBtn = document.getElementById('start-btn');
const logContent = document.getElementById('log-content');

let logs = [];
let gameInterval = null;

// 1. Basic Three.js Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / (window.innerHeight * 0.7), 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight * 0.7);
document.body.insertBefore(renderer.domElement, document.getElementById('log-window'));

// 2. Create Placeholder Bots (Red vs Blue)
const geometry = new THREE.BoxGeometry(1, 2, 1);
const materialA = new THREE.MeshBasicMaterial({ color: 0xff4444 });
const botA = new THREE.Mesh(geometry, materialA);
botA.position.x = -10;
scene.add(botA);

const materialB = new THREE.MeshBasicMaterial({ color: 0x4444ff });
const botB = new THREE.Mesh(geometry, materialB);
botB.position.x = 10;
scene.add(botB);

camera.position.z = 12; 
camera.position.y = 2;
camera.lookAt(0, 0, 0);

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

// 3. Logger Function
function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    
    const logString = `
        <div class="log-entry">
            <span style="color: #666">[${timestamp}]</span> 
            <strong class="${colorClass}">${type}:</strong> 
            ${typeof data === 'object' ? JSON.stringify(data) : data}
        </div>
    `;
    
    logs.unshift(logString);
    if (logs.length > 20) logs.pop();
    logContent.innerHTML = logs.join('');
}

// 4. Load Models on Startup
async function loadAvailableModels() {
    try {
        const response = await fetch('/api/get-actions');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to load models");
        }

        modelSelect.innerHTML = '';
        data.models.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model;
            opt.innerText = model;
            modelSelect.appendChild(opt);
        });

        statusDiv.innerText = "Models loaded! Choose one and click Start Battle.";
        addLog('RECV', { availableModels: data.models });
    } catch (e) {
        addLog('ERROR', e.message);
        statusDiv.innerText = "Error loading model list.";
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
}

loadAvailableModels();

// 5. Game Loop API Call
async function fetchBotActions() {
    const selectedModel = modelSelect.value;
    if (!selectedModel) {
        statusDiv.innerText = "Please select a model first!";
        return;
    }

    statusDiv.innerText = `Thinking using ${selectedModel}...`;
    
    const gameState = {
        botA: { health: 100, positionX: botA.position.x },
        botB: { health: 100, positionX: botB.position.x },
        distance: Math.abs(botA.position.x - botB.position.x)
    };

    addLog('SENT', { model: selectedModel, state: gameState });

    try {
        const response = await fetch('/api/get-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameState, selectedModel })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Unknown Server Error");
        }

        const actions = await response.json();
        addLog('RECV', actions);
        statusDiv.innerText = `Bot A: ${actions.botA} | Bot B: ${actions.botB}`;
        
        // Move bots
        if(actions.botA === "MOVE_RIGHT") botA.position.x += 1.25;
        if(actions.botA === "MOVE_LEFT") botA.position.x -= 1.25;
        
        if(actions.botB === "MOVE_LEFT") botB.position.x -= 1.25;
        if(actions.botB === "MOVE_RIGHT") botB.position.x += 1.25;
        
    } catch(e) {
        addLog('ERROR', e.message);
        statusDiv.innerText = "Error during battle turn.";
    }
}

// 6. Start Battle Event Listener
startBtn.addEventListener('click', () => {
    if (gameInterval) clearInterval(gameInterval);

    // Reset bot positions
    botA.position.x = -10;
    botB.position.x = 10;

    statusDiv.innerText = "Battle Started!";
    fetchBotActions();
    gameInterval = setInterval(fetchBotActions, 4000);
});