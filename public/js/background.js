(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const bg = document.querySelector('.bg-animated');
    if (!bg) return;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '0';
    // Let CSS blur the canvas for hardware-accelerated fluid gradients
    canvas.style.filter = 'blur(120px)';
    bg.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth / 4; // Downscaled for performance
    let height = canvas.height = window.innerHeight / 4;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth / 4;
      height = canvas.height = window.innerHeight / 4;
    });

    // Dark mode palette — deep, rich, saturated
    const darkColors = [
      { r: 138, g: 92, b: 246 },   // Purple
      { r: 20, g: 184, b: 166 },   // Teal
      { r: 244, g: 63, b: 94 },    // Rose
      { r: 59, g: 130, b: 246 }    // Blue
    ];

    // Light mode palette — soft, muted, elegant pastels
    const lightColors = [
      { r: 129, g: 140, b: 248 },  // Soft Indigo
      { r: 52, g: 211, b: 153 },   // Emerald
      { r: 167, g: 139, b: 250 },  // Soft Violet
      { r: 56, g: 189, b: 248 }    // Sky
    ];

    const nodes = darkColors.map((color, index) => {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.min(width, height) * (0.35 + Math.random() * 0.25),
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        darkColor: darkColors[index],
        lightColor: lightColors[index],
        phase: Math.random() * Math.PI * 2,
        speed: 0.0015 + Math.random() * 0.002
      };
    });

    function draw() {
      ctx.clearRect(0, 0, width, height);

      const isLight = document.documentElement.classList.contains('light-theme');
      
      // Adjust canvas opacity: subtle for light, richer for dark
      canvas.style.opacity = isLight ? '0.35' : '0.42';

      nodes.forEach(node => {
        // Organic path drifting
        node.phase += node.speed;
        node.x += node.vx + Math.sin(node.phase) * 0.12;
        node.y += node.vy + Math.cos(node.phase * 1.3) * 0.1;

        // Boundaries check and bounce
        if (node.x < -node.r) { node.x = -node.r; node.vx *= -1; }
        if (node.x > width + node.r) { node.x = width + node.r; node.vx *= -1; }
        if (node.y < -node.r) { node.y = -node.r; node.vy *= -1; }
        if (node.y > height + node.r) { node.y = height + node.r; node.vy *= -1; }

        // Pick the right color palette
        const c = isLight ? node.lightColor : node.darkColor;

        // Draw radial gradient bubble
        const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r);
        grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 1)`);
        grad.addColorStop(0.7, `rgba(${c.r}, ${c.g}, ${c.b}, 0.15)`);
        grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      });

      requestAnimationFrame(draw);
    }

    draw();
  });
})();
