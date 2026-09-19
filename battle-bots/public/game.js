const canvas = document.getElementById('arenaCanvas');
const ctx = canvas.getContext('2d');
const virtualSize = 600;

// UI & AI Variables
const overlay = document.getElementById('arena-overlay');
const btnStart = document.getElementById('btn-start');
const btnOverlayStart = document.getElementById('btn-overlay-start');
const modelSelect = document.getElementById('model-select');
const promptAInput = document.getElementById('prompt-a');
const promptBInput = document.getElementById('prompt-b');
const logContent = document.getElementById('log-content');

let winsRed = 0, winsBlue = 0;
let logs = [], aiTimer = null, isFetching = false;
let state = 'INIT'; // INIT, RUNNING, ENDED
let lastTime = 0;
let botRed, botBlue;
let bullets = [], particles = [], obstacles = [];

function bindSlider(id, labelId, suffix = '') {
    const slider = document.getElementById(id);
    const label = document.getElementById(labelId);
    slider.addEventListener('input', () => label.innerText = slider.value + suffix);
}
bindSlider('cfg-r-hp', 'val-r-hp'); bindSlider('cfg-r-spd', 'val-r-spd');
bindSlider('cfg-b-hp', 'val-b-hp'); bindSlider('cfg-b-spd', 'val-b-spd');
bindSlider('cfg-a-obs', 'val-a-obs');

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    const body = typeof data === 'object' ? JSON.stringify(data) : data;
    const logString = `<div class="log-entry"><span style="color:#555">[${timestamp}]</span> <strong class="${colorClass}">${type}:</strong> ${escapeHtml(body)}</div>`;
    logs.unshift(logString);
    if (logs.length > 10) logs.pop();
    logContent.innerHTML = logs.join('');
}

// --- NEW: Load & Filter Models ---
async function loadAvailableModels() {
    try {
        const response = await fetch('/api/get-actions');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        modelSelect.innerHTML = '';
        
        // Filter to capture the standard model (e.g. gemini-3.5-flash) and the lite/8b version
        const targetModels = data.models.filter(m => 
            m.includes('3.5-flash') || m.includes('lite') || m.includes('8b')
        );
        
        // Fallback to all flash models if the filter above is too strict
        const displayModels = targetModels.length > 0 ? targetModels : data.models.filter(m => m.includes('flash'));

        displayModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = m.toUpperCase();
            modelSelect.appendChild(opt);
        });
        
        addLog('RECV', 'Models loaded and filtered successfully.');
    } catch (e) {
        addLog('ERROR', e.message);
        modelSelect.innerHTML = '<option value="">ERROR LOADING MODELS</option>';
    }
}
loadAvailableModels();

// Audio System
let audioCtx;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}
function playSound(type) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    
    if (type === 'shoot_red' || type === 'shoot_blue') {
        osc.type = type === 'shoot_red' ? 'sawtooth' : 'square';
        osc.frequency.setValueAtTime(type === 'shoot_red' ? 400 : 600, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'hit') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'explode') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    }
}

class Bot {
    constructor(x, y, color, team, config) {
        this.x = x; this.y = y;
        this.radius = 16;
        this.color = color;
        this.team = team;
        
        this.baseSpeed = config.speed;
        this.maxHp = config.hp;
        this.hp = this.maxHp;
        this.speed = this.baseSpeed;
        this.fireDelay = 1.0 / 2.5; 
        this.fireCooldown = 0;
        
        this.aggression = 50; 
        this.optimalDistance = 400 - (this.aggression * 3.6); 
        this.activeSkill = "NONE";
        
        this.angle = team === 'red' ? 0 : Math.PI;
        this.vx = 0; this.vy = 0;
        this.strafeTimer = 0;
        this.strafeDir = Math.random() > 0.5 ? 1 : -1;
        this.dead = false;
    }

    applyAISkill(skillName, stats) {
        this.activeSkill = skillName;
        this.aggression = stats.aggression;
        this.optimalDistance = 400 - (this.aggression * 3.6);
        this.speed = this.baseSpeed * stats.speedModifier;
    }

