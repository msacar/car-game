export interface Vector3D {
    x: number;
    y: number;
    z: number;
}

export interface Rotation3D {
    x: number;
    y: number;
    z: number;
}

export interface PlayerData {
    id: string;
    name: string;
    roomId: string;
    position: Vector3D;
    rotation: Rotation3D;
    velocity: Vector3D;
    joinedAt: number;
    lastUpdate: number;
}

export interface RoomData {
    id: string;
    players: Map<string, PlayerData>;
    createdAt: number;
    maxPlayers: number;
}

export interface GameState {
    players: Map<string, PlayerData>;
    rooms: Map<string, RoomData>;
    maxPlayersPerRoom: number;
}

export interface CarPhysics {
    velocity: Vector3D;
    acceleration: number;
    maxSpeed: number;
    turnSpeed: number;
    maxTurnSpeed: number;
    friction: number;
    power: number;
    reverse: number;
    turnDecay: number;
}

export interface GameStats {
    totalPlayers: number;
    totalRooms: number;
    rooms: {
        id: string;
        playerCount: number;
        players: string[];
    }[];
}

export interface ChatMessage {
    id: number;
    playerId: string;
    playerName: string;
    message: string;
    timestamp: number;
}

export interface JoinGameData {
    name: string;
}

export interface JoinResponse {
    player: PlayerData;
    room: {
        id: string;
        players: PlayerData[];
    };
}

export interface PositionUpdate {
    position: Vector3D;
    rotation: Rotation3D;
    velocity: Vector3D;
}

export interface PlayerUpdate extends PositionUpdate {
    id: string;
}

export interface ServerError {
    message: string;
    code?: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface KeyState {
    [key: string]: boolean;
}