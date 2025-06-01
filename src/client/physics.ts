import * as THREE from 'three';
import { CarPhysics, Vector3D } from '../types/game';

// Helper interface for bounding box collision detection
interface CarBoundingBox {
    box: THREE.Box3;
    center: THREE.Vector3;
    size: THREE.Vector3;
    rotation: number;
    scale: THREE.Vector3;
}

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

        // Add small acceleration when turning without pressing forward/backward
        if (this.physics.acceleration === 0) {
            if (keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight']) {
                this.physics.acceleration = this.physics.power * 0.3; // 20% of normal power when turning
            }
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

        // Safeguard: Ensure Y velocity is always 0 (cars don't fly)
        velocity.y = 0;

        // Update velocity
        this.physics.velocity = {
            x: velocity.x,
            y: 0, // Always keep Y velocity at 0
            z: velocity.z
        };

        // Apply movement
        car.position.add(velocity.clone().multiplyScalar(deltaTime));
        
        // Safeguard: Ensure car stays at ground level
        car.position.y = 0;

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

    public setVelocity(velocity: Vector3D): void {
        this.physics.velocity = { ...velocity };
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

/**
 * Computes the bounding box for a car model, accounting for scale and rotation
 */
export function computeCarBoundingBox(car: THREE.Group): CarBoundingBox {
    const box = new THREE.Box3();
    
    // Get the original bounding box of the model
    box.setFromObject(car);
    
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    return {
        box: box,
        center: center,
        size: size,
        rotation: car.rotation.y,
        scale: car.scale.clone()
    };
}

/**
 * Checks if two oriented bounding boxes (OBBs) are colliding
 */
export function checkOBBCollision(carA: THREE.Group, carB: THREE.Group): boolean {
    const bboxA = computeCarBoundingBox(carA);
    const bboxB = computeCarBoundingBox(carB);
    
    // Get positions
    const posA = carA.position.clone();
    const posB = carB.position.clone();
    
    // Calculate distance between centers
    const distance = posA.distanceTo(posB);
    
    // Quick sphere check first (optimization)
    const maxRadiusA = Math.max(bboxA.size.x, bboxA.size.z) * 0.5;
    const maxRadiusB = Math.max(bboxB.size.x, bboxB.size.z) * 0.5;
    
    if (distance > (maxRadiusA + maxRadiusB)) {
        return false; // Too far apart
    }
    
    // For now, use expanded AABB collision with rotation consideration
    // This is more accurate than simple radius but not as complex as full OBB
    return checkRotatedAABBCollision(carA, carB, bboxA, bboxB);
}

/**
 * Simplified rotated AABB collision detection
 */
function checkRotatedAABBCollision(
    carA: THREE.Group, 
    carB: THREE.Group, 
    bboxA: CarBoundingBox, 
    bboxB: CarBoundingBox
): boolean {
    // Create corners of both bounding boxes in world space
    const cornersA = getWorldSpaceCorners(carA, bboxA);
    const cornersB = getWorldSpaceCorners(carB, bboxB);
    
    // Use separating axis theorem (SAT) for 2D (we ignore Y axis for car collision)
    const axesToTest = [
        new THREE.Vector3(Math.cos(carA.rotation.y), 0, Math.sin(carA.rotation.y)), // CarA forward
        new THREE.Vector3(-Math.sin(carA.rotation.y), 0, Math.cos(carA.rotation.y)), // CarA right
        new THREE.Vector3(Math.cos(carB.rotation.y), 0, Math.sin(carB.rotation.y)), // CarB forward
        new THREE.Vector3(-Math.sin(carB.rotation.y), 0, Math.cos(carB.rotation.y))  // CarB right
    ];
    
    for (const axis of axesToTest) {
        if (!isOverlapping(cornersA, cornersB, axis)) {
            return false; // Found separating axis, no collision
        }
    }
    
    return true; // No separating axis found, collision detected
}

/**
 * Get world space corners of a car's bounding box
 */
function getWorldSpaceCorners(car: THREE.Group, bbox: CarBoundingBox): THREE.Vector3[] {
    const halfSize = bbox.size.clone().multiplyScalar(0.5);
    
    // Local space corners (4 corners for 2D collision, ignoring Y)
    const localCorners = [
        new THREE.Vector3(-halfSize.x, 0, -halfSize.z),
        new THREE.Vector3(halfSize.x, 0, -halfSize.z),
        new THREE.Vector3(halfSize.x, 0, halfSize.z),
        new THREE.Vector3(-halfSize.x, 0, halfSize.z)
    ];
    
    // Transform to world space
    const worldCorners: THREE.Vector3[] = [];
    for (const corner of localCorners) {
        // Apply rotation and position
        corner.applyQuaternion(car.quaternion);
        corner.add(car.position);
        worldCorners.push(corner);
    }
    
    return worldCorners;
}

/**
 * Check if two sets of points overlap when projected onto an axis
 */
function isOverlapping(cornersA: THREE.Vector3[], cornersB: THREE.Vector3[], axis: THREE.Vector3): boolean {
    // Project all corners onto the axis
    const projectionsA = cornersA.map(corner => corner.dot(axis));
    const projectionsB = cornersB.map(corner => corner.dot(axis));
    
    // Find min and max projections for each set
    const minA = Math.min(...projectionsA);
    const maxA = Math.max(...projectionsA);
    const minB = Math.min(...projectionsB);
    const maxB = Math.max(...projectionsB);
    
    // Check for overlap
    return !(maxA < minB || maxB < minA);
}

/**
 * Enhanced collision resolution using actual model data
 */
export function resolveCarCollision(carA: THREE.Group, carB: THREE.Group, velocityA: THREE.Vector3, velocityB: THREE.Vector3) {
    const bboxA = computeCarBoundingBox(carA);
    const bboxB = computeCarBoundingBox(carB);
    
    // Calculate collision normal ONLY in horizontal plane (X-Z) to keep cars on ground
    const posA = carA.position.clone();
    const posB = carB.position.clone();
    
    // Force Y to be the same for collision normal calculation
    posA.y = 0;
    posB.y = 0;
    
    const collisionNormal = posA.sub(posB).normalize();
    
    // If collision normal is zero (cars at exact same position), use a default normal
    if (collisionNormal.length() === 0) {
        collisionNormal.set(1, 0, 0); // Default to X direction
    }
    
    // Ensure collision normal only affects X and Z, never Y
    collisionNormal.y = 0;
    collisionNormal.normalize();
    
    // Create 2D velocity vectors (remove Y component for collision calculation)
    const velocity2DA = new THREE.Vector3(velocityA.x, 0, velocityA.z);
    const velocity2DB = new THREE.Vector3(velocityB.x, 0, velocityB.z);
    
    // Calculate relative velocity in 2D
    const relativeVelocity = velocity2DA.clone().sub(velocity2DB);
    const velocityAlongNormal = relativeVelocity.dot(collisionNormal);
    
    // Don't resolve if objects are moving apart
    if (velocityAlongNormal > 0) return;
    
    // Calculate restitution (bounciness) - reduced for more realistic car behavior
    const restitution = 0.3;
    
    // Calculate impulse scalar
    const impulseScalar = -(1 + restitution) * velocityAlongNormal;
    
    // Apply impulse ONLY to X and Z components
    const impulse = collisionNormal.clone().multiplyScalar(impulseScalar);
    velocityA.x += impulse.x;
    velocityA.z += impulse.z;
    // velocityA.y stays unchanged to preserve ground contact
    
    velocityB.x -= impulse.x;
    velocityB.z -= impulse.z;
    // velocityB.y stays unchanged to preserve ground contact
    
    // Calculate proper separation distance using actual bounding box sizes
    const separationDistance = (Math.max(bboxA.size.x, bboxA.size.z) + Math.max(bboxB.size.x, bboxB.size.z)) * 0.25;
    
    // Calculate current distance in 2D only
    const currentDistance2D = Math.sqrt(
        Math.pow(carA.position.x - carB.position.x, 2) + 
        Math.pow(carA.position.z - carB.position.z, 2)
    );
    
    const overlap = Math.max(0, separationDistance - currentDistance2D);
    
    if (overlap > 0) {
        const separation = collisionNormal.clone().multiplyScalar(overlap * 0.5);
        
        // Store original Y positions
        const originalYA = carA.position.y;
        const originalYB = carB.position.y;
        
        // Apply separation ONLY in X and Z
        carA.position.x += separation.x;
        carA.position.z += separation.z;
        // Restore Y position
        carA.position.y = originalYA;
        
        carB.position.x -= separation.x;
        carB.position.z -= separation.z;
        // Restore Y position
        carB.position.y = originalYB;
    }
    
    // Add some rotation based on collision impact and car sizes
    const impactStrength = Math.min(Math.abs(velocityAlongNormal), 10); // Limit rotation impact
    const rotationFactorA = impactStrength * 0.02;
    const rotationFactorB = impactStrength * 0.02;
    
    // Apply rotation based on collision angle (only Y rotation for cars)
    const collisionAngle = Math.atan2(collisionNormal.z, collisionNormal.x);
    carA.rotation.y += Math.sin(collisionAngle) * rotationFactorA;
    carB.rotation.y -= Math.sin(collisionAngle) * rotationFactorB;
}