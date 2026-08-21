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
