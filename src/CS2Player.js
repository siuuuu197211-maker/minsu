import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export class CS2Player {
    constructor(camera, domElement, loadingManager, worldScale = 1.0) {
        this.camera = camera;
        this.domElement = domElement;
        this.loadingManager = loadingManager;
        this.worldScale = worldScale;
        this.controls = new PointerLockControls(camera, domElement);

        // --- 플레이어 스펙 ---
        this.playerHeight = 1.75 * worldScale;
        this.radius = 0.3 * worldScale;
        this.standEyeHeight = 1.60 * worldScale;
        this.crouchEyeHeight = 1.10 * worldScale;
        this.currentEyeHeight = this.standEyeHeight;

        this.playerCollider = new Capsule(
            new THREE.Vector3(0, this.radius, 0),
            new THREE.Vector3(0, this.playerHeight - this.radius, 0),
            this.radius
        );

        // --- 물리 변수 ---
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.onFloor = false;
        this.isCrouching = false;
        this.gravity = 30 * worldScale;
        this.jumpForce = 10 * worldScale;
        this.walkSpeed = 8 * worldScale;
        this.crouchSpeed = 4 * worldScale;
        this.flyMode = false;

        // --- 게임 시스템 ---
        this.health = 100;
        this.isDead = false;
        this.money = 800;
        this.hasWeapon = false;
        this.ammo = 0;
        this.maxAmmo = 0;
        this.isReloading = false;
        
        this.weaponMesh = null;
        this.weaponBasePos = new THREE.Vector3(0.25 * worldScale, -0.35 * worldScale, -0.6 * worldScale); // 기준 위치
        this.keyStates = {};

        // ★ [추가] 무기 흔들림(Sway) 변수
        this.moveSway = new THREE.Vector2(0, 0); // 마우스 이동량
        this.bobTimer = 0; // 걸음 타이머

        this.initInputs();
        this.preloadWeapon();
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.health -= amount;
        const hitEffect = document.getElementById('ui-layer');
        hitEffect.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
        setTimeout(() => { hitEffect.style.backgroundColor = 'transparent'; }, 100);
        if (this.health <= 0) { this.health = 0; this.die(); }
        this.updateHealthUI();
    }

    die() {
        this.isDead = true;
        alert("YOU DIED! Game Over.");
        location.reload();
    }

    updateHealthUI() {
        const hText = document.getElementById('health-text');
        if(hText) hText.innerText = this.health;
    }

    preloadWeapon() {
        const objLoader = new OBJLoader(this.loadingManager);
        const texLoader = new THREE.TextureLoader(this.loadingManager);
        const texture = texLoader.load('/models/texture/ak-47.png');
        texture.colorSpace = THREE.SRGBColorSpace;

        objLoader.load('/models/ak-47.obj', (root) => {
            const weapon = root;
            weapon.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.material = new THREE.MeshStandardMaterial({
                        map: texture, roughness: 0.5, metalness: 0.6
                    });
                }
            });
            const s = 0.035 * this.worldScale; 
            weapon.scale.set(s, s, s);
            
            // 초기 위치 설정
            weapon.position.copy(this.weaponBasePos);
            weapon.rotation.set(0, Math.PI, 0);
            
            this.muzzleLight = new THREE.PointLight(0xffaa00, 0, 5 * this.worldScale);
            this.muzzleLight.position.set(0, 5, 25); 
            weapon.add(this.muzzleLight);

            this.camera.add(weapon);
            this.weaponMesh = weapon;
            this.weaponMesh.visible = false; 
        });
    }

    buyWeapon(weaponName, price) {
        if (this.money >= price) {
            this.money -= price;
            this.updateMoneyUI();
            if (weaponName === 'ak47') this.equipAK47();
            return true;
        }
        return false;
    }

    equipAK47() {
        if (this.weaponMesh) {
            this.weaponMesh.visible = true;
            this.hasWeapon = true;
            this.ammo = 30;
            this.maxAmmo = 90;
            this.updateAmmoUI();
        }
    }

    updateMoneyUI() {
        document.getElementById('money-text').innerText = `$ ${this.money}`;
        const menuMoney = document.getElementById('menu-money');
        if(menuMoney) menuMoney.innerText = `$ ${this.money}`;
    }

    updateAmmoUI() {
        if (this.hasWeapon) {
            document.getElementById('ammo-text').innerText = this.ammo;
            document.getElementById('ammo-sub').innerText = `/ ${this.maxAmmo}`;
        } else {
            document.getElementById('ammo-text').innerText = "--";
            document.getElementById('ammo-sub').innerText = "/ --";
        }
    }

    initInputs() {
        document.addEventListener('keydown', (e) => {
            this.keyStates[e.code] = true;
            if (e.code === 'Space') {
                if(this.flyMode) this.velocity.y = this.jumpForce;
                else if(this.onFloor && !this.isCrouching) this.velocity.y = this.jumpForce;
            }
            if (e.code === 'ControlLeft') this.isCrouching = true;
            if (e.code === 'KeyR') this.reload();
            if (e.code === 'F1') { this.money += 1000; this.updateMoneyUI(); }
        });
        document.addEventListener('keyup', (e) => {
            this.keyStates[e.code] = false;
            if (e.code === 'Space' && this.flyMode) this.velocity.y = 0;
            if (e.code === 'ControlLeft') this.isCrouching = false;
        });
        document.addEventListener('mousedown', () => {
            if (this.controls.isLocked && this.hasWeapon) this.shoot();
        });

        // ★ [추가] 마우스 이동 감지 (Sway 효과용)
        document.addEventListener('mousemove', (e) => {
            if (this.controls.isLocked) {
                // 부드러운 이동을 위해 값 누적
                this.moveSway.x += e.movementX;
                this.moveSway.y += e.movementY;
            }
        });
    }

    shoot() {
        if (!this.weaponMesh || this.ammo <= 0 || this.isReloading || !this.hasWeapon) return;
        this.ammo--;
        this.updateAmmoUI();
        this.muzzleLight.intensity = 2;
        setTimeout(() => { if(this.muzzleLight) this.muzzleLight.intensity = 0; }, 50);

        // 반동 (Recoil) - 화면과 총기 모두 튐
        this.weaponMesh.position.z += 0.15 * this.worldScale; 
        this.weaponMesh.rotation.x += 0.1; 
        this.camera.rotation.x += 0.01; 
        this.moveSway.y += 20; // 반동으로 에임 위로 튐

        if (this.onShootCallback) this.onShootCallback();
        
        // 크로스헤어 벌어짐 효과
        const chH = document.querySelector('.ch-h');
        const chV = document.querySelector('.ch-v');
        if(chH && chV) {
            chH.style.width = '20px'; chV.style.height = '20px';
            setTimeout(() => { chH.style.width = '10px'; chV.style.height = '10px'; }, 100);
        }
    }

    reload() {
        if (this.isReloading || this.ammo === 30 || !this.hasWeapon) return;
        this.isReloading = true;
        const oldRot = this.weaponMesh.rotation.x;
        this.weaponMesh.rotation.x -= 0.8; // 총 내림
        setTimeout(() => {
            this.ammo = 30;
            this.updateAmmoUI();
            this.weaponMesh.rotation.x = oldRot;
            this.isReloading = false;
        }, 1500);
    }

    teleport(x, y, z) {
        this.playerCollider.start.set(0, this.radius, 0);
        this.playerCollider.end.set(0, this.playerHeight - this.radius, 0);
        this.playerCollider.translate(new THREE.Vector3(x, y, z));
        this.velocity.set(0, 0, 0);
        this.updateCamera();
    }

    // ★ [핵심] 무기 애니메이션 업데이트
    updateWeaponAnimation(delta, isMoving) {
        if (!this.weaponMesh || this.isReloading) return;

        // 1. Sway (지연 효과)
        // 마우스 움직임 값을 부드럽게 감쇠
        const swayForce = 0.0002;
        const maxSway = 0.05;
        
        let targetX = -this.moveSway.x * swayForce;
        let targetY = this.moveSway.y * swayForce;

        // 제한 (너무 많이 돌아가지 않게)
        targetX = Math.max(-maxSway, Math.min(maxSway, targetX));
        targetY = Math.max(-maxSway, Math.min(maxSway, targetY));

        // 부드럽게 복귀
        this.moveSway.x -= this.moveSway.x * 10 * delta;
        this.moveSway.y -= this.moveSway.y * 10 * delta;

        // 2. Bobbing (걷는 모션)
        let bobX = 0;
        let bobY = 0;
        if (isMoving && this.onFloor) {
            const bobSpeed = 10;
            const bobAmount = 0.005 * this.worldScale;
            this.bobTimer += delta * bobSpeed;
            bobX = Math.cos(this.bobTimer) * bobAmount;
            bobY = Math.abs(Math.sin(this.bobTimer)) * bobAmount * 2;
        } else {
            // 멈추면 호흡 모션 (천천히)
            this.bobTimer += delta * 1;
            bobY = Math.sin(this.bobTimer) * 0.001 * this.worldScale;
        }

        // 최종 위치 적용 (Lerp)
        const targetPos = this.weaponBasePos.clone();
        targetPos.x += targetX + bobX;
        targetPos.y += targetY + bobY;
        
        // 뒤로 밀린 반동 회복
        if(this.weaponMesh.position.z > this.weaponBasePos.z) {
            targetPos.z = this.weaponMesh.position.z - (this.weaponMesh.position.z - this.weaponBasePos.z) * 10 * delta;
        }

        this.weaponMesh.position.lerp(targetPos, 10 * delta);
        
        // 회전 Sway (Z축 기울기)
        const targetRotZ = targetX * 2; 
        const currentRot = this.weaponMesh.rotation.clone();
        // X축 회전(반동) 회복
        const targetRotX = (this.isReloading ? -0.8 : 0);
        
        this.weaponMesh.rotation.z += (targetRotZ - this.weaponMesh.rotation.z) * 5 * delta;
        this.weaponMesh.rotation.x += (targetRotX - this.weaponMesh.rotation.x) * 10 * delta;
    }

    update(delta, worldOctree) {
        if (!this.controls.isLocked) return;

        const targetEyeH = this.isCrouching ? this.crouchEyeHeight : this.standEyeHeight;
        this.currentEyeHeight += (targetEyeH - this.currentEyeHeight) * 15 * delta;

        if(!this.flyMode) this.velocity.y -= this.gravity * delta;

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        if(!this.flyMode) { forward.y = 0; right.y = 0; }
        forward.normalize(); right.normalize();

        this.direction.set(0, 0, 0);
        if (this.keyStates['KeyW']) this.direction.add(forward);
        if (this.keyStates['KeyS']) this.direction.sub(forward);
        if (this.keyStates['KeyD']) this.direction.add(right);
        if (this.keyStates['KeyA']) this.direction.sub(right);
        this.direction.normalize();

        const speed = this.flyMode ? 20 * this.worldScale : (this.isCrouching ? this.crouchSpeed : this.walkSpeed);
        const isMoving = this.direction.lengthSq() > 0; // 움직이는 중인지 체크

        // ★ [추가] 크로스헤어 벌어짐 (움직일 때)
        const chH = document.querySelector('.ch-h');
        const chV = document.querySelector('.ch-v');
        if(chH && chV) {
            const gap = isMoving ? '18px' : '10px';
            if(chH.style.width !== gap) {
                chH.style.width = gap; chV.style.height = gap;
            }
        }

        if (this.onFloor || this.flyMode) {
            if (isMoving) {
                this.velocity.x = this.direction.x * speed;
                this.velocity.z = this.direction.z * speed;
                if(this.flyMode) this.velocity.y = this.direction.y * speed;
            } else {
                const friction = Math.exp(-40 * delta);
                this.velocity.x *= friction;
                this.velocity.z *= friction;
                if(this.flyMode) this.velocity.y *= friction;
            }
        } else {
            this.velocity.x += this.direction.x * speed * delta * 2;
            this.velocity.z += this.direction.z * speed * delta * 2;
        }

        this.playerCollider.translate(this.velocity.clone().multiplyScalar(delta));
        if (!this.flyMode && worldOctree) this.playerCollisions(worldOctree);
        
        this.updateCamera();
        
        // ★ 무기 애니메이션 호출
        this.updateWeaponAnimation(delta, isMoving);
    }

    updateCamera() {
        const footY = this.playerCollider.start.y - this.radius;
        this.camera.position.set(this.playerCollider.start.x, footY + this.currentEyeHeight, this.playerCollider.start.z);
    }

    playerCollisions(worldOctree) {
        this.onFloor = false;
        const result = worldOctree.capsuleIntersect(this.playerCollider);
        if (result) {
            this.onFloor = result.normal.y > 0;
            if (!this.onFloor) this.velocity.addScaledVector(result.normal, -result.normal.dot(this.velocity));
            else if (this.velocity.y < 0) this.velocity.y = 0;
            this.playerCollider.translate(result.normal.multiplyScalar(result.depth));
        }
    }
}