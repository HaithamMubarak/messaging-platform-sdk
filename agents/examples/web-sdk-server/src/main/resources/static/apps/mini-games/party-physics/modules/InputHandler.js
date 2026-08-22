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

        // Action keys latch on the way down and are cleared once a packet has
        // carried them. Edge detection alone compared the key state at two
        // consecutive samples, so a tap that began and ended between them was
        // dropped — the player pressed jump and nothing happened.
        this.pressed = {};

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
        this.pressed = {};
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

        // Latch only a genuine press. Holding a key repeats keydown, and
        // re-latching there would fire the action once per repeat.
        const k = e.key.toLowerCase();
        if (!this.keys[k]) this.pressed[k] = true;
        this.keys[k] = true;
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

        // Actions fire once per press: either the key went down since the last
        // packet (the latch, which survives a tap shorter than one tick) or it
        // is newly held at this sample.
        const took = (k, was) => !!this.pressed[k] || (this.keys[k] && !was);
        const jump = took(' ', this.inputState.jump);
        const dash = took('shift', this.inputState.dash);
        const punch = took('control', this.inputState.punch);
        const ability = took('q', this.inputState.ability);
        this.pressed = {};

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

