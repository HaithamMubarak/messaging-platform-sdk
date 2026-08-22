/**
 * MobileControls.js
 * Virtual joystick and touch buttons for mobile devices
 */

class MobileControls {
    constructor(inputHandler) {
        this.inputHandler = inputHandler;

        // Elements
        this.container = null;
        this.joystickContainer = null;
        this.joystickBase = null;
        this.joystickStick = null;
        this.jumpBtn = null;
        this.dashBtn = null;
        this.punchBtn = null;
        this.abilityBtn = null;

        // Joystick state
        this.joystick = {
            active: false,
            startX: 0,
            startY: 0,
            moveX: 0,
            moveY: 0,
            touchId: null
        };

        // Button states
        this.buttons = {
            jump: false,
            dash: false,
            punch: false,
            ability: false
        };

        // Cooldowns
        this.cooldowns = {
            jump: 0,
            dash: 0,
            punch: 0,
            ability: 0
        };

        this.enabled = false;

        console.log('[MobileControls] Created');
    }

    /**
     * Initialize mobile controls
     */
    init() {
        this.container = document.getElementById('mobileControls');
        if (!this.container) {
            console.error('[MobileControls] Container not found');
            return;
        }

        this.joystickContainer = document.getElementById('joystickContainer');
        this.joystickBase = document.getElementById('joystickBase');
        this.joystickStick = document.getElementById('joystickStick');

        this.jumpBtn = document.getElementById('jumpBtn');
        this.dashBtn = document.getElementById('dashBtn');
        this.punchBtn = document.getElementById('punchBtn');
        this.abilityBtn = document.getElementById('abilityBtn');

        // Setup joystick
        this.setupJoystick();

        // Setup buttons
        this.setupButtons();

        console.log('[MobileControls] Initialized');
    }

    /**
     * Setup virtual joystick
     */
    setupJoystick() {
        if (!this.joystickContainer) return;

        // Touch start
        this.joystickContainer.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.joystick.active = true;
            this.joystick.touchId = touch.identifier;

            const rect = this.joystickBase.getBoundingClientRect();
            this.joystick.startX = rect.left + rect.width / 2;
            this.joystick.startY = rect.top + rect.height / 2;

            this.updateJoystick(touch.clientX, touch.clientY);
        });

        // Touch move
        this.joystickContainer.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!this.joystick.active) return;

            const touch = Array.from(e.touches).find(t => t.identifier === this.joystick.touchId);
            if (touch) {
                this.updateJoystick(touch.clientX, touch.clientY);
            }
        });

        // Touch end
        this.joystickContainer.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.joystick.active = false;
            this.joystick.moveX = 0;
            this.joystick.moveY = 0;
            this.joystickStick.style.transform = 'translate(-50%, -50%)';
        });
    }

    /**
     * Update joystick position
     */
    updateJoystick(touchX, touchY) {
        const dx = touchX - this.joystick.startX;
        const dy = touchY - this.joystick.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = 45; // Half of joystick base radius

        if (distance > maxDistance) {
            this.joystick.moveX = (dx / distance) * maxDistance;
            this.joystick.moveY = (dy / distance) * maxDistance;
        } else {
            this.joystick.moveX = dx;
            this.joystick.moveY = dy;
        }

        // Update stick position
        this.joystickStick.style.transform = `translate(calc(-50% + ${this.joystick.moveX}px), calc(-50% + ${this.joystick.moveY}px))`;

        // Update input handler
        const normalizedX = this.joystick.moveX / maxDistance;
        const normalizedY = this.joystick.moveY / maxDistance;

        this.inputHandler.setMobileInput(normalizedX, normalizedY);
    }

    /**
     * Setup action buttons
     */
    setupButtons() {
        if (this.jumpBtn) {
            this.setupButton(this.jumpBtn, 'jump');
        }
        if (this.dashBtn) {
            this.setupButton(this.dashBtn, 'dash');
        }
        if (this.punchBtn) {
            this.setupButton(this.punchBtn, 'punch');
        }
        if (this.abilityBtn) {
            this.setupButton(this.abilityBtn, 'ability');
        }
    }

    /**
     * Setup individual button
     */
    setupButton(button, action) {
        button.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.cooldowns[action] <= 0) {
                this.buttons[action] = true;
                button.classList.add('active');
            }
        });

        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            // Deliberately not clearing this.buttons[action] here. A tap lasts
            // about fifty milliseconds, and getInputPacket() samples on the
            // game's own loop — so lifting the finger used to erase the press
            // before anything had read it, and the button did nothing at all.
            // The press is consumed by getInputPacket(), which resets it there;
            // clearing it here was redundant as well as lossy.
            button.classList.remove('active');
        });
    }

    /**
     * Get input packet
     */
    getInputPacket() {
        const packet = this.inputHandler.getMobileInputPacket(
            this.buttons.jump,
            this.buttons.dash,
            this.buttons.punch,
            this.buttons.ability
        );

        // Reset button states after reading
        this.buttons.jump = false;
        this.buttons.dash = false;
        this.buttons.punch = false;
        this.buttons.ability = false;

        return packet;
    }

    /**
     * Update cooldowns
     */
    updateCooldowns(dt) {
        Object.keys(this.cooldowns).forEach(key => {
            if (this.cooldowns[key] > 0) {
                this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);

                // Update button visual state
                const btn = this[key + 'Btn'];
                if (btn) {
                    if (this.cooldowns[key] > 0) {
                        btn.classList.add('disabled');
                    } else {
                        btn.classList.remove('disabled');
                    }
                }
            }
        });
    }

    /**
     * Set ability cooldown
     */
    setAbilityCooldown(duration) {
        this.cooldowns.ability = duration;
    }

    /**
     * Show mobile controls
     */
    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
            this.enabled = true;
        }
    }

    /**
     * Hide mobile controls
     */
    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
            this.enabled = false;
        }
    }

    /**
     * Check if device is mobile
     */
    static isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.innerWidth <= 768);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MobileControls };
}

