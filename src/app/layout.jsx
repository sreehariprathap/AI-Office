import { Baloo_2, Nunito } from 'next/font/google'
import '../styles.css'

// Swapped from Silkscreen/VT323 (true bitmap-simulation fonts, illegible
// at small sizes and part of why the whole hub read as "pixelated") to a
// rounded display face for headers/labels and a clean humanist sans for
// everything read at length -- same warm, friendly office-app tone as
// the reference art, without sacrificing legibility.
const pixel = Baloo_2({ weight: ['500', '600', '700'], subsets: ['latin'], variable: '--font-pixel', display: 'swap' })
const body = Nunito({ weight: ['400', '600', '700'], subsets: ['latin'], variable: '--font-body', display: 'swap' })

export const metadata = {
  title: 'Agent HQ',
  description: 'A pixel-art office for every AI agent you run.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%231b2a22'/><rect x='3' y='3' width='10' height='7' fill='%2379e0a0'/><rect x='5' y='11' width='6' height='2' fill='%23d9a066'/></svg>",
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${pixel.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  )
}
