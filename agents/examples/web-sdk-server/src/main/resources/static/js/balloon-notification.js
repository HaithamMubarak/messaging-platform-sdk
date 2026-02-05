/**
 * Balloon Notification Component
 *
 * A reusable balloon/tooltip notification system that can be attached to any element.
 * Features:
 * - Fixed positioning with high z-index
 * - Customizable text, icon, and styling
 * - Auto-hide with configurable duration
 * - Show limit tracking (localStorage)
 * - Smooth animations
 * - Mobile-friendly
 *
 * Usage:
 * BalloonNotification.show({
 *     targetElement: document.getElementById('myButton'),
 *     text: 'Click here to share!',
 *     icon: '👋',
 *     duration: 5000,
 *     maxShows: 3,
 *     storageKey: 'my-balloon-count'
 * });
 */

const BalloonNotification = (function() {
    'use strict';

    // Default configuration
    const defaults = {
        text: 'Notification',
        icon: '💡',
        duration: 5000,              // Auto-hide after 5 seconds (0 = permanent)
        maxShows: 3,                 // Show max 3 times (0 = unlimited)
        storageKey: 'balloon_notification_count',
        position: 'bottom',          // 'top', 'bottom', 'left', 'right'
        offset: 12,                  // Distance from target element (px)
        backgroundColor: '#1e293b',  // Dark slate background (highly visible)
        textColor: '#ffffff',
        fontSize: '14px',
        fontWeight: '600',
        padding: '14px 20px',
        borderRadius: '10px',
        maxWidth: '320px',
        border: '2px solid #f59e0b', // Amber border for high contrast
        zIndex: 999999,
        animationDuration: '0.5s',
        highlightTarget: true,       // Add pulsing animation to target
        onShow: null,                // Callback when shown
        onHide: null,                // Callback when hidden
        debugMode: false             // If true, ignores maxShows and duration
    };

    /**
     * Show a balloon notification
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.targetElement - Element to attach balloon to (required)
     * @param {string} options.text - Text to display
     * @param {string} options.icon - Icon emoji
     * @param {number} options.duration - Auto-hide duration (ms), 0 = permanent
     * @param {number} options.maxShows - Max times to show, 0 = unlimited
     * @param {string} options.storageKey - localStorage key for tracking
     * @param {string} options.position - 'top', 'bottom', 'left', 'right'
     * @returns {Object} - { balloon: HTMLElement, hide: Function }
     */
    function show(options) {
        // Merge options with defaults
        const config = { ...defaults, ...options };

        // Validate required parameters
        if (!config.targetElement || !(config.targetElement instanceof HTMLElement)) {
            console.error('[BalloonNotification] targetElement is required and must be an HTMLElement');
            return null;
        }

        // Check show count (unless debug mode)
        if (!config.debugMode && config.maxShows > 0) {
            let showCount = parseInt(localStorage.getItem(config.storageKey) || '0');
            if (showCount >= config.maxShows) {
                console.log(`[BalloonNotification] Already shown ${config.maxShows} times, skipping`);
                return null;
            }
        }

        try {
            // Ensure target has positioning context
            const targetPos = window.getComputedStyle(config.targetElement).position;
            if (targetPos === 'static') {
                config.targetElement.style.position = 'relative';
            }

            // Create balloon element
            const balloon = document.createElement('div');
            balloon.className = 'balloon-notification';
            balloon.setAttribute('role', 'tooltip');
            balloon.setAttribute('aria-live', 'polite');

            // Build content
            const iconSpan = document.createElement('span');
            iconSpan.className = 'balloon-icon';
            iconSpan.textContent = config.icon;

            const textSpan = document.createElement('span');
            textSpan.className = 'balloon-text';
            textSpan.textContent = config.text;

            balloon.appendChild(iconSpan);
            balloon.appendChild(textSpan);

            // Apply inline styles
            applyStyles(balloon, config);

            // Create arrow
            const arrow = document.createElement('div');
            arrow.className = 'balloon-arrow';
            applyArrowStyles(arrow, config);
            balloon.appendChild(arrow);

            // IMPORTANT: Append to document.body for proper fixed positioning
            // Appending to target element can cause offset issues if parent has transforms
            document.body.appendChild(balloon);

            // Add highlight to target (optional)
            if (config.highlightTarget) {
                config.targetElement.classList.add('balloon-target-highlight');
            }

            // Trigger animation
            setTimeout(() => {
                balloon.classList.add('balloon-visible');
            }, 10);

            // Reposition balloon on window resize or scroll to keep it aligned with target
            const repositionHandler = () => {
                if (balloon.parentNode) {
                    positionBalloon(balloon, config);
                }
            };
            window.addEventListener('resize', repositionHandler);
            window.addEventListener('scroll', repositionHandler, true); // Use capture for all scroll events

            // Auto-hide after duration (unless duration is 0 or debug mode)
            let hideTimeout = null;
            if (!config.debugMode && config.duration > 0) {
                hideTimeout = setTimeout(() => {
                    // Clean up listeners before hiding
                    window.removeEventListener('resize', repositionHandler);
                    window.removeEventListener('scroll', repositionHandler, true);
                    hideBalloon(balloon, config);
                }, config.duration);
            }

            // Increment show count
            if (!config.debugMode && config.maxShows > 0) {
                let showCount = parseInt(localStorage.getItem(config.storageKey) || '0');
                showCount++;
                localStorage.setItem(config.storageKey, showCount.toString());
                console.log(`[BalloonNotification] Shown ${showCount}/${config.maxShows} times`);
            }

            // Callback
            if (typeof config.onShow === 'function') {
                config.onShow(balloon);
            }

            // Debug logging
            if (config.debugMode) {
                console.log('[BalloonNotification] ⚠️ DEBUG MODE - Balloon will stay visible');
                console.log('[BalloonNotification] Balloon element:', balloon);
                console.log('[BalloonNotification] Computed styles:', window.getComputedStyle(balloon));
            }

            // Return control object
            return {
                balloon: balloon,
                hide: function() {
                    if (hideTimeout) clearTimeout(hideTimeout);
                    // Clean up listeners
                    window.removeEventListener('resize', repositionHandler);
                    window.removeEventListener('scroll', repositionHandler, true);
                    hideBalloon(balloon, config);
                },
                reposition: function() {
                    repositionHandler();
                }
            };

        } catch (e) {
            console.error('[BalloonNotification] Error showing balloon:', e);
            return null;
        }
    }

    /**
     * Hide a balloon with animation
     */
    function hideBalloon(balloon, config) {
        if (!balloon || !balloon.parentNode) return;

        balloon.classList.remove('balloon-visible');
        balloon.classList.add('balloon-hiding');

        setTimeout(() => {
            if (balloon.parentNode) {
                balloon.parentNode.removeChild(balloon);
            }

            // Remove highlight from target
            if (config.highlightTarget && config.targetElement) {
                config.targetElement.classList.remove('balloon-target-highlight');
            }

            // Callback
            if (typeof config.onHide === 'function') {
                config.onHide();
            }
        }, 300);
    }

    /**
     * Apply styles to balloon element
     */
    function applyStyles(balloon, config) {
        balloon.style.position = 'fixed';
        balloon.style.background = config.backgroundColor;
        balloon.style.color = config.textColor;
        balloon.style.fontSize = config.fontSize;
        balloon.style.fontWeight = config.fontWeight || '600';
        balloon.style.padding = config.padding;
        balloon.style.borderRadius = config.borderRadius;
        balloon.style.border = config.border || 'none';
        balloon.style.maxWidth = config.maxWidth;
        balloon.style.minHeight = '40px';
        balloon.style.width = 'max-content';
        balloon.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)'; // Strong shadow for visibility
        balloon.style.zIndex = config.zIndex;
        balloon.style.pointerEvents = 'none';
        balloon.style.display = 'flex';
        balloon.style.alignItems = 'center';
        balloon.style.justifyContent = 'center';
        balloon.style.gap = '6px';
        balloon.style.lineHeight = '1.4';
        balloon.style.opacity = '0';
        balloon.style.transition = `opacity ${config.animationDuration} ease-out, transform ${config.animationDuration} ease-out`;

        // Position balloon relative to target
        positionBalloon(balloon, config);
    }

    /**
     * Position balloon relative to target element
     * Uses viewport coordinates for position:fixed (no scroll offset needed)
     */
    function positionBalloon(balloon, config) {
        const rect = config.targetElement.getBoundingClientRect();

        // position:fixed uses viewport coordinates
        // getBoundingClientRect() returns viewport-relative coords
        // No scroll offset should be added!

        let top, left, transform;

        switch (config.position) {
            case 'top':
                top = rect.top - config.offset;
                left = rect.left + (rect.width / 2);
                transform = 'translate(-50%, -100%)';
                balloon.style.transformOrigin = 'bottom center';
                balloon.dataset.position = 'top';
                break;

            case 'bottom':
                top = rect.bottom + config.offset;
                left = rect.left + (rect.width / 2);
                transform = 'translateX(-50%)';
                balloon.style.transformOrigin = 'top center';
                balloon.dataset.position = 'bottom';
                break;

            case 'left':
                top = rect.top + (rect.height / 2);
                left = rect.left - config.offset;
                transform = 'translate(-100%, -50%)';
                balloon.style.transformOrigin = 'right center';
                balloon.dataset.position = 'left';
                break;

            case 'right':
                top = rect.top + (rect.height / 2);
                left = rect.right + config.offset;
                transform = 'translateY(-50%)';
                balloon.style.transformOrigin = 'left center';
                balloon.dataset.position = 'right';
                break;

            default:
                console.warn('[BalloonNotification] Invalid position:', config.position);
                top = rect.bottom + config.offset;
                left = rect.left + (rect.width / 2);
                transform = 'translateX(-50%)';
                balloon.dataset.position = 'bottom';
        }

        // Apply position using fixed positioning (stays in viewport)
        balloon.style.top = Math.round(top) + 'px';
        balloon.style.left = Math.round(left) + 'px';
        balloon.style.transform = transform;

        // Debug logging
        if (config.debugMode) {
            const balloonRect = balloon.getBoundingClientRect();
            const btnCenterX = rect.left + (rect.width / 2);
            const balloonCenterX = balloonRect.left + (balloonRect.width / 2);

            console.log('[BalloonNotification] Position calculated:', {
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                },
                targetButton: {
                    top: rect.top,
                    left: rect.left,
                    bottom: rect.bottom,
                    right: rect.right,
                    width: rect.width,
                    height: rect.height,
                    centerX: btnCenterX,
                    centerY: rect.top + (rect.height / 2)
                },
                balloonPosition: {
                    top: Math.round(top),
                    left: Math.round(left),
                    transform: transform
                },
                balloonActual: {
                    top: balloonRect.top,
                    left: balloonRect.left,
                    width: balloonRect.width,
                    centerX: balloonCenterX
                },
                alignment: {
                    buttonCenterX: Math.round(btnCenterX),
                    balloonCenterX: Math.round(balloonCenterX),
                    difference: Math.round(Math.abs(btnCenterX - balloonCenterX)),
                    aligned: Math.abs(btnCenterX - balloonCenterX) < 2 ? '✅ YES' : '❌ NO'
                }
            });
        }
    }

    /**
     * Apply styles to arrow element
     */
    function applyArrowStyles(arrow, config) {
        arrow.style.position = 'absolute';
        arrow.style.width = '0';
        arrow.style.height = '0';

        // Use the background color directly (no gradient detection needed)
        const arrowColor = config.backgroundColor;

        switch (config.position) {
            case 'top':
                arrow.style.top = '100%';
                arrow.style.left = '50%';
                arrow.style.transform = 'translateX(-50%)';
                arrow.style.borderLeft = '8px solid transparent';
                arrow.style.borderRight = '8px solid transparent';
                arrow.style.borderTop = `8px solid ${arrowColor}`;
                break;

            case 'bottom':
                arrow.style.bottom = '100%';
                arrow.style.left = '50%';
                arrow.style.transform = 'translateX(-50%)';
                arrow.style.borderLeft = '8px solid transparent';
                arrow.style.borderRight = '8px solid transparent';
                arrow.style.borderBottom = `8px solid ${arrowColor}`;
                break;

            case 'left':
                arrow.style.left = '100%';
                arrow.style.top = '50%';
                arrow.style.transform = 'translateY(-50%)';
                arrow.style.borderTop = '8px solid transparent';
                arrow.style.borderBottom = '8px solid transparent';
                arrow.style.borderLeft = `8px solid ${arrowColor}`;
                break;

            case 'right':
                arrow.style.right = '100%';
                arrow.style.top = '50%';
                arrow.style.transform = 'translateY(-50%)';
                arrow.style.borderTop = '8px solid transparent';
                arrow.style.borderBottom = '8px solid transparent';
                arrow.style.borderRight = `8px solid ${arrowColor}`;
                break;
        }
    }

    /**
     * Inject required CSS styles
     */
    function injectStyles() {
        if (document.getElementById('balloon-notification-styles')) return;

        const style = document.createElement('style');
        style.id = 'balloon-notification-styles';
        style.textContent = `
            /* Balloon visible state */
            .balloon-notification.balloon-visible {
                opacity: 1 !important;
            }

            /* Balloon hiding state */
            .balloon-notification.balloon-hiding {
                opacity: 0 !important;
                transform: translate(-50%, 10px) !important;
            }

            /* Icon animation */
            .balloon-icon {
                display: inline-block;
                animation: balloonIconPulse 1s ease-in-out infinite;
            }

            @keyframes balloonIconPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.2); }
            }

            /* Target highlight animation */
            .balloon-target-highlight {
                animation: balloonTargetPulse 2s ease-in-out infinite !important;
            }

            @keyframes balloonTargetPulse {
                0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
                50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
                100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Reset show count for a specific storage key
     */
    function resetCount(storageKey) {
        localStorage.removeItem(storageKey || defaults.storageKey);
        console.log('[BalloonNotification] Show count reset');
    }

    /**
     * Hide all visible balloons
     */
    function hideAll() {
        const balloons = document.querySelectorAll('.balloon-notification');
        balloons.forEach(balloon => {
            if (balloon.parentNode) {
                balloon.parentNode.removeChild(balloon);
            }
        });

        const highlights = document.querySelectorAll('.balloon-target-highlight');
        highlights.forEach(el => {
            el.classList.remove('balloon-target-highlight');
        });

        console.log(`[BalloonNotification] Hidden ${balloons.length} balloon(s)`);
    }

    // Auto-inject styles on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    // Public API
    return {
        show: show,
        resetCount: resetCount,
        hideAll: hideAll,
        defaults: defaults
    };

})();

// Make BalloonNotification globally accessible
window.BalloonNotification = BalloonNotification;

// Log successful initialization
console.log('[BalloonNotification] Component loaded successfully');
console.log('[BalloonNotification] Available methods:', Object.keys(BalloonNotification));
console.log('[BalloonNotification] window.BalloonNotification:', typeof window.BalloonNotification);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BalloonNotification;
}