    update(dt, enemy) {
        if (this.dead || enemy.dead) return;

        let dx = enemy.x - this.x; let dy = enemy.y - this.y;
        let dist = Math.hypot(dx, dy);
        this.angle = Math.atan2(dy, dx);

        let dirX = dx / dist; let dirY = dy / dist;
        let distError = dist - this.optimalDistance;
        let driveWeight = Math.min(Math.abs(distError) / 100, 1.0) * Math.sign(distError);
        
        this.strafeTimer -= dt;
        if(this.strafeTimer <= 0) {
            this.strafeDir *= -1;
            this.strafeTimer = Math.random() * 2 + 1;
        }
        
        let perpX = -dirY; let perpY = dirX;
        let strafeWeight = 1.0 - (this.aggression / 100) * 0.5;

        let targetVx = (dirX * driveWeight + perpX * this.strafeDir * strafeWeight);
        let targetVy = (dirY * driveWeight + perpY * this.strafeDir * strafeWeight);
        
        let mag = Math.hypot(targetVx, targetVy);
        if (mag > 0) { targetVx = (targetVx / mag) * this.speed; targetVy = (targetVy / mag) * this.speed; }

        this.vx += (targetVx - this.vx) * 5 * dt;
        this.vy += (targetVy - this.vy) * 5 * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        let pad = this.radius + 5;
        if (this.x < pad) { this.x = pad; this.vx *= -1; this.strafeDir *= -1; }
        if (this.x > virtualSize - pad) { this.x = virtualSize - pad; this.vx *= -1; this.strafeDir *= -1; }
        if (this.y < pad) { this.y = pad; this.vy *= -1; this.strafeDir *= -1; }
        if (this.y > virtualSize - pad) { this.y = virtualSize - pad; this.vy *= -1; this.strafeDir *= -1; }

        for (let obs of obstacles) {
            let testX = this.x; let testY = this.y;
            if (this.x < obs.x) testX = obs.x; else if (this.x > obs.x + obs.w) testX = obs.x + obs.w;
            if (this.y < obs.y) testY = obs.y; else if (this.y > obs.y + obs.h) testY = obs.y + obs.h;
            
            let distance = Math.hypot(this.x - testX, this.y - testY);
            if (distance <= this.radius) {
                let overlap = this.radius - distance;
                if (distance === 0) distance = 1;
                let nx = (this.x - testX) / distance;
                let ny = (this.y - testY) / distance;
                this.x += nx * overlap; this.y += ny * overlap;
                let dot = this.vx * nx + this.vy * ny;
                if (dot < 0) { this.vx -= dot * nx; this.vy -= dot * ny; }
                if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 0.5; }
            }
        }

        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
            let canSee = true;
            for (let obs of obstacles) {
                if (lineIntersectsRect(this.x, this.y, enemy.x, enemy.y, obs)) { canSee = false; break; }
            }
            if (canSee || (this.aggression > 80 && Math.random() > 0.5)) {
                let inaccuracy = (1.0 - (this.aggression / 100)) * 0.15;
                let fireAngle = this.angle + (Math.random() * inaccuracy * 2 - inaccuracy);
                bullets.push(new Bullet(this.x + Math.cos(fireAngle)*20, this.y + Math.sin(fireAngle)*20, fireAngle, this.color, this.team));
                playSound(this.team === 'red' ? 'shoot_red' : 'shoot_blue');
                this.fireCooldown = this.fireDelay;
            }
        }
    }

    draw(ctx) {
        if (this.dead) return;
        ctx.shadowBlur = 15; ctx.shadowColor = this.color; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius - 4, 0, Math.PI * 2); ctx.fill();

        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.angle);
        ctx.fillStyle = this.color; ctx.fillRect(0, -4, 25, 8);
        ctx.fillStyle = '#fff'; ctx.fillRect(20, -2, 5, 4);
        ctx.restore();

        let hpPct = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = '#333'; ctx.fillRect(this.x - 20, this.y - 30, 40, 6);
        ctx.fillStyle = hpPct > 0.5 ? '#0f0' : (hpPct > 0.2 ? '#fa0' : '#f00');
        ctx.fillRect(this.x - 20, this.y - 30, 40 * hpPct, 6);
    }
}

class Bullet {
    constructor(x, y, angle, color, team) {
        this.x = x; this.y = y; this.speed = 400;
        this.vx = Math.cos(angle) * this.speed; this.vy = Math.sin(angle) * this.speed;
        this.color = color; this.team = team; this.dead = false; this.damage = 15; this.length = 12;
    }
    update(dt) {
        this.x += this.vx * dt; this.y += this.vy * dt;
        if (this.x < 0 || this.x > virtualSize || this.y < 0 || this.y > virtualSize) this.dead = true;
    }
    draw(ctx) {
        ctx.strokeStyle = '#fff'; ctx.shadowBlur = 10; ctx.shadowColor = this.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x - (this.vx/this.speed)*this.length, this.y - (this.vy/this.speed)*this.length); ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

class Particle {
    constructor(x, y, color, isExplosion=false) {
        this.x = x; this.y = y;
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * (isExplosion ? 250 : 80) + 20;
        this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed;
        this.color = color; this.life = 1.0; this.decay = Math.random() * 1.5 + 0.5; this.size = Math.random() * 4 + 2;
    }
    update(dt) {
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.vx *= 0.95; this.vy *= 0.95; this.life -= this.decay * dt;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life); ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size); ctx.globalAlpha = 1.0;
    }
}

