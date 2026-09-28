/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm cream backgrounds
        cream: {
          50:  '#FFFFFF',
          100: '#FDFBF7',
          200: '#F5EDE0',
          300: '#EDE0CE',
          400: '#E2CEB5',
        },
        // Coffee bean browns
        coffee: {
          50:  '#F6F1EC',
          100: '#EBE0D5',
          200: '#CEB49B',
          300: '#A8825E',
          400: '#7B5C40',
          500: '#5C3D2A',
          600: '#5C3D2A',
          700: '#4A3B32',  // Primary accent
          800: '#2C221E',  // Deep espresso
          900: '#1A1210',
        },
        // Warm amber/gold highlights
        amber: {
          50:  '#FFFBF0',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',  // Primary highlight
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        // Status colors (warm-toned)
        available: {
          bg:     '#ECFDF5',
          border: '#6EE7B7',
          text:   '#065F46',
        },
        occupied: {
          bg:     '#FFFBEB',
          border: '#FCD34D',
          text:   '#92400E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Georgia', 'serif'],
      },
      boxShadow: {
        'warm-sm': '0 1px 3px 0 rgba(74, 59, 50, 0.08), 0 1px 2px -1px rgba(74, 59, 50, 0.06)',
        'warm':    '0 4px 6px -1px rgba(74, 59, 50, 0.10), 0 2px 4px -2px rgba(74, 59, 50, 0.08)',
        'warm-md': '0 8px 16px -2px rgba(74, 59, 50, 0.12), 0 3px 6px -3px rgba(74, 59, 50, 0.08)',
        'warm-lg': '0 16px 32px -4px rgba(74, 59, 50, 0.15), 0 6px 12px -5px rgba(74, 59, 50, 0.10)',
        'inner-warm': 'inset 0 2px 4px 0 rgba(74, 59, 50, 0.06)',
      },
      borderRadius: {
        'xl':  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
