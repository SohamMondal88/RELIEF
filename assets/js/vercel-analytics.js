/**
 * Vercel Web Analytics - Inline initialization
 * This initializes the Vercel Analytics queue and loads the script
 */
(function() {
  // Initialize the analytics queue
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };
  
  // Create and inject the analytics script
  var script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  
  script.onerror = function() {
    console.log('[Vercel Web Analytics] Failed to load script. Make sure Web Analytics is enabled in your Vercel project settings.');
  };
  
  document.head.appendChild(script);
})();
