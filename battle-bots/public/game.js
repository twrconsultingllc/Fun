const ui = document.getElementById('ui');
const logContent = document.getElementById('log-content');
let logs = [];

// 1. Basic Three.js Setup (Adjusted height for the log window)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / (window.innerHeight * 0.7), 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight * 0.7); // Leaves 30% for logs
// Insert the canvas right before the log window
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

// 3. Render Loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

// 4. NEW LOGGING FUNCTION
function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    
    const logString = `
        <div class="log-entry">
            <span style="color: #666">[${timestamp}]</span> 
            <strong class="${colorClass}">${type}:</strong> 
            ${JSON.stringify(data)}
        </div>
    `;
    
    logs.unshift(logString); // Add to the top of the array
    if (logs.length > 20) logs.pop(); // Keep only the last 20
    
    logContent.innerHTML = logs.join('');
}

// 5. API Logic
async function fetchBotActions() {
    ui.innerText = "LLMs are thinking...";
    
    const gameState = {
        botA: { health: 100, positionX: botA.position.x },
        botB: { health: 100, positionX: botB.position.x },
        distance: Math.abs(botA.position.x - botB.position.x)
    };

    addLog('SENT', gameState);

    try {
        const response = await fetch('/api/get-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameState })
        });
        
        if (!response.ok) {
            throw new Error(`Server returned status: ${response.status}`);
        }

        const actions = await response.json();
        addLog('RECV', actions);
        ui.innerText = `Bot A: ${actions.botA}\nBot B: ${actions.botB}`;
        
        // Move bots based on actions
        if(actions.botA === "MOVE_RIGHT") botA.position.x += 1.25;
        if(actions.botA === "MOVE_LEFT") botA.position.x -= 1.25;
        
        if(actions.botB === "MOVE_LEFT") botB.position.x -= 1.25;
        if(actions.botB === "MOVE_RIGHT") botB.position.x += 1.25;
        
    } catch(e) {
        addLog('ERROR', e.message);
        ui.innerText = "Error reaching AI backend.";
        console.error(e);
    }
}

// Trigger the first turn after 2 seconds, then every 4 seconds
setTimeout(() => {
    fetchBotActions();
    setInterval(fetchBotActions, 4000);
}, 2000);