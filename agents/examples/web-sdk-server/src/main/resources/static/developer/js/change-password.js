/** Forced password change after a temporary credential is issued. */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        const form = document.getElementById('changeForm');
        const button = document.getElementById('changeBtn');
        const current = document.getElementById('currentPassword');
        const next = document.getElementById('newPassword');
        const confirmInput = document.getElementById('confirmPassword');

        function setError(input, message) {
            const field = input.closest('.field');
            const err = document.getElementById(input.id + 'Error');
            if (message) {
                field.dataset.state = 'invalid';
                input.setAttribute('aria-invalid', 'true');
                if (err) err.textContent = message;
                return false;
            }
            delete field.dataset.state;
            input.removeAttribute('aria-invalid');
            if (err) err.textContent = '';
            return true;
        }

        confirmInput.addEventListener('blur', function () {
            if (confirmInput.value && confirmInput.value !== next.value) {
                setError(confirmInput, 'The two passwords do not match.');
            } else setError(confirmInput, null);
        });

        form.addEventListener('submit', async function (event) {
            event.preventDefault();

            if (!current.value) { setError(current, 'Enter the temporary password you were sent.'); current.focus(); return; }
            setError(current, null);
            if (next.value.length < 8) { setError(next, 'Use at least 8 characters.'); next.focus(); return; }
            setError(next, null);
            if (confirmInput.value !== next.value) {
                setError(confirmInput, 'The two passwords do not match.');
                confirmInput.focus();
                return;
            }
            setError(confirmInput, null);

            await UI.withBusy(button, async function () {
                try {
                    await DeveloperAPI.changePassword(current.value, next.value);
                    const profile = DeveloperAPI.getProfile();
                    if (profile) {
                        profile.passwordChangeRequired = false;
                        DeveloperAPI.setProfile(profile);
                    }
                    UI.toast.success('Password saved. Taking you to the portal…');
                    setTimeout(() => window.location.replace('dashboard.html'), 700);
                } catch (err) {
                    UI.toast.error(err.message || 'Could not change your password.');
                }
            });
        });
    });
})();
