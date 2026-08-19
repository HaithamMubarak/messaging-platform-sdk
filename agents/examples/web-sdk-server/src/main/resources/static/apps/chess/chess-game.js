/**
 * Chess Game - Multiplayer with Spectator Mode
 * Uses chess.js for game logic and UserConnectionBase for networking
 */

const PIECE_UNICODE = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

// ============================================
// CHESS GAME CLASS
// ============================================

class ChessGame extends UserConnectionBase {
    constructor() {
        super({
            storagePrefix: 'chess',
            customType: 'chess',
            autoCreateDataChannel: true,
            dataChannelName: 'chess-data'
        });

        // Chess engine
        this.chess = new Chess();

        // Game state
        this.whitePlayer = null;
        this.blackPlayer = null;
        this.spectators = [];
        this.myColor = null; // 'white', 'black', or 'spectator'

        // UI state
        this.selectedSquare = null;
        this.validMoves = [];
        this.lastMove = null;

        // Pending promotion
        this.pendingPromotion = null;

        // Board orientation
        this.boardFlipped = false;
    }

    async onInitialize() {
        console.log('[Chess] Initializing...');
        this.renderBoard();
        console.log('[Chess] Initialized');
    }

    onConnect(detail) {
        // Dismiss the connection dialog — without this it stays over the app
        // even though the session is live.
        if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
            window.ConnectionModal.hide();
        }
        console.log('[Chess] Connected:', detail);

        // Show game container
        document.getElementById('gameContainer').classList.remove('hidden');

        // Update connection status
        document.getElementById('connectionStatus').classList.add('connected');
        document.getElementById('statusText').textContent = 'Connected';

        // Show room name
        document.getElementById('roomName').textContent = this.channelName;

        // Show share button
        document.getElementById('shareBtn').style.display = 'block';

