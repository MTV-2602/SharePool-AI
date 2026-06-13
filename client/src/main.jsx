import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ═══════════════════════════════════════════════════════════════════════════
// Scroll Reveal Observer — SkillUi.md Section 7
// Kích hoạt animation .reveal khi phần tử xuất hiện trên màn hình
// ═══════════════════════════════════════════════════════════════════════════
if (typeof IntersectionObserver !== 'undefined') {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      });
    },
    {
      threshold: 0.08,
      rootMargin: '0px 0px -40px 0px'
    }
  );

  // Observe on initial load and re-observe on DOM changes
  const observeReveals = () => {
    document.querySelectorAll('.reveal:not(.visible)').forEach((el) => {
      revealObserver.observe(el);
    });
  };

  // Initial observe after render
  setTimeout(observeReveals, 100);

  // MutationObserver to catch dynamically added .reveal elements
  const mutationObserver = new MutationObserver(() => {
    observeReveals();
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}
