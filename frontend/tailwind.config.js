/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Crimson carries the blood subsystem, teal the organ subsystem;
        // slate is the neutral chrome.  Three families, used consistently.
        brand: {
          50:'#fef2f3',100:'#fde3e5',200:'#fbccd1',300:'#f7a7b0',
          400:'#f17287',500:'#e5405f',600:'#cf2048',700:'#ae153c',
          800:'#921538',900:'#7d1535',950:'#450618',
        },
        organ: {
          50:'#eefbfa',100:'#d3f5f2',200:'#abeae7',300:'#73dad7',
          400:'#3bc0bf',500:'#20a4a5',600:'#178385',700:'#16696b',
          800:'#175456',700:'#16696b',900:'#164749',950:'#06282b',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif','system-ui','-apple-system','Segoe UI','Roboto','Helvetica Neue','Arial','sans-serif'],
        mono: ['ui-monospace','SFMono-Regular','Menlo','Consolas','monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        pop: '0 10px 32px -8px rgb(15 23 42 / 0.18)',
      },
      keyframes: {
        'fade-in': { from:{opacity:0,transform:'translateY(4px)'}, to:{opacity:1,transform:'none'} },
        'slide-in': { from:{opacity:0,transform:'translateX(12px)'}, to:{opacity:1,transform:'none'} },
      },
      animation: { 'fade-in':'fade-in .18s ease-out', 'slide-in':'slide-in .2s ease-out' },
    },
  },
  plugins: [],
};
