import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { CS2Player } from './CS2Player.js';
import { EnemyBot } from './EnemyBot.js';

const GLOBAL_SCALE = 0.2; 

// --- 스폰 좌표 설정 ---
const T_SPAWN  = { x: -11.75 * GLOBAL_SCALE, y: 80 * GLOBAL_SCALE, z: 14 * GLOBAL_SCALE }; 

// ★ [수정됨] 사용자가 지정한 CT 좌표 (6, 38) 적용
const CT_SPAWN = { x: 6 * GLOBAL_SCALE, y: 80 * GLOBAL_SCALE, z: 38 * GLOBAL_SCALE };

// --- 씬 구성 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88ccff);
scene.fog = new THREE.Fog(0x88ccff, 20 * GLOBAL_SCALE, 150 * GLOBAL_SCALE);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(50, 150, 50);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// --- 탄흔 시스템 ---
const decalGeo = new THREE.PlaneGeometry(0.15 * GLOBAL_SCALE, 0.15 * GLOBAL_SCALE);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: -1 });
const decals = [];

function createBulletHole(pos, normal) {
    if(!pos) return;
    const decal = new THREE.Mesh(decalGeo, decalMat);
    decal.position.copy(pos);
    decal.lookAt(pos.clone().add(normal));
    scene.add(decal);
    decals.push(decal);
    if(decals.length > 50) scene.remove(decals.shift());
}

// 킬 피드 함수
function addKillFeed(killer, victim, weapon) {
    const feed = document.getElementById('kill-feed');
    if(!feed) return;
    const msg = document.createElement('div');
    msg.className = 'kill-msg';
    msg.innerHTML = `${killer} <span style="color:#de9b35">︻デ═一</span> ${victim}`;
    feed.appendChild(msg);
    setTimeout(() => {
        msg.style.opacity = '0';
        setTimeout(() => msg.remove(), 500);
    }, 4000);
}

// --- 로딩 매니저 ---
const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (url, loaded, total) => {
    const p = (loaded / total) * 100;
    const bar = document.getElementById('progress-bar');
    if(bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-text');
    if(txt) txt.innerText = Math.round(p) + '%';
};

loadingManager.onLoad = () => {
    document.getElementById('loading-screen').style.display = 'none';
    setTimeout(() => {
        player.teleport(T_SPAWN.x, T_SPAWN.y, T_SPAWN.z);
        console.log("Game Start!");
    }, 100);
};

// --- 텍스처 로드 ---
const texLoader = new THREE.TextureLoader(loadingManager);
const tPath = '/models/texture/';
const headTex = texLoader.load(encodeURI(tPath + 'ctm_sas_head_gasmask_color_psd_52d38e2c_11.png'));
const bodyTex = texLoader.load(encodeURI(tPath + 'ctm_sas_body_ao_psd_4476562_orm_494401633_7@channels=G.png'));
const legsTex = texLoader.load(encodeURI(tPath + 'ctm_sas_legs_ao_psd_526cc0d3_orm_2499892785_4@channels=R.png'));
const gloveTex = texLoader.load(encodeURI(tPath + 'glove_hardknuckle_ao_psd_5be17a0d_orm_2084722161_1@channels=.png'));
[headTex, bodyTex, legsTex, gloveTex].forEach(t => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; });

// --- 모델 로드 ---
const loader = new GLTFLoader(loadingManager);
const worldOctree = new Octree();

loader.load('/models/de_dust2.glb', (gltf) => {
    const map = gltf.scene;
    map.scale.set(GLOBAL_SCALE, GLOBAL_SCALE, GLOBAL_SCALE);
    scene.add(map);
    worldOctree.fromGraphNode(map);
    map.traverse(c => { 
        if(c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.material.side = THREE.DoubleSide; } 
    });
});

let bot = null;

