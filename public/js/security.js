/**
 * TeachSmart Academy Security Module
 * Anti-copy, anti-screenshot, anti-print protections
 */

(function() {
  'use strict';

  // Only apply on reader pages
  const isReaderPage = document.querySelector('.reader-page');
  const reportedEvents = {};

  // Throttled Violation Reporter
  function reportViolation(eventType, details) {
    if (!isReaderPage) return;
    const now = Date.now();
    const lastReported = reportedEvents[eventType] || 0;
    if (now - lastReported < 8000) return; // Rate limit reporting to once every 8 seconds per event type
    reportedEvents[eventType] = now;

    fetch('/reader/report-violation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ eventType, details })
    }).catch(err => console.error('Violation reporting failed:', err));
  }

  // ---- Disable Right-Click ----
  document.addEventListener('contextmenu', function(e) {
    if (isReaderPage) {
      e.preventDefault();
      reportViolation('Right-Click Attempt', 'User tried to open context menu on the reviewer page');
      return false;
    }
  });

  // ---- Disable Keyboard Shortcuts ----
  document.addEventListener('keydown', function(e) {
    if (!isReaderPage) return;

    // Ctrl/Cmd + C (Copy)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      reportViolation('Copy Content Attempt', 'User tried to copy content using Ctrl+C');
      return false;
    }
    // Ctrl/Cmd + P (Print)
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      reportViolation('Print Attempt', 'User tried to print reviewer page using Ctrl+P');
      return false;
    }
    // Ctrl/Cmd + S (Save)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      reportViolation('Save Page Attempt', 'User tried to save page offline using Ctrl+S');
      return false;
    }
    // Ctrl/Cmd + U (View Source)
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
      e.preventDefault();
      reportViolation('Source View Attempt', 'User tried to view page source code using Ctrl+U');
      return false;
    }
    // Ctrl/Cmd + A (Select All)
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      reportViolation('Select All Attempt', 'User tried to select all text content using Ctrl+A');
      return false;
    }
    // F12 (DevTools)
    if (e.key === 'F12') {
      e.preventDefault();
      reportViolation('DevTools Access', 'User tried to open console inspector via F12');
      return false;
    }
    // Ctrl+Shift+I (DevTools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      reportViolation('DevTools Access', 'User tried to open console inspector via Ctrl+Shift+I');
      return false;
    }
    // Ctrl+Shift+J (Console)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      reportViolation('Console Access', 'User tried to open JavaScript console via Ctrl+Shift+J');
      return false;
    }
    // PrintScreen
    if (e.key === 'PrintScreen') {
      e.preventDefault();
      document.body.style.filter = 'blur(20px)';
      setTimeout(() => { document.body.style.filter = 'none'; }, 1500);
      reportViolation('Screenshot Attempt', 'User pressed PrintScreen button');
      return false;
    }
  });

  // ---- Disable Text Selection on Reader ----
  if (isReaderPage) {
    document.addEventListener('selectstart', function(e) {
      e.preventDefault();
      return false;
    });

    // Disable drag
    document.addEventListener('dragstart', function(e) {
      e.preventDefault();
      return false;
    });
  }

  // ---- Blur on Focus Loss (hide content when switching apps on mobile) ----
  if (isReaderPage) {
    document.addEventListener('visibilitychange', function() {
      const bookPage = document.querySelector('.book-page');
      if (bookPage) {
        if (document.hidden) {
          bookPage.style.filter = 'blur(15px)';
          bookPage.style.transition = 'filter 0.1s';
          reportViolation('Focus Lost', 'Browser tab minimized or switched (visibilitychange)');
        } else {
          setTimeout(() => {
            bookPage.style.filter = 'none';
          }, 300);
        }
      }
    });

    // Also blur on window blur (for desktop screenshot tools)
    window.addEventListener('blur', function() {
      const bookPage = document.querySelector('.book-page');
      if (bookPage) {
        bookPage.style.filter = 'blur(15px)';
        bookPage.style.transition = 'filter 0.1s';
        reportViolation('Screenshot / Focus Loss', 'Window lost active focus (potential snipping tool active)');
      }
    });

    window.addEventListener('focus', function() {
      const bookPage = document.querySelector('.book-page');
      if (bookPage) {
        setTimeout(() => {
          bookPage.style.filter = 'none';
        }, 300);
      }
    });
  }

  // ---- DevTools Detection ----
  if (isReaderPage) {
    let devtoolsOpen = false;

    const checkDevTools = function() {
      const threshold = 160;
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;

      if (widthThreshold || heightThreshold) {
        if (!devtoolsOpen) {
          devtoolsOpen = true;
          const bookPage = document.querySelector('.book-page');
          if (bookPage) bookPage.style.filter = 'blur(20px)';
          reportViolation('DevTools Opened', 'Inspector panels were activated by the user');
        }
      } else {
        if (devtoolsOpen) {
          devtoolsOpen = false;
          const bookPage = document.querySelector('.book-page');
          if (bookPage) bookPage.style.filter = 'none';
        }
      }
    };

    setInterval(checkDevTools, 1000);
  }

  console.log('%cTeachSmart Academy Security Active', 'color: #7C6FFF; font-size: 14px; font-weight: bold;');
  console.log('%cContent is protected. Unauthorized reproduction is prohibited.', 'color: #FF6B8A;');
})();
