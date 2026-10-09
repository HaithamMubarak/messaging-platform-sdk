/** Developer portal sign-in. */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        const form = document.getElementById('loginForm');
        const email = document.getElementById('email');
        const password = document.getElementById('password');
        const button = document.getElementById('loginBtn');
        const errorBox = document.getElementById('loginError');
        const errorText = document.getElementById('loginErrorText');
        const reveal = document.getElementById('revealPassword');
        const googleButton = document.getElementById('googleLoginBtn');
        const googleLabel = document.getElementById('googleLoginLabel');
        const googleSwitch = document.getElementById('googleSwitchBtn');
        const googleStatus = document.getElementById('googleStatus');
        const accessNotice = document.getElementById('platformAccessNotice');
        const accessTitle = document.getElementById('platformAccessTitle');
        const accessText = document.getElementById('platformAccessText');
        const accessLink = document.getElementById('platformAccessLink');
        const query = new URLSearchParams(window.location.search);
        const startMode = query.get('start') === 'free';
        let canContinueCurrentIdentity = false;

        if (new URLSearchParams(window.location.search).get('expired')) {
            showError('Your session expired. Please sign in again.');
            history.replaceState(null, '', window.location.pathname);
        }

        reveal.addEventListener('click', function () {
            const shown = password.type === 'text';
            password.type = shown ? 'password' : 'text';
            reveal.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
            reveal.innerHTML = '';
            reveal.appendChild(UI.iconNode(shown ? 'eye' : 'eye-off', 'icon--sm'));
        });

        function setFieldError(input, message) {
            const field = input.closest('.field');
            const err = field.querySelector('.field__error');
            if (message) {
                field.dataset.state = 'invalid';
                input.setAttribute('aria-invalid', 'true');
                err.textContent = message;
            } else {
                delete field.dataset.state;
                input.removeAttribute('aria-invalid');
                err.textContent = '';
            }
        }

        function showError(message) {
            errorText.textContent = message;
            errorBox.hidden = false;
        }

        function clearGoogleReturn() {
            const url = new URL(window.location.href);
            url.searchParams.delete('google');
            history.replaceState(null, '', url.pathname + url.search);
        }

        async function completeGoogleLogin() {
            errorBox.hidden = true;
            googleButton.hidden = false;
            googleStatus.textContent = 'Verifying your developer access...';
            googleButton.disabled = true;
            googleSwitch.disabled = true;
            try {
                const assertion = await MPAccount.googleLoginAssertion();
                if (startMode) await DeveloperAPI.startFree(assertion);
                else await DeveloperAPI.loginWithGoogle(assertion);
                googleStatus.textContent = 'Access verified. Opening your workspace...';
                window.location.replace('dashboard.html');
            } catch (err) {
                googleStatus.textContent = '';
                googleButton.disabled = false;
                googleSwitch.disabled = false;
                clearGoogleReturn();
                // 404: a messaging-service older than self-service. To the
                // visitor that is the same as signup being switched off.
                const closed = startMode &&
                    (err.selfService === false || err.status === 503 || err.status === 404);
                if (closed) showSignupClosed();
                showError(closed && err.status === 404
                    ? 'Free signup is not open yet. Request access and we will email your key.'
                    : err.message || 'Google sign-in could not be completed.');
            }
        }

        function openGoogleChooser() {
            googleStatus.textContent = 'Opening Google sign-in...';
            const returnTo = window.location.pathname + '?google=1' + (startMode ? '&start=free' : '');
            window.location.assign(MPAccount.googleStartUrl(returnTo));
        }

        /* "Start free" arrives as ?start=free from the hub, pricing and the
           quickstart. Same card, same Google button — it just creates the Free
           account when there is none, where plain sign-in would refuse. */
        function applyStartMode() {
            document.getElementById('signInTitle').textContent = 'Create your free account';
            document.getElementById('signInLead').textContent =
                'Continue with Google using your HMDev account. We open a developer account on the Free plan and show your first API key.';
            googleLabel.textContent = 'Start free with Google';
            document.getElementById('authAside').textContent =
                'Free during the public beta. No credit card. Already have an account? Google signs you straight in.';
        }

        /* The server has self-service switched off (or hit its daily cap): the
           request-and-approve path still works, so point at it. */
        function showSignupClosed() {
            accessNotice.hidden = false;
            accessNotice.dataset.state = 'none';
            accessTitle.textContent = 'Free signup is not open right now';
            accessText.textContent = 'Request access instead and we will email your key.';
            accessLink.textContent = 'Request API access';
        }

        googleButton.addEventListener('click', function () {
            if (canContinueCurrentIdentity) {
                completeGoogleLogin();
                return;
            }
            openGoogleChooser();
        });

        googleSwitch.addEventListener('click', openGoogleChooser);

        function showPlatformAccess(state) {
            accessNotice.hidden = false;
            accessNotice.dataset.state = String(state.status || 'NONE').toLowerCase();
            canContinueCurrentIdentity = state.status === 'ACTIVE' && !!state.hasAccess;
            googleSwitch.hidden = true;

            if (canContinueCurrentIdentity) {
                accessTitle.textContent = 'Developer access active';
                accessText.textContent = (state.developerEmail || state.verifiedEmail) +
                    ' · ' + (state.plan || 'Free') + ' plan';
                googleLabel.textContent = 'Continue as ' + (state.developerName || 'developer');
                googleSwitch.hidden = false;
                accessLink.textContent = 'View unified profile';
                return;
            }
            if (state.status === 'PENDING') {
                accessTitle.textContent = 'API request pending';
                accessText.textContent = 'This identity is waiting for administrator approval.';
                googleLabel.textContent = 'Use another Google account';
                accessLink.textContent = 'View request status';
                return;
            }
            if (state.status === 'INACTIVE') {
                accessTitle.textContent = 'Developer access inactive';
                accessText.textContent = 'Contact platform support or use another approved account.';
                googleLabel.textContent = 'Use another Google account';
                return;
            }
            accessTitle.textContent = 'Developer access not requested';
            accessText.textContent = 'Request approval from your HMDev profile.';
            googleLabel.textContent = 'Use another Google account';
            accessLink.textContent = 'Request API access';
        }

        function inspectPlatformIdentity() {
            if (!MPAccount.signedIn()) return Promise.resolve();
            googleStatus.textContent = 'Checking your HMDev account...';
            return MPAccount.googleLoginAssertion()
                .then(function (assertion) { return DeveloperAPI.getPlatformAccess(assertion); })
                .then(function (state) {
                    googleStatus.textContent = '';
                    showPlatformAccess(state);
                })
                .catch(function () {
                    googleStatus.textContent = '';
                });
        }

        if (startMode) applyStartMode();

        MPAccount.googleAvailable().then(function (available) {
            googleButton.hidden = !available;
            // In start mode every outcome of the identity check is "continue",
            // so its "not requested" wording would only mislead.
            if (available && !startMode && query.get('google') !== '1') inspectPlatformIdentity();
            // Start free is Google-only; without it, say so and offer the request path.
            if (!available && startMode) showSignupClosed();
        });

        /* A Google round trip that failed returns here (?google=1) with its
           reason in #googleError. There is no session to verify then, so say
           why instead of asking the portal about an identity that never came. */
        function takeGoogleError() {
            const message = typeof MPAccount.takeGoogleError === 'function'
                ? MPAccount.takeGoogleError() : null;
            if (!message) return false;
            clearGoogleReturn();
            showError('Google sign-in did not finish: ' + message);
            return true;
        }

        if (!takeGoogleError() && query.get('google') === '1') {
            completeGoogleLogin();
        }

        [email, password].forEach((input) => {
            input.addEventListener('blur', () => {
                if (input.value && !input.checkValidity()) {
                    setFieldError(input, input.type === 'email' ? 'Enter a valid email address.' : 'This field is required.');
                } else setFieldError(input, null);
            });
        });

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            errorBox.hidden = true;

            let firstInvalid = null;
            if (!email.value.trim() || !email.checkValidity()) {
                setFieldError(email, 'Enter a valid email address.');
                firstInvalid = firstInvalid || email;
            } else setFieldError(email, null);

            if (!password.value) {
                setFieldError(password, 'Enter your password.');
                firstInvalid = firstInvalid || password;
            } else setFieldError(password, null);

            if (firstInvalid) { firstInvalid.focus(); return; }

            await UI.withBusy(button, async function () {
                try {
                    await DeveloperAPI.login(email.value.trim(), password.value);
                    const profile = DeveloperAPI.getProfile();
                    window.location.replace(
                        profile && profile.passwordChangeRequired ? 'change-password.html' : 'dashboard.html'
                    );
                } catch (err) {
                    showError(err.message || 'Sign-in failed. Check your email and password.');
                    password.value = '';
                    password.focus();
                }
            });
        });
    });
})();