loader.load('/models/sas_blue.glb', (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = (1.75 * GLOBAL_SCALE) / size.y;
    model.scale.set(s, s, s);

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            const n = child.name.toLowerCase();
            if (n.includes('head') || n.includes('mask') || n.includes('face') || n.includes('lens') || n.includes('glass') || n.includes('helmet') || n.includes('visor')) {
                child.visible = false;
                child.material.transparent = true;
                child.material.opacity = 0;
            } else {
                if (n.includes('body')) child.material.map = bodyTex;
                else if (n.includes('leg') || n.includes('pant')) child.material.map = legsTex;
                else if (n.includes('glove') || n.includes('hand')) child.material.map = gloveTex;
                child.material.needsUpdate = true;
            }
        }
    });

    const playerVisual = model.clone();
    scene.add(playerVisual);
    window.playerVisual = playerVisual; 

    // ★ 봇 생성 (지정한 CT 좌표 사용)
    const startPos = new THREE.Vector3(CT_SPAWN.x, CT_SPAWN.y, CT_SPAWN.z);
    bot = new EnemyBot(scene, model, startPos, GLOBAL_SCALE);
});

// --- 플레이어 ---
const player = new CS2Player(camera, document.body, loadingManager, GLOBAL_SCALE);

player.onShootCallback = () => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const hit = worldOctree.rayIntersect(raycaster.ray);
    if(hit && hit.distance < 100 * GLOBAL_SCALE) {
        createBulletHole(hit.point, hit.normal); 
        
        if(bot) {
            const botPos = bot.collider.start;
            const dist = hit.point.distanceTo(botPos);
            // 봇 피격 범위 (0.6m)
            if(dist < 0.6 * GLOBAL_SCALE) {
                console.log("Enemy Hit!");
                scene.remove(bot.mesh);
                bot.bullets.forEach(b => scene.remove(b.mesh));
                bot = null;
                
                addKillFeed('Player', 'Bot_Albert', 'ak47');
                player.money += 300;
                player.updateMoneyUI();
            }
        }
    }
};

// --- 구매 메뉴 및 UI 로직 ---
const buyMenu = document.getElementById('buy-menu');
let isBuyMenuOpen = false;

window.buyItem = (item, price) => {
    if (player.buyWeapon(item, price)) {
        closeBuyMenu();
    } else {
        alert("Not enough money!");
    }
};

function openBuyMenu() {
    isBuyMenuOpen = true;
    buyMenu.style.display = 'block';
    player.updateMoneyUI();
    document.exitPointerLock();
}

function closeBuyMenu() {
    isBuyMenuOpen = false;
    buyMenu.style.display = 'none';
    player.controls.lock();
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyB') isBuyMenuOpen ? closeBuyMenu() : openBuyMenu();
    if (e.code === 'Escape' && isBuyMenuOpen) closeBuyMenu();
});

document.addEventListener('click', () => {
    if (!isBuyMenuOpen && !player.controls.isLocked) {
        player.controls.lock();
        document.getElementById('ui-layer').style.display = 'block';
    }
});

const clock = new THREE.Clock();
const STEPS = 5;

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(0.05, clock.getDelta()) / STEPS;

    if (!isBuyMenuOpen) {
        for (let i = 0; i < STEPS; i++) {
            player.update(delta, worldOctree);
            if (bot) bot.update(delta, player, worldOctree);
        }
    }

    if (window.playerVisual) {
        window.playerVisual.position.copy(player.playerCollider.start).sub(new THREE.Vector3(0, player.playerCollider.radius, 0));
        const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
        window.playerVisual.rotation.y = Math.atan2(dir.x, dir.z);
    }

    // 좌표 표시 (디버그)
    const debugDiv = document.getElementById('debug-coords');
    if (debugDiv) {
        const rawX = (player.playerCollider.start.x / GLOBAL_SCALE).toFixed(2);
        const rawZ = (player.playerCollider.start.z / GLOBAL_SCALE).toFixed(2);
        debugDiv.innerText = `POS: X=${rawX}, Z=${rawZ}`;
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();