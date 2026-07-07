module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0B0B12',
          card: '#19182C',
          sidebar: '#080810',
        },
        foreground: {
          DEFAULT: '#C5CBE8',
          muted: '#8E93B8',
        },
        primary: {
          DEFAULT: '#ED00ED',
          foreground: '#ffffff',
          hover: '#C800C8',
        },
        secondary: {
          DEFAULT: '#21203A',
          foreground: '#C5CBE8',
        },
        accent: {
          DEFAULT: '#908DCE',
          foreground: '#0B0B12',
        },
        border: '#272645',
      },
      fontFamily: {
        heading: ['"DM Sans"', 'Avenir Next', 'Segoe UI', 'sans-serif'],
        body: ['"DM Sans"', 'Avenir Next', 'Segoe UI', 'sans-serif'],
        mono: ['"DM Mono"', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(237, 0, 237, 0.25)',
        'primary-glow': '0 0 20px rgba(237, 0, 237, 0.35)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(237, 0, 237, 0.2)' },
          '50%': { boxShadow: '0 0 40px rgba(237, 0, 237, 0.4)' },
        },
      },
    },
  },
  plugins: [],
};
