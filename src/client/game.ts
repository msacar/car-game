// Import Three.js and GLTFLoader
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Make Three.js and GLTFLoader available globally
(window as any).THREE = THREE;
(window as any).GLTFLoader = GLTFLoader;

// Update global declarations
declare global {
    interface Window {
        THREE: typeof THREE;
        GLTFLoader: typeof GLTFLoader;
        game: MultiplayerCarGame;
        joinGame: () => void;
    }
}

import { NetworkManager } from './networking';
import {CarPhysicsEngine, resolveCarCollision, checkOBBCollision, computeCarBoundingBox} from './physics';
import { UIManager } from './ui';
import {
    PlayerData,
    JoinResponse,
    PlayerUpdate,
    ChatMessage,
    KeyState,
    Vector3D,
    Rotation3D
} from '../types/game';

class MultiplayerCarGame {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;

    private playerCar: THREE.Group | null = null;
    private otherPlayers: Map<string, THREE.Group> = new Map();
    private wheels: THREE.Mesh[] = [];

    private networkManager: NetworkManager;
    private physicsEngine: CarPhysicsEngine;
    private uiManager: UIManager;

    private playerId: string | null = null;
    private playerName: string = '';
    private roomId: string = '';

    private keys: KeyState = {};
    private clock: THREE.Clock;
    private lastUpdate: number = 0;
    private readonly updateInterval: number = 1000 / 30; // 30 FPS updates
    private gltfLoader: GLTFLoader;
    
    // Camera view system
    private cameraMode: 'rear' | 'chase' | 'side' = 'rear';
    
    // Collision debugging system
    private debugMode: boolean = false;
    private debugObjects: Map<string, THREE.Group> = new Map();
    private collisionHelpers: THREE.Group = new THREE.Group();

    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        
        // Initialize GLTFLoader directly from import
        this.gltfLoader = new GLTFLoader();

        this.networkManager = new NetworkManager();
        this.physicsEngine = new CarPhysicsEngine();
        this.uiManager = new UIManager();
        this.clock = new THREE.Clock();