        // Show lobby for color selection
        if (this.isHost()) {
            document.getElementById('lobbyPanel').classList.remove('hidden');
        }
    }

    onUserJoin(detail) {
        console.log('[Chess] User joined:', detail.agentName);

        // Sync game state to new player
        if (this.isHost()) {
            this.syncGameState(detail.agentName);
        }

        this.updateSpectatorsList();
        this.showToast(`${detail.agentName} joined`, 'success');
    }

    onUserLeave(detail) {
        console.log('[Chess] User left:', detail.agentName);

        // Handle player leaving
        if (this.whitePlayer === detail.agentName) {
            this.whitePlayer = null;
            this.showToast('White player left', 'warning');
            this.updatePlayersUI();
        } else if (this.blackPlayer === detail.agentName) {
            this.blackPlayer = null;
            this.showToast('Black player left', 'warning');
            this.updatePlayersUI();
        }

        this.spectators = this.spectators.filter(s => s !== detail.agentName);
        this.updateSpectatorsList();
    }

    onDataChannelMessage(peerId, data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'choose-color':
                this.handleColorChoice(data);
                break;
            case 'move':
                this.handleRemoteMove(data);
                break;
            case 'game-sync':
                this.handleGameSync(data);
                break;
            case 'resign':
                this.handleResign(data);
                break;
            case 'offer-draw':
                this.handleDrawOffer(data);
                break;
            case 'draw-accepted':
                this.handleDrawAccepted(data);
                break;
            case 'new-game':
                this.handleNewGame(data);
                break;
        }
    }

    // ============================================
    // COLOR SELECTION
    // ============================================

    chooseColor(color) {
        if (this.myColor) {
            this.showToast('You already chose a color', 'warning');
            return;
        }

        const data = {
            type: 'choose-color',
            username: this.username,
            color: color
        };

        this.sendData(data);
        this.handleColorChoice(data);
    }

    chooseSpectator() {
        if (this.myColor) {
            this.showToast('You already chose a role', 'warning');
            return;
        }

        const data = {
            type: 'choose-color',
            username: this.username,
            color: 'spectator'
        };

        this.sendData(data);
        this.handleColorChoice(data);
    }

    handleColorChoice(data) {
        const username = data.username;
        const color = data.color;

        if (color === 'white') {
            if (this.whitePlayer && this.whitePlayer !== username) {
                this.showToast('White is already taken', 'error');
                return;
            }
            this.whitePlayer = username;
            if (username === this.username) {
                this.myColor = 'white';
                document.getElementById('lobbyPanel').classList.add('hidden');
            }
        } else if (color === 'black') {
            if (this.blackPlayer && this.blackPlayer !== username) {
                this.showToast('Black is already taken', 'error');
                return;
            }
            this.blackPlayer = username;
            if (username === this.username) {
                this.myColor = 'black';
                this.boardFlipped = true;
                document.getElementById('lobbyPanel').classList.add('hidden');
            }
        } else if (color === 'spectator') {
            if (!this.spectators.includes(username)) {
                this.spectators.push(username);
            }
            if (username === this.username) {
                this.myColor = 'spectator';
                document.getElementById('lobbyPanel').classList.add('hidden');
            }
        }

        this.updatePlayersUI();
        this.updateSpectatorsList();
        this.updateGameStatus();
        this.renderBoard();

        // Auto-start if both players ready
        if (this.whitePlayer && this.blackPlayer) {
            this.showToast('Game ready! White moves first.', 'success');
            this.enableControls();
        }
    }

    updatePlayersUI() {
        document.getElementById('whitePlayerName').textContent = this.whitePlayer || 'Waiting...';
        document.getElementById('blackPlayerName').textContent = this.blackPlayer || 'Waiting...';

        // Highlight active player
        const whiteTurn = this.chess.turn() === 'w';
        document.querySelector('.white-player').classList.toggle('active', whiteTurn);
        document.querySelector('.black-player').classList.toggle('active', !whiteTurn);

        // Update status indicators
        document.getElementById('whitePlayerStatus').textContent =
            this.whitePlayer ? (whiteTurn ? '⏳ Thinking...' : '✓ Ready') : '⏳ Waiting';
        document.getElementById('blackPlayerStatus').textContent =
            this.blackPlayer ? (!whiteTurn ? '⏳ Thinking...' : '✓ Ready') : '⏳ Waiting';
    }

    updateSpectatorsList() {
        const spectatorCount = document.getElementById('spectatorCount');
        const spectatorsList = document.getElementById('spectatorsList');

        spectatorCount.textContent = this.spectators.length;

        spectatorsList.innerHTML = this.spectators
            .map(name => `<div class="spectator-item">👁️ ${MiniGameUtils.escapeHtml(name)}</div>`)
            .join('');
    }

    updateGameStatus() {
        const statusEl = document.getElementById('gameStatus');
        const turnEl = document.getElementById('turnText');

        if (!this.whitePlayer || !this.blackPlayer) {
            statusEl.textContent = 'Waiting for players...';
            turnEl.textContent = '';
            return;
        }

        if (this.chess.in_checkmate()) {
            const winner = this.chess.turn() === 'w' ? this.blackPlayer : this.whitePlayer;
            statusEl.textContent = `Checkmate! ${winner} wins!`;
        } else if (this.chess.in_stalemate()) {
            statusEl.textContent = 'Stalemate - Draw!';
        } else if (this.chess.in_draw()) {
            statusEl.textContent = 'Draw!';
        } else if (this.chess.in_check()) {
            statusEl.textContent = 'Check!';
        } else {
            statusEl.textContent = 'Playing';
        }

        const currentPlayer = this.chess.turn() === 'w' ? this.whitePlayer : this.blackPlayer;
        turnEl.textContent = `${currentPlayer}'s Turn (${this.chess.turn() === 'w' ? 'White' : 'Black'})`;
    }

    // ============================================
    // BOARD RENDERING
    // ============================================

    renderBoard() {
        const boardEl = document.getElementById('chessBoard');
        boardEl.innerHTML = '';

        const board = this.chess.board();

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                // Adjust for board flip
                const displayRow = this.boardFlipped ? row : 7 - row;
                const displayCol = this.boardFlipped ? 7 - col : col;

                const square = board[displayRow][displayCol];
                const squareEl = document.createElement('div');
                squareEl.className = 'chess-square';
                squareEl.dataset.row = displayRow;
                squareEl.dataset.col = displayCol;

                // Light or dark square
                const isLight = (row + col) % 2 === 0;
                squareEl.classList.add(isLight ? 'light' : 'dark');

                // Add piece
                if (square) {
                    const pieceSymbol = PIECE_UNICODE[square.type === square.type.toUpperCase() ? square.type.toUpperCase() : square.type];
                    squareEl.textContent = square.color === 'w' ? pieceSymbol : PIECE_UNICODE[square.type];
                }

                // Highlight last move
                if (this.lastMove) {
                    const from = this.lastMove.from;
                    const to = this.lastMove.to;
                    const currentSquare = this.getSquareNotation(displayRow, displayCol);
                    if (currentSquare === from || currentSquare === to) {
                        squareEl.classList.add('last-move');
                    }
                }

                // Click handler
                squareEl.addEventListener('click', () => this.handleSquareClick(displayRow, displayCol));

                boardEl.appendChild(squareEl);
            }
        }

        // Show valid moves
        if (this.selectedSquare) {
            this.highlightValidMoves();
        }
    }

    getSquareNotation(row, col) {
        const files = 'abcdefgh';
        return files[col] + (row + 1);
    }

    handleSquareClick(row, col) {
        // Can only move if it's your turn
        const isMyTurn = (this.chess.turn() === 'w' && this.myColor === 'white') ||
                         (this.chess.turn() === 'b' && this.myColor === 'black');

        if (!isMyTurn || this.myColor === 'spectator') {
            return;
        }

        const clickedSquare = this.getSquareNotation(row, col);

        // If no square selected, select this square (if it has our piece)
        if (!this.selectedSquare) {
            const piece = this.chess.get(clickedSquare);
            if (piece && piece.color === this.chess.turn()) {
                this.selectedSquare = clickedSquare;
                this.validMoves = this.chess.moves({square: clickedSquare, verbose: true});
                this.renderBoard();
            }
            return;
        }

        // If clicking same square, deselect
        if (this.selectedSquare === clickedSquare) {
            this.selectedSquare = null;
            this.validMoves = [];
            this.renderBoard();
            return;
        }

        // Try to make move
        this.attemptMove(this.selectedSquare, clickedSquare);
    }

    highlightValidMoves() {
        this.validMoves.forEach(move => {
            const toSquare = move.to;
            const [file, rank] = [toSquare[0], toSquare[1]];
            const col = 'abcdefgh'.indexOf(file);
            const row = parseInt(rank) - 1;

            const squareEl = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
            if (squareEl) {
                squareEl.classList.add('valid-move');
            }
        });

        // Highlight selected square
        if (this.selectedSquare) {
            const [file, rank] = [this.selectedSquare[0], this.selectedSquare[1]];
            const col = 'abcdefgh'.indexOf(file);
            const row = parseInt(rank) - 1;

            const squareEl = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
            if (squareEl) {
                squareEl.classList.add('selected');
            }
        }
    }

    attemptMove(from, to) {
        // Check if move requires promotion
        const piece = this.chess.get(from);
        const toRank = parseInt(to[1]);

        if (piece && piece.type === 'p' && (toRank === 8 || toRank === 1)) {
            // Pawn promotion
            this.pendingPromotion = {from, to};
            this.showPromotionDialog();
            return;
        }

        this.makeMove(from, to, null);
    }

    makeMove(from, to, promotion) {
        const moveObj = {from, to};
        if (promotion) {
            moveObj.promotion = promotion;
        }

        const move = this.chess.move(moveObj);

        if (!move) {
            this.showToast('Invalid move', 'error');
            this.selectedSquare = null;
            this.validMoves = [];
            this.renderBoard();
            return;
        }

        // Move successful
        this.lastMove = move;
        this.selectedSquare = null;
        this.validMoves = [];

        // Update UI
        this.renderBoard();
        this.updatePlayersUI();
        this.updateGameStatus();
        this.addMoveToHistory(move);
        this.updateCapturedPieces();

        // Broadcast move
        const data = {
            type: 'move',
            from: from,
            to: to,
            promotion: promotion,
            fen: this.chess.fen()
        };

        this.sendData(data);

        // Check game over
        if (this.chess.game_over()) {
            this.handleGameOver();
        }
    }

    handleRemoteMove(data) {
        const moveObj = {from: data.from, to: data.to};
        if (data.promotion) {
            moveObj.promotion = data.promotion;
        }

        const move = this.chess.move(moveObj);

        if (move) {
            this.lastMove = move;
            this.renderBoard();
            this.updatePlayersUI();
            this.updateGameStatus();
            this.addMoveToHistory(move);
            this.updateCapturedPieces();

            if (this.chess.game_over()) {
                this.handleGameOver();
            }
        } else {
            console.error('[Chess] Invalid remote move:', data);
            // Sync state
            this.chess.load(data.fen);
            this.renderBoard();
        }
    }

    showPromotionDialog() {
        const dialog = document.getElementById('promotionDialog');
        dialog.classList.remove('hidden');

        // Setup promotion buttons
        document.querySelectorAll('.promotion-btn').forEach(btn => {
            btn.onclick = () => {
                const piece = btn.dataset.piece;
                dialog.classList.add('hidden');

                if (this.pendingPromotion) {
                    this.makeMove(this.pendingPromotion.from, this.pendingPromotion.to, piece);
                    this.pendingPromotion = null;
                }
            };
        });
    }

    addMoveToHistory(move) {
        const history = document.getElementById('moveHistory');
        const moveNum = Math.floor(this.chess.history().length / 2) + (this.chess.turn() === 'w' ? 0 : 1);

        // Create move entry
        const entryEl = document.createElement('div');
        entryEl.className = 'move-entry';
        entryEl.innerHTML = `
            <span class="move-number">${moveNum}.</span>
            <span class="move-text">${MiniGameUtils.escapeHtml(move.san)}</span>
        `;

        history.appendChild(entryEl);
        history.scrollTop = history.scrollHeight;
    }

    updateCapturedPieces() {
        const whiteCaptured = document.getElementById('whiteCaptured');
        const blackCaptured = document.getElementById('blackCaptured');

        const history = this.chess.history({verbose: true});
        const capturedWhite = [];
        const capturedBlack = [];

        history.forEach(move => {
            if (move.captured) {
                const piece = move.captured;
                const unicode = move.color === 'w' ?
                    PIECE_UNICODE[piece] : PIECE_UNICODE[piece.toUpperCase()];

                if (move.color === 'w') {
                    capturedBlack.push(unicode);
                } else {
                    capturedWhite.push(unicode);
                }
            }
        });

        whiteCaptured.innerHTML = capturedWhite.map(p =>
            `<span class="captured-piece">${p}</span>`).join('');
        blackCaptured.innerHTML = capturedBlack.map(p =>
            `<span class="captured-piece">${p}</span>`).join('');
    }

    // ============================================
    // GAME ACTIONS
    // ============================================

    requestNewGame() {
        MiniGameUtils.ask({
            title: 'Start a new game?', body: 'The game on the board now is lost.',
            confirmLabel: 'New game', danger: true
        }).then((yes) => {
            if (!yes) return;
            const data = { type: 'new-game' };
            this.sendData(data);
            this.handleNewGame(data);
        });
    }

    handleNewGame(data) {
        this.chess.reset();
        this.selectedSquare = null;
        this.validMoves = [];
        this.lastMove = null;

        // Clear captured pieces
        document.getElementById('whiteCaptured').innerHTML = '';
        document.getElementById('blackCaptured').innerHTML = '';

        // Clear move history
        document.getElementById('moveHistory').innerHTML = '';

        this.renderBoard();
        this.updatePlayersUI();
        this.updateGameStatus();

        this.showToast('New game started!', 'success');
    }

    resign() {
        if (this.myColor === 'spectator') return;

        MiniGameUtils.ask({
            title: 'Resign?', body: 'Your opponent wins this game.',
            confirmLabel: 'Resign', danger: true
        }).then((yes) => {
            if (!yes) return;
            const data = { type: 'resign', username: this.username, color: this.myColor };
            this.sendData(data);
            this.handleResign(data);
        });
    }

    handleResign(data) {
        const winner = data.color === 'white' ? this.blackPlayer : this.whitePlayer;
        this.showToast(`${data.username} resigned! ${winner} wins!`, 'success');
        this.disableControls();

        this.showGameOverDialog(`${winner} wins by resignation!`);
    }

    offerDraw() {
        if (this.myColor === 'spectator') return;

        const opponent = this.myColor === 'white' ? this.blackPlayer : this.whitePlayer;
        this.showToast(`Draw offer sent to ${opponent}`, 'info');

        const data = {
            type: 'offer-draw',
            from: this.username
        };
        this.sendData(data);
    }

    handleDrawOffer(data) {
        MiniGameUtils.ask({
            title: 'A draw is offered', body: `${data.from} offers a draw.`,
            confirmLabel: 'Accept', cancelLabel: 'Play on'
        }).then((yes) => {
            if (!yes) {
                this.showToast('Draw offer declined', 'info');
                return;
            }
            const acceptData = { type: 'draw-accepted' };
            this.sendData(acceptData);
            this.handleDrawAccepted(acceptData);
        });
    }

    handleDrawAccepted(data) {
        this.showToast('Draw accepted!', 'success');
        this.showGameOverDialog('Game drawn by agreement');
        this.disableControls();
    }

    handleGameOver() {
        let message = '';

        if (this.chess.in_checkmate()) {
            const winner = this.chess.turn() === 'w' ? this.blackPlayer : this.whitePlayer;
            message = `Checkmate! ${winner} wins!`;
        } else if (this.chess.in_stalemate()) {
            message = 'Stalemate - Draw!';
        } else if (this.chess.in_draw()) {
            message = 'Draw!';
        }

        this.showGameOverDialog(message);
        this.disableControls();
    }

    showGameOverDialog(message) {
        const dialog = document.createElement('div');
        dialog.className = 'game-over-dialog';
        dialog.innerHTML = `
            <h2>Game Over</h2>
            <div class="result">${message}</div>
            <button class="btn-secondary" onclick="chessGame?.requestNewGame()">
                🔄 New Game
            </button>
        `;
        document.querySelector('.board-area').appendChild(dialog);
    }

    enableControls() {
        document.getElementById('newGameBtn').disabled = false;
        document.getElementById('resignBtn').disabled = false;
        document.getElementById('offerDrawBtn').disabled = false;
    }

    disableControls() {
        document.getElementById('resignBtn').disabled = true;
        document.getElementById('offerDrawBtn').disabled = true;
    }

    // ============================================
    // SYNC
    // ============================================

    syncGameState(targetUsername) {
        const data = {
            type: 'game-sync',
            fen: this.chess.fen(),
            whitePlayer: this.whitePlayer,
            blackPlayer: this.blackPlayer,
            spectators: this.spectators,
            lastMove: this.lastMove
        };

        this.sendData(data, targetUsername);
    }

    handleGameSync(data) {
        this.chess.load(data.fen);
        this.whitePlayer = data.whitePlayer;
        this.blackPlayer = data.blackPlayer;
        this.spectators = data.spectators || [];
        this.lastMove = data.lastMove;

        // Determine my role if not set
        if (!this.myColor) {
            if (this.username === this.whitePlayer) {
                this.myColor = 'white';
            } else if (this.username === this.blackPlayer) {
                this.myColor = 'black';
                this.boardFlipped = true;
            } else {
                this.myColor = 'spectator';
            }
            document.getElementById('lobbyPanel').classList.add('hidden');
        }

        this.renderBoard();
        this.updatePlayersUI();
        this.updateSpectatorsList();
        this.updateGameStatus();

        if (this.whitePlayer && this.blackPlayer) {
            this.enableControls();
        }
    }

    // ============================================
    // UTILITIES
    // ============================================

    showToast(message, type = 'info') {
        if (typeof MiniGameUtils !== 'undefined' && MiniGameUtils.showToast) {
            MiniGameUtils.showToast(message, type);
        } else {
            console.log(`[Toast] ${message}`);
        }
    }

    openShareModal() {
        if (typeof window.openShareModal === 'function') {
            window.openShareModal();
        }
    }
}

