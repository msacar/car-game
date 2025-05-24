import { PlayerData, JoinGameData, JoinResponse, PositionUpdate, PlayerUpdate, ChatMessage, ServerError, Vector3D } from './game';

export interface ServerToClientEvents {
    joined: (data: JoinResponse) => void;
    playerJoined: (player: PlayerData) => void;
    playerUpdate: (data: PlayerUpdate) => void;
    playerLeft: (playerId: string) => void;
    chatMessage: (message: ChatMessage) => void;
    error: (error: ServerError) => void;
}

export interface ClientToServerEvents {
    join: (data: { name: string }) => void;
    updatePosition: (data: PlayerUpdate) => void;
    chatMessage: (data: { message: string }) => void;
    collision: (data: { otherPlayerId: string, position: Vector3D, velocity: Vector3D }) => void;
}

export interface InterServerEvents {
    // For future server-to-server communication
}

export interface SocketData {
    playerId?: string;
    roomId?: string;
}
