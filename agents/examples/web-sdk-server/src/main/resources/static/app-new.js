// Modern Landing Page Scripts - Messaging Platform SDK

// ===== Configuration =====
const CONFIG = {
    urls: {
        docs: 'docs.html',
        github: 'https://github.com/HaithamMubarak/messaging-platform-sdk',
        portal: 'developer/index.html',
        demos: {
            whiteboard: 'apps/whiteboard/index.html',
            airHockey: 'apps/mini-games/air-hockey/index.html',
            quickShare: 'apps/quickshare/quickshare.html',
            chat: 'apps/chat/index.html',
            video: 'apps/video/index.html',
            connectionTester: 'apps/test-api-key/index.html'
        }
    },
    storage: {
        uiPreferenceKey: 'mp_sdk_ui'
    }
};

// ===== UI Preference Management =====
function getUIPreference() {
    try {
        return localStorage.getItem(CONFIG.storage.uiPreferenceKey);
    } catch (e) {
        console.warn('localStorage not available:', e);
        return null;
    }
}

function setUIPreference(preference) {
    try {
        localStorage.setItem(CONFIG.storage.uiPreferenceKey, preference);
    } catch (e) {
        console.warn('localStorage not available:', e);
    }
}

// ===== Auto-redirect based on preference =====
function handleUIPreference() {
    const currentPage = window.location.pathname;
    const preference = getUIPreference();

    // If on legacy UI and user prefers new UI, redirect
    if (preference === 'NEW' && currentPage.includes('index.html') && !currentPage.includes('index-new.html')) {
        window.location.href = 'index-new.html';
    }

    // If on new UI, set the preference
    if (currentPage.includes('index-new.html')) {
        setUIPreference('NEW');
    } else if (currentPage.includes('index.html')) {
        // Reset to legacy if explicitly navigating back
        if (document.referrer.includes('index-new.html')) {
            setUIPreference('LEGACY');
        }
    }
}

// ===== Copy to Clipboard Functionality =====
function setupCopyButtons() {
    const copyButtons = document.querySelectorAll('.copy-button');

    copyButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-copy-target');
            const codeElement = document.getElementById(targetId);

            if (!codeElement) return;

            const textToCopy = codeElement.textContent;

            try {
                await navigator.clipboard.writeText(textToCopy);

                // Visual feedback
                const originalHTML = button.innerHTML;
                button.classList.add('copied');
                button.innerHTML = `
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                    </svg>
                    Copied!
                `;

                setTimeout(() => {
                    button.classList.remove('copied');
                    button.innerHTML = originalHTML;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);

                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = textToCopy;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();

                try {
                    document.execCommand('copy');
                    button.textContent = 'Copied!';
                    setTimeout(() => {
                        button.textContent = 'Copy';
                    }, 2000);
                } catch (err2) {
                    console.error('Fallback copy failed:', err2);
                }

                document.body.removeChild(textArea);
            }
        });
    });
}

// ===== Smooth Scroll Enhancement =====
function setupSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// ===== Intersection Observer for Animations =====
function setupScrollAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe sections
    document.querySelectorAll('.section').forEach(section => {
        observer.observe(section);
    });
}

// ===== Performance Monitoring =====
function logPerformanceMetrics() {
    if ('performance' in window) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                const perfData = performance.getEntriesByType('navigation')[0];
                if (perfData) {
                    console.log('Page Load Performance:', {
                        domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart),
                        loadComplete: Math.round(perfData.loadEventEnd - perfData.loadEventStart),
                        domInteractive: Math.round(perfData.domInteractive - perfData.fetchStart)
                    });
                }
            }, 0);
        });
    }
}

// ===== Theme Detection =====
function detectAndLogTheme() {
    if (window.matchMedia) {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        console.log('Color scheme preference:', darkModeQuery.matches ? 'dark' : 'light');

        // Listen for theme changes
        darkModeQuery.addEventListener('change', (e) => {
            console.log('Color scheme changed to:', e.matches ? 'dark' : 'light');
        });
    }
}

// ===== Analytics Helper (Optional) =====
function trackEvent(eventName, eventData = {}) {
    // Placeholder for analytics tracking
    // Implement your analytics tracking here (e.g., Google Analytics, Plausible, etc.)
    console.log('Event:', eventName, eventData);
}

// ===== Track Demo Clicks =====
function setupDemoTracking() {
    document.querySelectorAll('.demo-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const demoName = link.closest('.demo-card')?.querySelector('.demo-title')?.textContent;
            trackEvent('demo_clicked', { demo: demoName });
        });
    });

    document.querySelectorAll('.btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const buttonText = button.textContent.trim();
            trackEvent('cta_clicked', { button: buttonText });
        });
    });
}

// ===== Keyboard Navigation Enhancement =====
function setupKeyboardNavigation() {
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Press 'D' to go to docs
        if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
            window.location.href = CONFIG.urls.docs;
        }

        // Press 'G' to go to GitHub
        if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
            window.open(CONFIG.urls.github, '_blank');
        }

        // Press '?' to show keyboard shortcuts (can be expanded)
        if (e.key === '?' && !isInputFocused()) {
            showKeyboardShortcuts();
        }
    });
}

function isInputFocused() {
    const activeElement = document.activeElement;
    return activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );
}

function showKeyboardShortcuts() {
    // Simple alert for now; can be replaced with a modal
    alert('Keyboard Shortcuts:\n\nD - Go to Docs\nG - Go to GitHub\n? - Show this help');
}

// ===== Error Handling =====
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
});

// ===== Initialize Everything =====
function init() {
    console.log('🚀 Messaging Platform SDK - New UI Loaded');

    // Handle UI preference and redirects
    handleUIPreference();

    // Setup interactive features
    setupCopyButtons();
    setupSmoothScrolling();
    setupScrollAnimations();
    setupDemoTracking();
    setupKeyboardNavigation();

    // Performance and theme
    logPerformanceMetrics();
    detectAndLogTheme();

    console.log('✅ All features initialized');
}

// ===== Run on DOM Ready =====
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ===== Export for debugging =====
window.MP_SDK = {
    config: CONFIG,
    getUIPreference,
    setUIPreference,
    trackEvent
};

