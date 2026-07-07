import confetti from 'canvas-confetti';

// Cute confetti burst — magenta/periwinkle brand palette matching app theme.
export const celebrateBurst = (origin = { x: 0.5, y: 0.4 }) => {
  const colors = ['#ED00ED', '#908DCE', '#C084FC', '#FBCFE8', '#FDE68A', '#38BDF8'];
  confetti({
    particleCount: 80,
    spread: 70,
    origin,
    colors,
    scalar: 0.9,
    ticks: 200,
    gravity: 0.9,
  });
  setTimeout(() => {
    confetti({
      particleCount: 40,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.6 },
      colors,
      scalar: 0.8,
    });
    confetti({
      particleCount: 40,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.6 },
      colors,
      scalar: 0.8,
    });
  }, 220);
};

// Subtle continuous shimmer (used on spotlight card hover)
export const sparkleBurst = (origin) => {
  confetti({
    particleCount: 20,
    spread: 40,
    origin,
    colors: ['#FDE68A', '#908DCE', '#FBCFE8'],
    scalar: 0.6,
    ticks: 120,
    gravity: 0.6,
  });
};
