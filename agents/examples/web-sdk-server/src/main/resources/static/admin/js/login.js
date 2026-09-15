/** Admin console sign-in. */
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
        const googleStatus = document.getElementById('googleStatus');
        const query = new URLSearchParams(window.location.search);

        // Make the target environment unmissable before anyone signs in.
        const env = ApiConfig.environment();
        const badge = document.getElementById('envBadge');
        badge.className = 'env-badge ' + (env === 'production' ? 'env-badge--production' : 'env-badge--other');
        document.getElementById('envBadgeText').textContent =
            env === 'production' ? 'Production data' : env + ' environment';

        if (new URLSearchParams(window.location.search).get('expired')) {
            errorText.textContent = 'Your admin session expired. Please sign in again.';
            errorBox.hidden = false;
            history.replaceState(null, '', window.location.pathname);
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
            googleButton.disabled = true;
            googleStatus.textContent = 'Verifying administrator privileges...';
            try {
                const assertion = await MPAccount.googleLoginAssertion();
                await AdminAPI.loginWithGoogle(assertion);
                googleStatus.textContent = 'Access verified. Opening the console...';
                window.location.replace('dashboard.html');
            } catch (err) {
                googleStatus.textContent = '';
                googleButton.disabled = false;
                clearGoogleReturn();
                showError(err.message || 'Google sign-in could not be completed.');
            }
        }

        googleButton.addEventListener('click', function () {
            googleStatus.textContent = 'Opening Google sign-in...';
            const returnTo = window.location.pathname + '?google=1';
            window.location.assign(MPAccount.googleStartUrl(returnTo));
        });

        MPAccount.googleAvailable().then(function (available) {
            googleButton.hidden = !available;
        });

        if (query.get('google') === '1') {
            completeGoogleLogin();
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
            const err = document.getElementById(input.id + 'Error');
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

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            errorBox.hidden = true;

            let invalid = null;
            if (!email.value.trim() || !email.checkValidity()) {
                setFieldError(email, 'Enter a valid email address.');
                invalid = invalid || email;
            } else setFieldError(email, null);

            if (!password.value) {
                setFieldError(password, 'Enter your password.');
                invalid = invalid || password;
            } else setFieldError(password, null);

            if (invalid) { invalid.focus(); return; }

            await UI.withBusy(button, async function () {
                try {
                    await AdminAPI.login(email.value.trim(), password.value);
                    window.location.replace('dashboard.html');
                } catch (err) {
                    showError(err.message || 'Sign-in failed.');
                    password.value = '';
                    password.focus();
                }
            });
        });
    });
})();
