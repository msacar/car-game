import * as THREE from 'three';
import { CarPhysics, Vector3D } from '../types/game';

export class CarPhysicsEngine {
    private physics: CarPhysics;

    constructor() {
        this.physics = {
            velocity: { x: 0, y: 0, z: 0 },
            acceleration: 0,
            maxSpeed: 80,
            turnSpeed: 0,
            maxTurnSpeed: 2,
            friction: 0.95,
            power: 1.2,
            reverse: 0.4,
            turnDecay: 0.9
        };
    }

    public updatePhysics(
        car: THREE.Group,
        keys: { [key: string]: boolean },
        deltaTime: number
    ): void {
        // Reset acceleration
        this.physics.acceleration = 0;

        // Handle input
        if (keys['KeyW'] || keys['ArrowUp']) {
            this.physics.acceleration = this.physics.power;
        }
        if (keys['KeyS'] || keys['ArrowDown']) {
            this.physics.acceleration = -this.physics.reverse;
        }

        // Get current velocity
        const velocity = new THREE.Vector3(
            this.physics.velocity.x,
            this.physics.velocity.y,
            this.physics.velocity.z
        );

        // Turning (only when moving)
        if (Math.abs(velocity.length()) > 0.1) {
            if (keys['KeyA'] || keys['ArrowLeft']) {
                // LEFT - positive turn speed
                this.physics.turnSpeed = Math.min(
                    this.physics.turnSpeed + 0.1,
                    this.physics.maxTurnSpeed
                );
            } else if (keys['KeyD'] || keys['ArrowRight']) {
                // RIGHT - negative turn speed
                this.physics.turnSpeed = Math.max(
                    this.physics.turnSpeed - 0.1,
                    -this.physics.maxTurnSpeed
                );
            } else {
                this.physics.turnSpeed *= this.physics.turnDecay;
            }
        } else {
            this.physics.turnSpeed = 0;
        }

        // Handbrake
        if (keys['Space']) {
            velocity.multiplyScalar(0.95);
            this.physics.velocity = {
                x: velocity.x,
                y: velocity.y,
                z: velocity.z
            };
        }

        // Apply physics
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(car.quaternion);

        // Apply acceleration
        const accelerationVector = forward
            .clone()
            .multiplyScalar(this.physics.acceleration * deltaTime * 60);

        velocity.add(accelerationVector);

        // Apply friction
        velocity.multiplyScalar(this.physics.friction);

        // Limit speed
        if (velocity.length() > this.physics.maxSpeed) {
            velocity.normalize().multiplyScalar(this.physics.maxSpeed);
        }

        // Update velocity
        this.physics.velocity = {
            x: velocity.x,
            y: velocity.y,
            z: velocity.z
        };

        // Apply movement
        car.position.add(velocity.clone().multiplyScalar(deltaTime));

        // Apply rotation - FIXED
        const speed = velocity.length();

        // Better backward detection using dot product
        const forward_normalized = forward.normalize();
        const velocity_normalized = velocity.clone().normalize();
        const movingBackward = forward_normalized.dot(velocity_normalized) < 0;

        if (speed > 0.1) {
            if (movingBackward) {
                // When moving backward, invert steering
                car.rotation.y -= this.physics.turnSpeed * deltaTime;
            } else {
                // Normal forward steering
                car.rotation.y += this.physics.turnSpeed * deltaTime;
            }
        }
    }

    public getVelocity(): Vector3D {
        return { ...this.physics.velocity };
    }

    public getSpeed(): number {
        const velocity = new THREE.Vector3(
            this.physics.velocity.x,
            this.physics.velocity.y,
            this.physics.velocity.z
        );
        return velocity.length();
    }
}

function resolveCarCollision(carA: THREE.Group, carB: THREE.Group, velocityA: THREE.Vector3, velocityB: THREE.Vector3) {
    const direction = carA.position.clone().sub(carB.position).normalize();
    const overlap = Math.max(0, (carA.position.distanceTo(carB.position) - 2.0)); // 2 = sum of car radii

    // Separate the cars by moving them away from each other
    carA.position.add(direction.clone().multiplyScalar(overlap / 2));
    carB.position.add(direction.clone().negate().multiplyScalar(overlap / 2));

    // Exchange velocities (naive "bounce" approach)
    const tempVelocity = velocityA.clone();
    velocityA.copy(velocityB);
    velocityB.copy(tempVelocity);
}