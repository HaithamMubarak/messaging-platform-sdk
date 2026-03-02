/**
 * InputHandler.js
 * Handles keyboard and touch input
 */

class InputHandler {
    constructor() {
        this.keys = {};
        this.inputState = {
            moveX: 0,
            moveY: 0,
            jump: false,
            dash: false,
            punch: false,
            ability: false
        };

        this.inputSequence = 0;
        this.enabled = false;

        // Bind methods
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);

        console.log('[InputHandler] Created');
    }

    /**
     * Enable input handling
     */
    enable() {
        if (this.enabled) return;

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);

        this.enabled = true;
        console.log('[InputHandler] Enabled');
    }

    /**
     * Disable input handling
     */
    disable() {
        if (!this.enabled) return;

        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);

        this.keys = {};
        this.enabled = false;
        console.log('[InputHandler] Disabled');
    }

    /**
     * Handle keydown
     */
    onKeyDown(e) {
        // Prevent default for game keys
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift', 'control', 'q'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }

        this.keys[e.key.toLowerCase()] = true;
    }

    /**
     * Handle keyup
     */
    onKeyUp(e) {
        this.keys[e.key.toLowerCase()] = false;
    }

    /**
     * Get current input state
     * Returns input packet for sending to host
     */
    getInputState() {
        // Movement
        let moveX = 0;
        let moveY = 0;

        if (this.keys['a'] || this.keys['arrowleft']) moveX -= 1;
        if (this.keys['d'] || this.keys['arrowright']) moveX += 1;
        if (this.keys['w'] || this.keys['arrowup']) moveY -= 1;
        if (this.keys['s'] || this.keys['arrowdown']) moveY += 1;

        // Normalize diagonal movement
        if (moveX !== 0 && moveY !== 0) {
            const len = Math.sqrt(moveX * moveX + moveY * moveY);
            moveX /= len;
            moveY /= len;
        }

        // Actions (detect press, not hold)
        const jump = this.keys[' '] && !this.inputState.jump;
        const dash = this.keys['shift'] && !this.inputState.dash;
        const punch = this.keys['control'] && !this.inputState.punch;
        const ability = this.keys['q'] && !this.inputState.ability;

        // Update state
        this.inputState = {
            moveX,
            moveY,
            jump: this.keys[' '],
            dash: this.keys['shift'],
            punch: this.keys['control'],
            ability: this.keys['q']
        };

        // Return input packet
        this.inputSequence++;
        return {
            seq: this.inputSequence,
            t: Date.now(),
            moveX,
            moveY,
            jump,
            dash,
            punch,
            ability
        };
    }

    /**
     * Set input state from mobile controls
     */
    setMobileInput(moveX, moveY, actions) {
        this.inputState.moveX = moveX;
        this.inputState.moveY = moveY;

        if (actions) {
            this.inputState.jump = actions.jump || false;
            this.inputState.dash = actions.dash || false;
            this.inputState.punch = actions.punch || false;
            this.inputState.ability = actions.ability || false;
        }
    }

    /**
     * Get input packet from mobile state
     */
    getMobileInputPacket(jump, dash, punch, ability) {
        this.inputSequence++;
        return {
            seq: this.inputSequence,
            t: Date.now(),
            moveX: this.inputState.moveX,
            moveY: this.inputState.moveY,
            jump: jump || false,
            dash: dash || false,
            punch: punch || false,
            ability: ability || false
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { InputHandler };
}

