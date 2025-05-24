import { NetworkManager } from './networking';
import {CarPhysicsEngine, resolveCarCollision} from './physics';
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

// Let TypeScript know there's a global THREE available
declare const THREE: typeof import('three');

declare global {
    // const io: typeof import('socket.io-client').io;
    // const THREE: typeof import('three');
}

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

    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });

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
        this.renderer.setClearColor(0x87CEEB);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const gameContainer = document.getElementById('gameContainer');
        if (gameContainer) {
            gameContainer.appendChild(this.renderer.domElement);
        }

        this.setupLighting();
        this.createGround();

        this.camera.position.set(0, 8, 15);
        this.camera.lookAt(0, 0, 0);

        this.uiManager.showJoinForm();
    }

    private setupLighting(): void {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        this.scene.add(directionalLight);
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

    private createPlayerCar(spawnPosition: Vector3D): void {
        this.playerCar = this.createCar(0xff0000); // Red for player
        this.wheels = (this.playerCar as any).wheels;
        this.playerCar.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
        this.scene.add(this.playerCar);
    }

    private createOtherPlayer(playerData: PlayerData): void {
        const colors = [0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500];
        const color = colors[Math.floor(Math.random() * colors.length)];

        const car = this.createCar(color);
        car.position.set(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
        );

        // Add name label
        this.addNameLabel(car, playerData.name);

        (car as any).userData = { id: playerData.id, name: playerData.name };
        this.otherPlayers.set(playerData.id, car);
        this.scene.add(car);
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

        // Smooth interpolation for other players
        car.position.lerp(
            new THREE.Vector3(data.position.x, data.position.y, data.position.z),
            0.1
        );
        car.rotation.y = data.rotation.y;

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

        this.networkManager.on('joined', (data: JoinResponse) => {
            this.playerId = data.player.id;
            this.roomId = data.room.id;
            this.playerName = data.player.name;

            console.log('Joined game:', data);

            this.createPlayerCar(data.player.position);
            this.uiManager.setCurrentPlayer(data.player);

            data.room.players.forEach(player => {
                if (player.id !== this.playerId) {
                    this.createOtherPlayer(player);
                    this.uiManager.addOtherPlayer(player);
                }
            });

            this.startGame();
        });

        this.networkManager.on('playerJoined', (player: PlayerData) => {
            console.log('Player joined:', player.name);
            this.createOtherPlayer(player);
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

        const idealOffset = new THREE.Vector3(0, 8, 15);
        idealOffset.applyQuaternion(this.playerCar.quaternion);
        const idealPosition = this.playerCar.position.clone().add(idealOffset);

        this.camera.position.lerp(idealPosition, 0.1);

        const lookAtPosition = this.playerCar.position.clone();
        lookAtPosition.y += 2;
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

            // Simple radius-based collision check
            const distance = this.playerCar.position.distanceTo(otherCar.position);
            if (distance < 4) { // ~2 unit radius per car
                collisionOccurred = true;
                
                // Resolve collision
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