// ============================================
// INITIALIZATION
// ============================================

let chessGame = null;
let isConnecting = false;

async function connectChess(username, channel, password) {
    if (isConnecting) {
        console.warn('[Chess] Connection already in progress');
        return;
    }
    if (chessGame && chessGame.connected) {
        console.warn('[Chess] Already connected');
        return;
    }

    isConnecting = true;

    try {
        chessGame = new ChessGame();
        window.chessGame = chessGame;

        await chessGame.initialize();
        await chessGame.connect({
            username: username,
            channelName: channel,
            channelPassword: password
        });

        chessGame.start();

        // Update URL for sharing
        if (typeof window.encodeChannelAuth === 'function') {
            const encoded = window.encodeChannelAuth(channel, password, null);
            if (encoded) {
                window.history.replaceState(null, '', '#' + encoded + '#' + channel.toLowerCase().replace(/[^a-z0-9]/g, '-'));
            }
        }

        console.log('[Chess] Connected and ready!');
    } catch (error) {
        console.error('[Chess] Connection failed:', error);
        if (window.ConnectionModal) ConnectionModal.fail(error);
        chessGame = null;
    } finally {
        isConnecting = false;
    }
}

function initializeConnectionModal() {
    window.loadConnectionModal({
        localStoragePrefix: 'chess_',
        channelPrefix: 'chess-',
        title: '♟️ Join Chess Game',
        collapsedTitle: '♟️ Chess',
        onConnect: function(username, channel, password) {
            connectChess(username, channel, password);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Chess] Page loaded');

    initializeConnectionModal();

    // Process shared link
    if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
        MiniGameUtils.processSharedLinkAndAutoConnect({
            gameName: 'Chess',
            storagePrefix: 'chess_',
            connectCallback: async function() {
                const username = document.getElementById('usernameInput')?.value?.trim();
                const channel = document.getElementById('channelInput')?.value?.trim();
                const password = document.getElementById('passwordInput')?.value || '';

                if (username && channel) {
                    await connectChess(username, channel, password);
                }
            }
        });
    }

    // Show modal
    setTimeout(() => {
        const modal = document.getElementById('connectionModal');
        if (modal) modal.classList.add('active');
    }, 200);
});

