import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

export class EnemyBot {
    constructor(scene, model, startPos, scale = 1.0) {
        this.scene = scene;
        this.scale = scale;
        
        // --- 봇 모델 ---
        this.mesh = model.clone();
        this.mesh.traverse(c => { if(c.isMesh) c.castShadow = true; });
        this.scene.add(this.mesh);

        // --- 물리 충돌체 ---
        this.height = 1.75 * scale;
        this.radius = 0.3 * scale;
        this.collider = new Capsule(
            new THREE.Vector3(0, this.radius, 0),
            new THREE.Vector3(0, this.height - this.radius, 0),
            this.radius
        );
        this.collider.translate(startPos);
        
        // --- 이동/상태 변수 ---
        this.velocity = new THREE.Vector3();
        this.onFloor = false;
        this.walkSpeed = 5.0 * scale; // 플레이어보다 약간 느리게
        this.gravity = 30 * scale;
        
        // --- 사격 관련 ---
        this.lastShootTime = 0;
        this.shootInterval = 0.3; // 연사 속도 (초)
        this.reactionRange = 80 * scale; // 인식 거리
        this.raycaster = new THREE.Raycaster();

        // ★ 총알 관리 배열
        this.bullets = [];
        
        // 총알 지오메트리/재질 미리 생성 (성능 최적화)
        // 노란색으로 빛나는 긴 캡슐 형태 (트레이서 느낌)
        this.bulletGeo = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 0.8 * scale, 4);
        this.bulletGeo.rotateX(Math.PI / 2); // 앞뒤로 길게 회전
        this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    }

    update(delta, player, octree) {
        // 1. 중력 적용
        this.velocity.y -= this.gravity * delta;

        // 2. 플레이어 위치 파악
        const playerPos = player.playerCollider.start.clone();
        playerPos.y += player.currentEyeHeight - 0.5; // 가슴 조준

        const botHeadPos = this.collider.start.clone();
        botHeadPos.y += 1.6 * this.scale;

        const directionToPlayer = new THREE.Vector3().subVectors(playerPos, botHeadPos);
        const distance = directionToPlayer.length();
        directionToPlayer.normalize();

        // 3. 시야 체크
        let canSee = false;
        if (distance < this.reactionRange) {
            this.raycaster.set(botHeadPos, directionToPlayer);
            const hits = octree.rayIntersect(this.raycaster.ray);
            if (!hits || hits.distance > distance) {
                canSee = true;
            }
        }

        // 4. AI 행동
        if (canSee) {
            // 바라보기
            const lookTarget = new THREE.Vector3(playerPos.x, this.mesh.position.y, playerPos.z);
            this.mesh.lookAt(lookTarget);

            // 이동 (일정 거리 유지)
            if (distance > 15 * this.scale) {
                this.velocity.x = directionToPlayer.x * this.walkSpeed;
                this.velocity.z = directionToPlayer.z * this.walkSpeed;
            } else {
                this.velocity.x = 0;
                this.velocity.z = 0;
            }

            // 사격
            const now = performance.now() / 1000;
            if (now - this.lastShootTime > this.shootInterval) {
                this.shoot(botHeadPos, playerPos); // 머리 위치에서 발사
                this.lastShootTime = now;
            }
        } else {
            // 안 보이면 감속
            const friction = Math.exp(-10 * delta);
            this.velocity.x *= friction;
            this.velocity.z *= friction;
        }

        // 5. 물리 적용
        this.collider.translate(this.velocity.clone().multiplyScalar(delta));
        this.checkCollisions(octree);
        this.mesh.position.copy(this.collider.start).sub(new THREE.Vector3(0, this.radius, 0));

        // 6. ★ 총알 업데이트 (비행 및 충돌 체크)
        this.updateBullets(delta, player, octree);
    }

    shoot(startPos, targetPos) {
        // 총알 메쉬 생성
        const bullet = new THREE.Mesh(this.bulletGeo, this.bulletMat);
        
        // 발사 위치 (봇의 오른쪽 어깨 쯤에서 나가도록 조정)
        const rightOffset = new THREE.Vector3(0.5 * this.scale, 0, 0).applyQuaternion(this.mesh.quaternion);
        bullet.position.copy(startPos).add(rightOffset).add(new THREE.Vector3(0, -0.2, 0));
        
        bullet.lookAt(targetPos); // 목표물 바라보기
        this.scene.add(bullet);

        // 방향 벡터 (약간의 탄퍼짐 추가 가능)
        const dir = new THREE.Vector3().subVectors(targetPos, bullet.position).normalize();
        
        // 총알 속도
        const speed = 60 * this.scale; // 초속 60유닛 (매우 빠름)

        this.bullets.push({
            mesh: bullet,
            velocity: dir.multiplyScalar(speed),
            life: 2.0 // 2초 뒤 사라짐
        });
    }

    updateBullets(delta, player, octree) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            
            // 이동
            const moveStep = b.velocity.clone().multiplyScalar(delta);
            b.mesh.position.add(moveStep);
            b.life -= delta;

            // 1. 플레이어 충돌 체크 (거리 기반)
            // 총알이 너무 빠르면 터널링(관통) 현상이 생길 수 있으므로 레이캐스팅이 정확하지만, 
            // 여기서는 간단히 플레이어 캡슐과의 거리로 체크합니다.
            const playerCenter = player.playerCollider.start.clone().add(new THREE.Vector3(0, player.playerHeight/2, 0));
            const distToPlayer = b.mesh.position.distanceTo(playerCenter);

            if (distToPlayer < 0.6 * this.scale) { // 플레이어 반경 + 총알 크기
                player.takeDamage(10); // 데미지 10
                this.removeBullet(i);
                continue;
            }

            // 2. 벽 충돌 체크 (Octree) - 옵션
            // 성능을 위해 생략 가능하지만, 벽 뚫는게 싫다면 레이캐스트 추가
            // 간단하게는 수명(life)으로만 제거해도 됩니다.

            // 3. 수명 종료 제거
            if (b.life <= 0) {
                this.removeBullet(i);
            }
        }
    }

    removeBullet(index) {
        const b = this.bullets[index];
        this.scene.remove(b.mesh); // 씬에서 제거
        // 메모리 해제 (필요시)
        if(b.mesh.geometry) b.mesh.geometry.dispose(); 
        this.bullets.splice(index, 1); // 배열에서 제거
    }

    checkCollisions(octree) {
        this.onFloor = false;
        const result = octree.capsuleIntersect(this.collider);
        if (result) {
            this.onFloor = result.normal.y > 0;
            if (!this.onFloor) {
                this.velocity.addScaledVector(result.normal, -result.normal.dot(this.velocity));
            } else {
                if(this.velocity.y < 0) this.velocity.y = 0;
            }
            this.collider.translate(result.normal.multiplyScalar(result.depth));
        }
    }
}