function lineIntersectsRect(x1, y1, x2, y2, rect) {
    let minX = rect.x, maxX = rect.x + rect.w, minY = rect.y, maxY = rect.y + rect.h;
    if (Math.min(x1, x2) > maxX || Math.max(x1, x2) < minX || Math.min(y1, y2) > maxY || Math.max(y1, y2) < minY) return false;
    let steps = 10;
    for(let i=0; i<=steps; i++) {
        let t = i/steps, tx = x1 + (x2-x1)*t, ty = y1 + (y2-y1)*t;
        if(tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) return true;
    }
    return false;
}

function spawnParticles(x, y, color, amount, isExplosion) {
    for(let i=0; i<amount; i++) particles.push(new Particle(x, y, color, isExplosion));
}

function generateArena(level) {
    obstacles = [];
    if (level === 1) {
        const size = 60, inset = 90;
        obstacles.push({x: inset, y: inset, w: size, h: size});
        obstacles.push({x: virtualSize - inset - size, y: inset, w: size, h: size});
        obstacles.push({x: inset, y: virtualSize - inset - size, w: size, h: size});
        obstacles.push({x: virtualSize - inset - size, y: virtualSize - inset - size, w: size, h: size});
    } else if (level === 2) {
        const w = 240, h = 40, cx = virtualSize / 2 - w / 2;
        obstacles.push({x: cx, y: 150, w: w, h: h});
        obstacles.push({x: cx, y: virtualSize - 150 - h, w: w, h: h});
    } else if (level === 3) {
        const w = 120, h = 40;
        obstacles.push({x: virtualSize/2 - w/2, y: 100, w: w, h: h});
        obstacles.push({x: virtualSize/2 - w/2, y: virtualSize - 100 - h, w: w, h: h});
        obstacles.push({x: 100, y: virtualSize/2 - w/2, w: h, h: w});
        obstacles.push({x: virtualSize - 100 - h, y: virtualSize/2 - w/2, w: h, h: w});
    }
}

function abortMatch() {
    if (state === 'RUNNING') {
        state = 'ENDED';
        if(aiTimer) clearTimeout(aiTimer);
        btnStart.innerHTML = "▶ MATCH ABORTED - RESTART";
        btnStart.style.background = "#ef4444";
    }
}

