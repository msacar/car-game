import { io, Socket } from 'socket.io-client';
import {
    ServerToClientEvents,
    ClientToServerEvents
} from '../types/socket';
import {
    PlayerData,
    JoinResponse,
    PositionUpdate,
    PlayerUpdate,
    ChatMessage,
    ConnectionStatus, ServerError
} from '../types/game';

export class NetworkManager {
    private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    private connectionStatus: ConnectionStatus = 'disconnected';
    private callbacks: Map<string, Function[]> = new Map();

    public connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.connectionStatus = 'connecting';
                this.socket = io();

                this.socket.on('connect', () => {
                    this.connectionStatus = 'connected';
                    this.emit('connectionStatusChanged', 'connected');
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    this.connectionStatus = 'disconnected';
                    this.emit('connectionStatusChanged', 'disconnected');
                });

                this.socket.on('connect_error', (error: Error) => {
                    this.connectionStatus = 'error';
                    this.emit('connectionStatusChanged', 'error');
                    reject(error);
                });

                // Game event handlers
                this.socket.on('joined', (data: JoinResponse) => {
                    this.emit('joined', data);
                });

                this.socket.on('playerJoined', (player: PlayerData) => {
                    this.emit('playerJoined', player);
                });

                this.socket.on('playerUpdate', (data: PlayerUpdate) => {
                    this.emit('playerUpdate', data);
                });

                this.socket.on('playerLeft', (playerId: string) => {
                    this.emit('playerLeft', playerId);
                });

                this.socket.on('chatMessage', (message: ChatMessage) => {
                    this.emit('chatMessage', message);
                });

                this.socket.on('error', (error: ServerError) => {
                    this.emit('serverError', error);
                });

            } catch (error) {
                this.connectionStatus = 'error';
                reject(error);
            }
        });
    }

    public joinGame(playerName: string): void {
        if (!this.socket) throw new Error('Not connected to server');

        this.socket.emit('join', { name: playerName });
    }

    public updatePosition(positionData: PositionUpdate): void {
        if (!this.socket) return;

        this.socket.emit('updatePosition', positionData);
    }

    public sendChatMessage(message: string): void {
        if (!this.socket) return;

        this.socket.emit('chatMessage', { message });
    }

    public on(event: string, callback: Function): void {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, []);
        }
        this.callbacks.get(event)!.push(callback);
    }

    public off(event: string, callback?: Function): void {
        if (!this.callbacks.has(event)) return;

        if (!callback) {
            this.callbacks.delete(event);
            return;
        }

        const callbacks = this.callbacks.get(event)!;
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    private emit(event: string, ...args: any[]): void {
        const callbacks = this.callbacks.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(...args));
        }
    }

    public getConnectionStatus(): ConnectionStatus {
        return this.connectionStatus;
    }

    public isConnected(): boolean {
        return this.socket?.connected ?? false;
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connectionStatus = 'disconnected';
    }
}