/* @type {import('tailwindcss').Config} */
export default 
{
    /* Fichiers scannés pour détecter les classes Tailwind */
    content: 
    [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx,html}",
    ],

    /* Personnalisation du thème */
    theme: 
    {
      extend: 
      {
        /* Couleurs personnalisées */
        colors: 
        {
          'pong-green': '#00ff00',
          'pong-black': '#000000ff',
          'pong-white': '#ffffff',
        },

        /* Polices personnalisées */
        fontFamily: 
        {
          'game': ['Courier New', 'monospace'],
        },

        /* Animations personnalisées */
        animation: 
        {
          'bounce-slow': 'bounce 2s infinite',
          'pulse-slow': 'pulse 3s infinite',
        },
      },
    },

    /* Plugins Tailwind à utiliser */
    plugins: [],
}