        this.init();
        this.setupEventListeners();
        this.setupNetworkEvents();
    }

    private init(): void {
        // Setup renderer
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x74B9FF); // More vibrant sky blue to match sunlight
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Enable tone mapping for better lighting
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        const gameContainer = document.getElementById('gameContainer');
        if (gameContainer) {
            gameContainer.appendChild(this.renderer.domElement);
        }

        this.setupLighting();
        this.createGround();
        
        // Add collision debug helpers to scene
        this.scene.add(this.collisionHelpers);

        this.camera.position.set(0, 8, 15);
        this.camera.lookAt(0, 0, 0);

        this.uiManager.showJoinForm();
    }

    private setupLighting(): void {
        // Warm ambient light to simulate scattered sunlight
        const ambientLight = new THREE.AmbientLight(0x87CEEB, 0.4); // Soft sky blue ambient
        this.scene.add(ambientLight);

        // Main sunlight - positioned like afternoon sun
        const sunLight = new THREE.DirectionalLight(0xffffcc, 2.5); // Warm yellowish sunlight
        sunLight.position.set(100, 150, 50); // High and angled like real sun
        sunLight.castShadow = true;
        
        // Enhanced shadow settings for better quality
        sunLight.shadow.mapSize.width = 4096;
        sunLight.shadow.mapSize.height = 4096;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 800;
        sunLight.shadow.camera.left = -200;
        sunLight.shadow.camera.right = 200;
        sunLight.shadow.camera.top = 200;
        sunLight.shadow.camera.bottom = -200;
        sunLight.shadow.bias = -0.0001; // Reduce shadow acne
        
        this.scene.add(sunLight);

        // Additional fill light to simulate sky reflection
        const fillLight = new THREE.DirectionalLight(0xadd8e6, 0.8); // Light blue fill
        fillLight.position.set(-50, 80, -100); // From opposite direction
        fillLight.castShadow = false; // No shadows for fill light
        this.scene.add(fillLight);

        // Optional: Add a subtle rim light for more dramatic effect
        const rimLight = new THREE.DirectionalLight(0xfff8dc, 0.6); // Warm cream color
        rimLight.position.set(-80, 60, 80);
        rimLight.castShadow = false;
        this.scene.add(rimLight);
    }

    private createGround(): void {
        // Main ground
        const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Road
        const roadGeometry = new THREE.PlaneGeometry(20, 1000);
        const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const road = new THREE.Mesh(roadGeometry, roadMaterial);
        road.rotation.x = -Math.PI / 2;
        road.position.y = 0.01;
        road.receiveShadow = true;
        this.scene.add(road);

        // Road lines
        for (let i = -500; i < 500; i += 20) {
            const lineGeometry = new THREE.PlaneGeometry(2, 8);
            const lineMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
            const line = new THREE.Mesh(lineGeometry, lineMaterial);
            line.rotation.x = -Math.PI / 2;
            line.position.set(0, 0.02, i);
            this.scene.add(line);
        }
    }

    private createCar(color: number = 0xff0000): THREE.Group {
        const car = new THREE.Group();

        // Car body
        const bodyGeometry = new THREE.BoxGeometry(4, 1.5, 8);
        const bodyMaterial = new THREE.MeshLambertMaterial({ color });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 1;
        body.castShadow = true;
        car.add(body);

        // Car roof
        const roofGeometry = new THREE.BoxGeometry(3, 1, 4);
        const roofColor = new THREE.Color(color).multiplyScalar(0.8);
        const roofMaterial = new THREE.MeshLambertMaterial({ color: roofColor });
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.y = 2;
        roof.position.z = -0.5;
        roof.castShadow = true;
        car.add(roof);

        // Create wheels
        const wheels: THREE.Mesh[] = [];
        const wheelPositions = [
            { x: -1.8, z: 2.5 },
            { x: 1.8, z: 2.5 },
            { x: -1.8, z: -2.5 },
            { x: 1.8, z: -2.5 }
        ];

        wheelPositions.forEach((pos) => {
            const wheelGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.3, 16);
            const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x222222 });
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(pos.x, 0.8, pos.z);
            wheel.castShadow = true;
            wheels.push(wheel);
            car.add(wheel);
        });

        (car as any).wheels = wheels;
        return car;
    }

    private async createPlayerCar(spawnPosition: Vector3D): Promise<void> {
        try {
            // Load the GLB for the player car
            const loadedCar = await this.loadCarModel();

            this.playerCar = loadedCar;
            this.wheels = []; // if you relied on wheels previously, you can find them in the GLB hierarchy if needed
            this.playerCar.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
            this.scene.add(this.playerCar);
            
            // Create debug visualization if debug mode is active
            if (this.debugMode && this.playerId) {
                this.createCarDebugVisualization(this.playerCar, this.playerId, true);
            }
        } catch (err) {
            console.error('Could not load player car model:', err);
        }
    }


    private async createOtherPlayer(playerData: PlayerData): Promise<void> {
        try {
            const loadedCar = await this.loadCarModel();
            loadedCar.position.set(
                playerData.position.x,
                playerData.position.y,
                playerData.position.z
            );

            // Add a name label (you can reuse your existing addNameLabel method)
            this.addNameLabel(loadedCar, playerData.name);

            (loadedCar as any).userData = { id: playerData.id, name: playerData.name };
            this.otherPlayers.set(playerData.id, loadedCar);
            this.scene.add(loadedCar);
            
            // Create debug visualization if debug mode is active
            if (this.debugMode) {
                this.createCarDebugVisualization(loadedCar, playerData.id, false);
            }
        } catch (err) {
            console.error('Failed to load other player car model for', playerData.name, err);
        }
    }


    private addNameLabel(car: THREE.Group, name: string): void {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = 256;
        canvas.height = 64;
        context.fillStyle = 'rgba(0, 0, 0, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'white';
        context.font = '24px Arial';
        context.textAlign = 'center';
        context.fillText(name, canvas.width / 2, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(0, 4, 0);
        sprite.scale.set(4, 1, 1);
        car.add(sprite);
    }

    private updateOtherPlayer(data: PlayerUpdate): void {
        const car = this.otherPlayers.get(data.id);
        if (!car) return;

        // Store velocity in userData for collision detection
        (car as any).userData.lastVelocity = data.velocity;

        // Smooth interpolation for other players
        car.position.lerp(
            new THREE.Vector3(data.position.x, data.position.y, data.position.z),
            0.1
        );
        car.rotation.y = data.rotation.y;
        
        // Safeguard: Ensure other players also stay at ground level
        if (car.position.y !== 0) {
            car.position.y = 0;
        }

        // Animate wheels
        const wheels = (car as any).wheels as THREE.Mesh[] | undefined;
        if (wheels) {
            const speed = Math.sqrt(data.velocity.x ** 2 + data.velocity.z ** 2);
            wheels.forEach(wheel => {
                wheel.rotation.y += speed * 0.1;
            });
        }
    }

    private removeOtherPlayer(playerId: string): void {
        const car = this.otherPlayers.get(playerId);
        if (car) {
            this.scene.remove(car);
            this.otherPlayers.delete(playerId);
            
            // Remove debug visualization
            const debugGroup = this.debugObjects.get(playerId);
            if (debugGroup) {
                this.collisionHelpers.remove(debugGroup);
                this.debugObjects.delete(playerId);
            }
        }
    }

    private setupEventListeners(): void {
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;

            // Chat toggle
            if (event.code === 'KeyT' && this.playerCar) {
                event.preventDefault();
                this.uiManager.toggleChat();
            }
            
            // Camera view toggle
            if (event.code === 'KeyC' && this.playerCar) {
                event.preventDefault();
                this.cycleCameraMode();
            }
            
            // Debug mode toggle
            if (event.code === 'KeyV' && this.playerCar) {
                event.preventDefault();
                this.toggleDebugMode();
            }
        });

        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
        });

        // Chat input handler
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendChatMessage();
                }
            });
        }

        // Join form handlers
        const playerNameInput = document.getElementById('playerName');
        if (playerNameInput) {
            playerNameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.joinGame();
                }
            });
        }

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    private setupNetworkEvents(): void {
        this.networkManager.on('connectionStatusChanged', (status: string) => {
            this.uiManager.updateConnectionStatus(status, status);
        });

        this.networkManager.on('joined', async (data: JoinResponse) => {
            this.playerId = data.player.id;
            this.roomId = data.room.id;
            this.playerName = data.player.name;

            console.log('Joined game:', data);

            await this.createPlayerCar(data.player.position);
            this.uiManager.setCurrentPlayer(data.player);

            data.room.players.forEach(player => {
                if (player.id !== this.playerId) {
                    this.createOtherPlayer(player);
                    this.uiManager.addOtherPlayer(player);
                }
            });

            this.startGame();
        });

        this.networkManager.on('playerJoined', async (player: PlayerData) => {
            console.log('Player joined:', player.name);
            await this.createOtherPlayer(player);
            this.uiManager.addOtherPlayer(player);
        });

        this.networkManager.on('playerUpdate', (data: PlayerUpdate) => {
            this.updateOtherPlayer(data);
        });

        this.networkManager.on('playerLeft', (playerId: string) => {
            console.log('Player left:', playerId);
            this.removeOtherPlayer(playerId);
            this.uiManager.removeOtherPlayer(playerId);
        });

        this.networkManager.on('chatMessage', (message: ChatMessage) => {
            this.uiManager.addChatMessage(message);
        });

        this.networkManager.on('serverError', (error: any) => {
            console.error('Server error:', error);
            this.uiManager.setJoinStatus(error.message || 'Server error', 'error');
        });
    }

    public async joinGame(): Promise<void> {
        const playerName = this.uiManager.getPlayerName();

        if (!playerName) {
            alert('Please enter your name!');
            return;
        }

        this.uiManager.setJoinButtonState(true);
        this.uiManager.setJoinStatus('Connecting to server...', 'connecting');

        try {
            await this.networkManager.connect();
            this.networkManager.joinGame(playerName);
        } catch (error) {
            console.error('Failed to connect:', error);
            this.uiManager.setJoinStatus('Failed to connect to server', 'error');
            this.uiManager.setJoinButtonState(false);
        }
    }

    private sendChatMessage(): void {
        const message = this.uiManager.getChatInput();

        if (message && this.networkManager.isConnected()) {
            this.networkManager.sendChatMessage(message);
            this.uiManager.clearChatInput();
        }
    }

    private updateCamera(): void {
        if (!this.playerCar) return;

        let idealOffset: THREE.Vector3;
        let lookAtHeight: number;

        switch (this.cameraMode) {
            case 'rear':
                // Middle back view (like our Blender setup)
                idealOffset = new THREE.Vector3(0, 5.4, 10.5);
                lookAtHeight = 1.5;
                break;
                
            case 'chase':
                // Traditional chase camera (higher and further back)
                idealOffset = new THREE.Vector3(0, 8, 15);
                lookAtHeight = 2;
                break;
                
            case 'side':
                // Side view for better turning visibility
                idealOffset = new THREE.Vector3(12, 6, 0);
                lookAtHeight = 1.5;
                break;
                
            default:
                idealOffset = new THREE.Vector3(0, 5.4, 10.5);
                lookAtHeight = 1.5;
        }

        idealOffset.applyQuaternion(this.playerCar.quaternion);
        const idealPosition = this.playerCar.position.clone().add(idealOffset);

        this.camera.position.lerp(idealPosition, 0.1);

        // Look at the car center, slightly above for better perspective
        const lookAtPosition = this.playerCar.position.clone();
        lookAtPosition.y += lookAtHeight;
        this.camera.lookAt(lookAtPosition);
    }

    private sendPositionUpdate(): void {
        if (!this.networkManager.isConnected() || !this.playerCar || !this.playerId) return;

        const velocity = this.physicsEngine.getVelocity();

        this.networkManager.updatePosition({
            id: this.playerId,
            position: {
                x: this.playerCar.position.x,
                y: this.playerCar.position.y,
                z: this.playerCar.position.z
            },
            rotation: {
                x: this.playerCar.rotation.x,
                y: this.playerCar.rotation.y,
                z: this.playerCar.rotation.z
            },
            velocity: velocity
        });
    }

    private loadCarModel(): Promise<THREE.Group> {
        return new Promise((resolve, reject) => {
            // Path to your GLB file (adjust if necessary)
            const modelPath = 'models/car_model.glb';

            this.gltfLoader.load(
                modelPath,
                (gltf) => {
                    // gltf.scene is a THREE.Group containing the loaded model
                    const carGroup = gltf.scene;

                    // Enable shadows (if your GLB has meshes with castShadow/receiveShadow)
                    carGroup.traverse((child) => {
                        if ((child as THREE.Mesh).isMesh) {
                            const mesh = child as THREE.Mesh;
                            mesh.castShadow = true;
                            mesh.receiveShadow = true;
                        }
                    });

                    // You can adjust scale if the glb is too big or small:
                    carGroup.scale.set(3.0, 3.0, 3.0); // 300% scale (3x bigger)

                    // Compute and store bounding box information for collision detection
                    const boundingBox = computeCarBoundingBox(carGroup);
                    (carGroup as any).userData.boundingBox = boundingBox;
                    
                    console.log('Car model loaded with bounding box:', {
                        size: boundingBox.size,
                        scale: boundingBox.scale
                    });

                    resolve(carGroup);
                },
                (xhr) => {
                    // Optional: progress callback
                    // console.log(`Loading model: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
                },
                (error) => {
                    console.error('Error loading GLB:', error);
                    reject(error);
                }
            );
        });
    }

    private updateUI(): void {
        if (!this.playerCar) return;

        const speed = Math.round(this.physicsEngine.getSpeed() * 3.6); // Convert to km/h
        const position = {
            x: this.playerCar.position.x,
            z: this.playerCar.position.z
        };

        this.uiManager.updateGameUI(speed, position);
    }

    private animateWheels(deltaTime: number): void {
        if (!this.wheels) return;

        const speed = this.physicsEngine.getSpeed();
        const wheelRotation = speed * deltaTime * 2;

        this.wheels.forEach((wheel, index) => {
            wheel.rotation.y -= wheelRotation;

            // Front wheels turn (simplified)
            if (index < 2) {
                // This would need turn speed from physics engine
                wheel.rotation.z = Math.PI / 2; // + turnSpeed * 0.3;
            }
        });
    }

    private startGame(): void {
        this.uiManager.hideJoinForm();
        this.animate();
    }

    private animate(): void {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();
        const now = Date.now();

        if (this.playerCar) {
            this.physicsEngine.updatePhysics(this.playerCar, this.keys, deltaTime);
            this.animateWheels(deltaTime);
            
            // Safeguard: Ensure car stays at ground level (prevent underground bugs)
            if (this.playerCar.position.y !== 0) {
                this.playerCar.position.y = 0;
            }
            
            // Update debug visualization for player car
            if (this.playerId) {
                this.updateCarDebugVisualization(this.playerCar, this.playerId);
            }
        }

        // Update debug visualization for other players
        if (this.debugMode) {
            this.otherPlayers.forEach((car, id) => {
                this.updateCarDebugVisualization(car, id);
            });
        }

        this.updateCamera();
        this.updateUI();
        this.handleCollisions();

        // Send position updates at 30 FPS
        if (now - this.lastUpdate > this.updateInterval) {
            this.sendPositionUpdate();
            this.lastUpdate = now;
        }

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    private handleCollisions(): void {
        if (!this.playerCar) return;
        
        const playerVelocity = new THREE.Vector3(
            this.physicsEngine.getVelocity().x,
            this.physicsEngine.getVelocity().y,
            this.physicsEngine.getVelocity().z
        );

        let collisionOccurred = false;

        for (const [otherId, otherCar] of this.otherPlayers) {
            if (!otherCar) continue;
            
            // Get the other car's velocity from the last update
            const otherVelocity = new THREE.Vector3(
                (otherCar as any).userData.lastVelocity?.x || 0,
                (otherCar as any).userData.lastVelocity?.y || 0,
                (otherCar as any).userData.lastVelocity?.z || 0
            );

            // Use improved OBB collision detection that accounts for actual model geometry and scale
            if (checkOBBCollision(this.playerCar, otherCar)) {
                collisionOccurred = true;
                
                // Calculate collision normal for visualization
                const posA = this.playerCar.position.clone();
                const posB = otherCar.position.clone();
                posA.y = 0;
                posB.y = 0;
                const collisionNormal = posA.sub(posB).normalize();
                
                // If collision normal is zero, use default
                if (collisionNormal.length() === 0) {
                    collisionNormal.set(1, 0, 0);
                }
                collisionNormal.y = 0;
                collisionNormal.normalize();
                
                // Visualize collision if debug mode is active
                if (this.debugMode) {
                    this.visualizeCollision(this.playerCar, otherCar, collisionNormal);
                }
                
                // Minimal collision logging
                console.log(`Collision with ${(otherCar as any).userData.name || 'unknown player'}`);
                
                // Resolve collision using enhanced collision resolution
                resolveCarCollision(this.playerCar, otherCar, playerVelocity, otherVelocity);
                
                // Store the collision for network sync
                this.networkManager.sendCollision({
                    otherPlayerId: otherId,
                    position: {
                        x: this.playerCar.position.x,
                        y: this.playerCar.position.y,
                        z: this.playerCar.position.z
                    },
                    velocity: {
                        x: playerVelocity.x,
                        y: playerVelocity.y,
                        z: playerVelocity.z
                    }
                });
            }
        }

        // If collision occurred, update physics engine with new velocity
        if (collisionOccurred) {
            this.physicsEngine.setVelocity({
                x: playerVelocity.x,
                y: playerVelocity.y,
                z: playerVelocity.z
            });
        }
    }

    private cycleCameraMode(): void {
        const modes: Array<'rear' | 'chase' | 'side'> = ['rear', 'chase', 'side'];
        const currentIndex = modes.indexOf(this.cameraMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.cameraMode = modes[nextIndex] || 'rear';
        console.log(`Camera mode switched to: ${this.cameraMode}`);
        console.log('Controls: V = Debug Mode, C = Camera, T = Chat');
    }

    private createCarDebugVisualization(car: THREE.Group, id: string, isPlayer: boolean = false): void {
        if (!this.debugMode) return;

        // Remove existing debug visualization
        const existingDebug = this.debugObjects.get(id);
        if (existingDebug) {
            this.collisionHelpers.remove(existingDebug);
        }

        const debugGroup = new THREE.Group();

        // Create bounding box wireframe
        const bbox = computeCarBoundingBox(car);
        const boxGeometry = new THREE.BoxGeometry(bbox.size.x, bbox.size.y, bbox.size.z);
        const boxColor = isPlayer ? 0x00ff00 : 0xff6600; // Green for player, orange for others
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: boxColor,
            wireframe: true,
            transparent: true,
            opacity: 0.6
        });
        const boundingBoxMesh = new THREE.Mesh(boxGeometry, wireframeMaterial);
        boundingBoxMesh.position.copy(car.position);
        boundingBoxMesh.rotation.copy(car.rotation);
        debugGroup.add(boundingBoxMesh);

        // Create center point indicator
        const centerGeometry = new THREE.SphereGeometry(0.5, 8, 8);
        const centerMaterial = new THREE.MeshBasicMaterial({ 
            color: isPlayer ? 0x00ff00 : 0xff6600 
        });
        const centerMesh = new THREE.Mesh(centerGeometry, centerMaterial);
        centerMesh.position.copy(car.position);
        debugGroup.add(centerMesh);

        // Create forward direction indicator
        const forwardGeometry = new THREE.ConeGeometry(1, 3, 8);
        const forwardMaterial = new THREE.MeshBasicMaterial({ 
            color: isPlayer ? 0x00ff00 : 0xff6600 
        });
        const forwardMesh = new THREE.Mesh(forwardGeometry, forwardMaterial);
        forwardMesh.position.copy(car.position);
        forwardMesh.position.z -= 5; // Offset forward
        forwardMesh.rotation.copy(car.rotation);
        forwardMesh.rotation.x = Math.PI / 2; // Point forward
        debugGroup.add(forwardMesh);

        // Store debug object
        this.debugObjects.set(id, debugGroup);
        this.collisionHelpers.add(debugGroup);
    }

    private updateCarDebugVisualization(car: THREE.Group, id: string): void {
        if (!this.debugMode) return;

        const debugGroup = this.debugObjects.get(id);
        if (!debugGroup) return;

        // Update all debug objects to match car position and rotation
        debugGroup.children.forEach((child, index) => {
            child.position.copy(car.position);
            child.rotation.copy(car.rotation);
            
            // Special handling for forward direction indicator
            if (index === 2) { // Forward indicator is the 3rd child
                child.position.z -= 5;
                child.rotation.x = Math.PI / 2;
            }
        });
    }

    private visualizeCollision(carA: THREE.Group, carB: THREE.Group, collisionNormal: THREE.Vector3): void {
        if (!this.debugMode) return;

        // Create collision normal arrow
        const arrowGeometry = new THREE.ConeGeometry(0.5, 4, 8);
        const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);

        // Position arrow at collision point
        const collisionPoint = carA.position.clone().add(carB.position).multiplyScalar(0.5);
        arrow.position.copy(collisionPoint);
        arrow.position.y += 2; // Raise above cars

        // Point arrow in collision normal direction
        arrow.lookAt(collisionPoint.clone().add(collisionNormal.clone().multiplyScalar(5)));
        arrow.rotation.x += Math.PI / 2;

        this.collisionHelpers.add(arrow);

        // Create collision impact circles
        const circleGeometry = new THREE.RingGeometry(2, 3, 16);
        const circleMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff0000, 
            transparent: true, 
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const circle = new THREE.Mesh(circleGeometry, circleMaterial);
        circle.position.copy(collisionPoint);
        circle.position.y = 0.1;
        circle.rotation.x = -Math.PI / 2;

        this.collisionHelpers.add(circle);

        // Add distance indicator line
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            carA.position.clone(),
            carB.position.clone()
        ]);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        this.collisionHelpers.add(line);

        // Remove collision indicators after 2 seconds
        setTimeout(() => {
            this.collisionHelpers.remove(arrow);
            this.collisionHelpers.remove(circle);
            this.collisionHelpers.remove(line);
        }, 2000);
    }

    private toggleDebugMode(): void {
        this.debugMode = !this.debugMode;
        console.log(`Collision Debug Mode: ${this.debugMode ? 'ON' : 'OFF'}`);

        if (this.debugMode) {
            // Create debug visualization for existing cars
            if (this.playerCar && this.playerId) {
                this.createCarDebugVisualization(this.playerCar, this.playerId, true);
            }

            this.otherPlayers.forEach((car, id) => {
                this.createCarDebugVisualization(car, id, false);
            });

            // Add debug info to UI
            this.addDebugUI();
        } else {
            // Clear all debug objects
            this.clearDebugVisualization();
            this.removeDebugUI();
        }
    }

    private clearDebugVisualization(): void {
        // Remove all debug objects
        this.debugObjects.forEach((debugGroup) => {
            this.collisionHelpers.remove(debugGroup);
        });
        this.debugObjects.clear();

        // Clear collision helpers
        this.collisionHelpers.clear();
    }

    private addDebugUI(): void {
        // Add debug info panel
        const debugPanel = document.createElement('div');
        debugPanel.id = 'debugPanel';
        debugPanel.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 12px;
            z-index: 1000;
        `;
        debugPanel.innerHTML = `
            <div><strong>🔧 COLLISION DEBUG MODE</strong></div>
            <div>📦 Green: Player Bounding Box</div>
            <div>📦 Orange: Other Players</div>
            <div>🔴 Red Arrow: Collision Normal</div>
            <div>🟡 Yellow Line: Distance</div>
            <div>🔴 Red Circle: Collision Point</div>
            <div><strong>Controls:</strong></div>
            <div>V - Toggle Debug Mode</div>
            <div>C - Change Camera</div>
            <div>T - Toggle Chat</div>
        `;
        document.body.appendChild(debugPanel);
    }

    private removeDebugUI(): void {
        const debugPanel = document.getElementById('debugPanel');
        if (debugPanel) {
            document.body.removeChild(debugPanel);
        }
    }

}

// Global function for join button
(window as any).joinGame = function() {
    if ((window as any).game) {
        (window as any).game.joinGame();
    }
};

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    (window as any).game = new MultiplayerCarGame();
});

