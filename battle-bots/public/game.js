const ui = document.getElementById('ui');

// 1. Basic Three.js Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 2. Create Placeholder Bots (Red vs Blue)
const geometry = new THREE.BoxGeometry(1, 2, 1);
const materialA = new THREE.MeshBasicMaterial({ color: 0xff4444 });
const botA = new THREE.Mesh(geometry, materialA);
botA.position.x = -10; // Start at the left edge
scene.add(botA);

const materialB = new THREE.MeshBasicMaterial({ color: 0x4444ff });
const botB = new THREE.Mesh(geometry, materialB);
botB.position.x = 10; // Start at the right edge
scene.add(botB);

// Backed the camera up so we can see the wider edges
camera.position.z = 12; 
camera.position.y = 2;
camera.lookAt(0, 0, 0);

// 3. Render Loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

// 4. API Logic
async function fetchBotActions() {
    ui.innerText = "LLMs are thinking...";
    
    const gameState = {
        botA: { health: 100, positionX: botA.position.x },
        botB: { health: 100, positionX: botB.position.x },
        distance: Math.abs(botA.position.x - botB.position.x)
    };

    try {
        const response = await fetch('/api/get-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameState })
        });
        
        const actions = await response.json();
        ui.innerText = `Bot A: ${actions.botA}\nBot B: ${actions.botB}`;
        
        // Larger visual reaction to hit the middle in ~30 seconds (1.25 units per 4s turn)
        if(actions.botA === "MOVE_RIGHT") botA.position.x += 1.25;
        if(actions.botA === "MOVE_LEFT") botA.position.x -= 1.25;
        
        if(actions.botB === "MOVE_LEFT") botB.position.x -= 1.25;
        if(actions.botB === "MOVE_RIGHT") botB.position.x += 1.25;
        
    } catch(e) {
        ui.innerText = "Error reaching AI backend.";
        console.error(e);
    }
}

// Trigger the first turn after 2 seconds, then every 4 seconds
setTimeout(() => {
    fetchBotActions();
    setInterval(fetchBotActions, 4000);
}, 2000);