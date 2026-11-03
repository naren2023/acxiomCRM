// Client-side form validation for AcxiomCRM
document.addEventListener('DOMContentLoaded', () => {
  const forms = document.querySelectorAll('form[data-validate="true"]');

  forms.forEach(form => {
    form.addEventListener('submit', (event) => {
      let isValid = true;

      // Clear previous error styles and messages
      form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
      form.querySelectorAll('.custom-feedback').forEach(el => el.remove());

      function showError(input, message) {
        isValid = false;
        input.classList.add('is-invalid');
        const feedback = document.createElement('div');
        feedback.className = 'invalid-feedback custom-feedback';
        feedback.innerText = message;
        if (input.nextSibling) {
          input.parentNode.insertBefore(feedback, input.nextSibling);
        } else {
          input.parentNode.appendChild(feedback);
        }
      }

      // Validate required inputs
      const requiredInputs = form.querySelectorAll('[required]');
      requiredInputs.forEach(input => {
        if (!input.value || input.value.trim() === '') {
          const fieldName = input.getAttribute('data-field-name') || input.name || 'This field';
          showError(input, `${fieldName} is required.`);
        }
      });

      // Validate Email format
      const emailInputs = form.querySelectorAll('input[type="email"], input[data-type="email"]');
      emailInputs.forEach(input => {
        const val = input.value.trim();
        if (val) {
          const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailPattern.test(val)) {
            showError(input, 'Enter a valid email address.');
          }
        }
      });

      // Validate 10-digit phone
      const phoneInputs = form.querySelectorAll('input[data-type="phone"], input[name="Phone"]');
      phoneInputs.forEach(input => {
        const val = input.value.trim();
        if (val) {
          const digitsOnly = val.replace(/\D/g, '');
          if (digitsOnly.length !== 10) {
            showError(input, 'Enter a valid 10-digit phone number.');
          }
        }
      });

      // Validate password policy (Register form)
      const passwordInputs = form.querySelectorAll('input[data-password-policy="true"]');
      passwordInputs.forEach(input => {
        const val = input.value;
        if (val) {
          const hasUpper = /[A-Z]/.test(val);
          const hasLower = /[a-z]/.test(val);
          const hasDigit = /[0-9]/.test(val);
          const isMin8 = val.length >= 8;
          if (!isMin8 || !hasUpper || !hasLower || !hasDigit) {
            showError(input, 'Password must be at least 8 characters and include uppercase, lowercase, and a number.');
          }
        }
      });

      // Validate Amount > 0
      const amountInputs = form.querySelectorAll('input[name="Amount"], input[data-type="amount"]');
      amountInputs.forEach(input => {
        if (input.value !== '') {
          const val = parseFloat(input.value);
          if (isNaN(val) || val <= 0) {
            showError(input, 'Opportunity Amount must be greater than 0.');
          }
        }
      });

      // Validate Probability between 0 and 100
      const probInputs = form.querySelectorAll('input[name="Probability"], input[data-type="probability"]');
      probInputs.forEach(input => {
        if (input.value !== '') {
          const val = parseInt(input.value, 10);
          if (isNaN(val) || val < 0 || val > 100) {
            showError(input, 'Probability must be between 0 and 100.');
          }
        }
      });

      // Validate Expected Close Date not in past for active opportunities
      const closeDateInput = form.querySelector('input[name="ExpectedCloseDate"]');
      const stageSelect = form.querySelector('select[name="Stage"]');
      if (closeDateInput && closeDateInput.value) {
        const isClosed = stageSelect && (stageSelect.value === 'Won' || stageSelect.value === 'Lost');
        if (!isClosed) {
          const selectedDate = new Date(closeDateInput.value);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (selectedDate < today) {
            showError(closeDateInput, 'Expected Close Date cannot be in the past.');
          }
        }
      }

      // Validate Follow-up Date not earlier than today
      const followUpDateInput = form.querySelector('input[name="FollowUpDate"]');
      if (followUpDateInput && followUpDateInput.value) {
        const selectedDate = new Date(followUpDateInput.value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (selectedDate < today) {
          showError(followUpDateInput, 'Follow-up date cannot be earlier than today.');
        }
      }

      if (!isValid) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  });
});
