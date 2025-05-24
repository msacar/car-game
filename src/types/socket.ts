import { PlayerData, JoinGameData, JoinResponse, PositionUpdate, PlayerUpdate, ChatMessage, ServerError } from './game';

export interface ServerToClientEvents {
    joined: (data: JoinResponse) => void;
    playerJoined: (player: PlayerData) => void;
    playerUpdate: (data: PlayerUpdate) => void;
    playerLeft: (playerId: string) => void;
    chatMessage: (message: ChatMessage) => void;
    error: (error: ServerError) => void;
}

export interface ClientToServerEvents {
    join: (data: JoinGameData) => void;
    updatePosition: (data: PositionUpdate) => void;
    chatMessage: (data: { message: string }) => void;
}

export interface InterServerEvents {
    // For future server-to-server communication
}

export interface SocketData {
    playerId?: string;
    roomId?: string;
}
