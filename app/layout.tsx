import type { Metadata } from 'next';
import { DM_Sans, Manrope } from 'next/font/google';
import './globals.css';

const display = Manrope({ variable: '--font-display', subsets: ['latin'] });
const body = DM_Sans({ variable: '--font-body', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AIMS — AI-Powered Payment & Finance Control',
  description: 'A production-oriented architecture for intelligent, policy-controlled, and auditable payment operations.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${display.variable} ${body.variable}`}>{children}</body></html>;
}
