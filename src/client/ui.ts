import { PlayerData, ChatMessage } from '../types/game';

export class UIManager {
    private currentPlayer: PlayerData | null = null;
    private otherPlayers: Map<string, PlayerData> = new Map();
    private chatVisible: boolean = false;

    public showJoinForm(): void {
        this.setElementDisplay('joinForm', true);
        this.setElementDisplay('ui', false);
        this.setElementDisplay('controls', false);
        this.setElementDisplay('connectionStatus', false);

        // Focus on name input
        const nameInput = document.getElementById('playerName') as HTMLInputElement;
        if (nameInput) {
            nameInput.focus();
        }
    }

    public hideJoinForm(): void {
        this.setElementDisplay('joinForm', false);
        this.setElementDisplay('ui', true);
        this.setElementDisplay('controls', true);
        this.setElementDisplay('connectionStatus', true);
    }

    public updateConnectionStatus(status: string, className: string): void {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = status;
            statusElement.className = className;
        }
    }

    public setJoinStatus(message: string, type: 'error' | 'success' | 'connecting'): void {
        const statusDiv = document.getElementById('joinStatus');
        if (statusDiv) {
            statusDiv.innerHTML = `<div class="${type}">${message}</div>`;
        }
    }

    public setJoinButtonState(loading: boolean): void {
        const joinButton = document.getElementById('joinButton') as HTMLButtonElement;
        if (joinButton) {
            joinButton.disabled = loading;
            joinButton.innerHTML = loading
                ? '<span class="loading"></span> Joining...'
                : 'Join Race';
        }
    }

    public updateGameUI(speed: number, position: { x: number; z: number }): void {
        this.setElementText('speed', speed.toString());
        this.setElementText('position', `${Math.round(position.x)}, ${Math.round(position.z)}`);

        if (this.currentPlayer) {
            this.setElementText('currentPlayer', this.currentPlayer.name);
            this.setElementText('currentRoom', this.currentPlayer.roomId);
        }
    }

    public updatePlayersList(): void {
        const playersDiv = document.getElementById('players');
        if (!playersDiv) return;

        playersDiv.innerHTML = '';

        // Add current player
        if (this.currentPlayer) {
            const playerDiv = document.createElement('div');
            playerDiv.textContent = `${this.currentPlayer.name} (You)`;
            playerDiv.style.color = '#ff6666';
            playersDiv.appendChild(playerDiv);
        }

        // Add other players
        this.otherPlayers.forEach(player => {
            const otherPlayerDiv = document.createElement('div');
            otherPlayerDiv.textContent = player.name;
            otherPlayerDiv.style.color = '#66ff66';
            playersDiv.appendChild(otherPlayerDiv);
        });
    }

    public setCurrentPlayer(player: PlayerData): void {
        this.currentPlayer = player;
        this.updatePlayersList();
    }

    public addOtherPlayer(player: PlayerData): void {
        this.otherPlayers.set(player.id, player);
        this.updatePlayersList();
    }

    public removeOtherPlayer(playerId: string): void {
        this.otherPlayers.delete(playerId);
        this.updatePlayersList();
    }

    public toggleChat(): void {
        this.chatVisible = !this.chatVisible;
        this.setElementDisplay('chat', this.chatVisible);

        if (this.chatVisible) {
            const chatInput = document.getElementById('chatInput') as HTMLInputElement;
            if (chatInput) {
                chatInput.focus();
            }
        }
    }

    public addChatMessage(message: ChatMessage): void {
        const messagesDiv = document.getElementById('chatMessages');
        if (!messagesDiv) return;

        const messageEl = document.createElement('div');
        messageEl.innerHTML = `<strong>${this.escapeHtml(message.playerName)}:</strong> ${this.escapeHtml(message.message)}`;
        messagesDiv.appendChild(messageEl);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // Remove old messages (keep last 50)
        while (messagesDiv.children.length > 50) {
            const firstChild = messagesDiv.firstChild;
            if (firstChild) {
                messagesDiv.removeChild(firstChild);
            }
        }
    }

    public getChatInput(): string {
        const chatInput = document.getElementById('chatInput') as HTMLInputElement;
        return chatInput ? chatInput.value.trim() : '';
    }

    public clearChatInput(): void {
        const chatInput = document.getElementById('chatInput') as HTMLInputElement;
        if (chatInput) {
            chatInput.value = '';
        }
    }

    public getPlayerName(): string {
        const nameInput = document.getElementById('playerName') as HTMLInputElement;
        return nameInput ? nameInput.value.trim() : '';
    }

    private setElementDisplay(id: string, visible: boolean): void {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = visible ? 'block' : 'none';
        }
    }

    private setElementText(id: string, text: string): void {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = text;
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