// --- AI TACTICAL PULSE ---
async function fetchTacticalTurn(retryCount = 0) {
    if ((isFetching && retryCount === 0) || state !== 'RUNNING' || botRed.dead || botBlue.dead) return;
    isFetching = true;

    // Send the currently selected model
    const selectedModel = modelSelect.value;
    const gameState = {
        botRed: { hp: botRed.hp, x: Math.round(botRed.x), y: Math.round(botRed.y) },
        botBlue: { hp: botBlue.hp, x: Math.round(botBlue.x), y: Math.round(botBlue.y) }
    };

    if (retryCount === 0) addLog('SENT', { model: selectedModel, state: gameState });

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

        if (response.status === 429) {
            const waitTime = Math.pow(2, retryCount + 1) * 2000;
            addLog('ERROR', `Rate limited. Retrying in ${waitTime / 1000}s...`);
            aiTimer = setTimeout(() => fetchTacticalTurn(retryCount + 1), waitTime);
            return; 
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server returned status: ${response.status}`);
        }

        const actions = await response.json();
        addLog('RECV', { red: actions.botA.skill, blue: actions.botB.skill });

        if (actions.botA) botRed.applyAISkill(actions.botA.skill, actions.botA.stats);
        if (actions.botB) botBlue.applyAISkill(actions.botB.skill, actions.botB.stats);

    } catch (e) {
        addLog('ERROR', e.message);
    } finally {
        if (retryCount === 0) isFetching = false;
        
        if (state === 'RUNNING' && retryCount === 0) {
            aiTimer = setTimeout(() => fetchTacticalTurn(0), 6500); 
        }
    }
}

function startSimulation() {
    initAudio();
    if(aiTimer) clearTimeout(aiTimer);
    
    const cfgRed = {
        hp: parseFloat(document.getElementById('cfg-r-hp').value),
        speed: parseFloat(document.getElementById('cfg-r-spd').value),
    };
    const cfgBlue = {
        hp: parseFloat(document.getElementById('cfg-b-hp').value),
        speed: parseFloat(document.getElementById('cfg-b-spd').value),
    };
    const obsCount = parseInt(document.getElementById('cfg-a-obs').value);

    botRed = new Bot(50, virtualSize/2, '#ff0055', 'red', cfgRed);
    botBlue = new Bot(virtualSize-50, virtualSize/2, '#00e5ff', 'blue', cfgBlue);
    
    bullets = []; particles = [];
    generateArena(obsCount);

    overlay.classList.add('hidden');
    btnStart.innerHTML = "■ ABORT AI MATCH";
    btnStart.style.background = "#ef4444";
    
    state = 'RUNNING';
    
    fetchTacticalTurn(0);

    if (!lastTime) requestAnimationFrame(gameLoop);
}

btnOverlayStart.addEventListener('click', startSimulation);
btnStart.addEventListener('click', () => {
    if (state === 'INIT' || state === 'ENDED') startSimulation();
    else if (state === 'RUNNING') abortMatch();
});

function updateState(dt) {
    if (state !== 'RUNNING') return;

    botRed.update(dt, botBlue); botBlue.update(dt, botRed);

    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i]; b.update(dt);
        if (b.dead) { bullets.splice(i, 1); continue; }

        let hitWall = false;
        for(let obs of obstacles) {
            if (b.x >= obs.x && b.x <= obs.x + obs.w && b.y >= obs.y && b.y <= obs.y + obs.h) { hitWall = true; break; }
        }
        if (hitWall) { spawnParticles(b.x, b.y, '#fff', 5, false); bullets.splice(i, 1); continue; }

        const checkHit = (bot) => {
            if (!bot.dead && b.team !== bot.team) {
                if (Math.hypot(b.x - bot.x, b.y - bot.y) < bot.radius + 4) {
                    bot.hp -= b.damage; playSound('hit'); spawnParticles(b.x, b.y, b.color, 10, false); b.dead = true;
                    if (bot.hp <= 0) {
                        bot.hp = 0; bot.dead = true; playSound('explode'); spawnParticles(bot.x, bot.y, bot.color, 50, true);
                        state = 'ENDED';
                        if(aiTimer) clearTimeout(aiTimer);
                        if (bot.team === 'red') {
                            winsBlue++; document.getElementById('score-blue').innerText = `BLUE: ${winsBlue}`;
                            btnStart.innerHTML = "▶ BLUE WINS - RESTART"; btnStart.style.background = "linear-gradient(90deg, #111, #00e5ff)";
                        } else {
                            winsRed++; document.getElementById('score-red').innerText = `RED: ${winsRed}`;
                            btnStart.innerHTML = "▶ RED WINS - RESTART"; btnStart.style.background = "linear-gradient(90deg, #ff0055, #111)";
                        }
                    }
                }
            }
        };
        checkHit(botRed); if(b.dead) { bullets.splice(i, 1); continue; }
        checkHit(botBlue); if(b.dead) { bullets.splice(i, 1); continue; }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(dt); if (particles[i].life <= 0) particles.splice(i, 1);
    }
}

function draw() {
    ctx.fillStyle = 'rgba(10, 10, 16, 0.5)'; ctx.fillRect(0, 0, virtualSize, virtualSize);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1; ctx.beginPath();
    for(let x=0; x<virtualSize; x+=40) { ctx.moveTo(x, 0); ctx.lineTo(x, virtualSize); }
    for(let y=0; y<virtualSize; y+=40) { ctx.moveTo(0, y); ctx.lineTo(virtualSize, y); }
    ctx.stroke();

    ctx.fillStyle = '#111827'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
    for (let obs of obstacles) {
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h); ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.strokeRect(obs.x+2, obs.y+2, obs.w-4, obs.h-4);
    }

    if (state === 'RUNNING' || state === 'ENDED') {
        botRed.draw(ctx); botBlue.draw(ctx);
        for(let b of bullets) b.draw(ctx);
        for(let p of particles) p.draw(ctx);
    }
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    if (dt > 0.1) dt = 0.1; 
    lastTime = timestamp;
    updateState(dt); draw();
    requestAnimationFrame(gameLoop);
}
ctx.fillStyle = '#0a0a10'; ctx.fillRect(0, 0, virtualSize, virtualSize);